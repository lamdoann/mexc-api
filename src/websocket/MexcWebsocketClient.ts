import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { decodePushData } from './proto';
import { MexcFuturesWebsocketClient } from './MexcFuturesWebsocketClient';
import { MexcRestClient } from '../rest/MexcRestClient';
import { DefaultLogger, Logger } from '../util/logger';
import type {
  AggreDealsInterval,
  DecodedPushData,
  KlineInterval,
  MarketType,
  MexcBalanceUpdate,
  MexcExecutionUpdate,
  MexcKline,
  MexcOrderUpdate,
  MexcTrade,
  WsClientOptions,
  WsControlMessage,
} from '../types/websocket';

export interface SubscribeTradesOptions {
  /** Which market to subscribe on. Defaults to 'spot'. */
  market?: MarketType;
  /** Spot only: aggregation window (10ms or 100ms). Defaults to '100ms'. */
  interval?: AggreDealsInterval;
}

export const DEFAULT_WS_URL = 'wss://wbs-api.mexc.com/ws';

/** MEXC allows up to 30 subscriptions per connection; cap params per message accordingly. */
const MAX_PARAMS_PER_MESSAGE = 30;

/**
 * Build the channel string for the raw per-trade deals stream.
 *
 * @deprecated MEXC currently rejects this channel with "Blocked!". Use the
 * aggregated trades channel ({@link spotAggreTradesChannel}) instead.
 */
export function spotTradesChannel(symbol: string): string {
  return `spot@public.deals.v3.api.pb@${symbol.toUpperCase()}`;
}

/** Build the channel string for the aggregated deals (trades) stream. */
export function spotAggreTradesChannel(
  symbol: string,
  interval: AggreDealsInterval = '100ms',
): string {
  return `spot@public.aggre.deals.v3.api.pb@${interval}@${symbol.toUpperCase()}`;
}

/** Build the channel string for the candlestick (kline) stream. */
export function spotKlineChannel(symbol: string, interval: KlineInterval): string {
  return `spot@public.kline.v3.api.pb@${symbol.toUpperCase()}@${interval}`;
}

/** Private user-data channels (require a listenKey on the connection). */
export const PRIVATE_ORDERS_CHANNEL = 'spot@private.orders.v3.api.pb';
export const PRIVATE_DEALS_CHANNEL = 'spot@private.deals.v3.api.pb';
export const PRIVATE_ACCOUNT_CHANNEL = 'spot@private.account.v3.api.pb';

/**
 * Typed event surface for {@link MexcWebsocketClient}.
 */
export declare interface MexcWebsocketClient {
  on(event: 'open', listener: () => void): this;
  on(event: 'close', listener: (code: number, reason: string) => void): this;
  on(event: 'reconnecting', listener: () => void): this;
  on(event: 'reconnected', listener: () => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  /** Raw JSON control frames (subscription acks, PONG). */
  on(event: 'response', listener: (msg: WsControlMessage) => void): this;
  /** Raw decoded protobuf push payload. */
  on(event: 'message', listener: (msg: DecodedPushData) => void): this;
  /** One normalised trade per deal item (public deals stream). */
  on(event: 'trade', listener: (trade: MexcTrade) => void): this;
  /** Candlestick update (public kline stream). */
  on(event: 'kline', listener: (kline: MexcKline) => void): this;
  /** Private order update (requires listenKey). */
  on(event: 'order', listener: (order: MexcOrderUpdate) => void): this;
  /** Private execution / fill (requires listenKey). */
  on(event: 'execution', listener: (exec: MexcExecutionUpdate) => void): this;
  /** Private balance update (requires listenKey). */
  on(event: 'balance', listener: (balance: MexcBalanceUpdate) => void): this;
}

/**
 * WebSocket client for MEXC Spot V3 public trade streams.
 *
 * MEXC pushes market data as protobuf-encoded binary frames over
 * `wss://wbs-api.mexc.com/ws`; control messages (subscription acks, PONG) arrive
 * as JSON text frames. This client handles the connection lifecycle, keepalive
 * PINGs, automatic reconnect + re-subscribe, and decoding of the deals channels.
 *
 * @example
 * const ws = new MexcWebsocketClient();
 * ws.on('trade', (t) => console.log(t.symbol, t.side, t.price, t.quantity));
 * ws.connect();
 * ws.subscribeSpotTrades('BTCUSDT');
 */
export class MexcWebsocketClient extends EventEmitter {
  private readonly wsUrl: string;
  private readonly pingInterval: number;
  private readonly pongTimeout: number;
  private readonly reconnectDelay: number;
  private readonly logger: Logger;
  private listenKey?: string;

  private readonly apiKey?: string;
  private readonly apiSecret?: string;
  private restClient?: MexcRestClient;
  private readonly keepAliveInterval: number;
  private keepAliveTimer: NodeJS.Timeout | null = null;
  /** True when this client created the listenKey and is responsible for its lifecycle. */
  private managedListenKey = false;

  /** Lazily created futures connection (only when futures trades are subscribed). */
  private futuresClient: MexcFuturesWebsocketClient | null = null;
  private readonly options: WsClientOptions;

  private ws: WebSocket | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private pongTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;

  /** Channels we want subscribed; replayed on reconnect. */
  private readonly subscriptions = new Set<string>();
  private wantConnected = false;

  constructor(options: WsClientOptions = {}) {
    super();
    this.wsUrl = options.wsUrl ?? DEFAULT_WS_URL;
    this.pingInterval = options.pingInterval ?? 20000;
    this.pongTimeout = options.pongTimeout ?? 10000;
    this.reconnectDelay = options.reconnectDelay ?? 2000;
    this.logger = options.logger ?? DefaultLogger;
    this.listenKey = options.listenKey;
    this.apiKey = options.apiKey;
    this.apiSecret = options.apiSecret;
    this.restClient = options.restClient;
    this.keepAliveInterval = options.listenKeyKeepAliveInterval ?? 30 * 60 * 1000;
    this.options = options;
  }

  /**
   * Open the connection. Safe to call once; subscriptions can be added any time.
   * Pass a `listenKey` (or set it via options) to enable private user-data streams.
   */
  connect(listenKey?: string): void {
    if (listenKey) {
      this.listenKey = listenKey;
    }
    this.wantConnected = true;
    this.openSocket();
  }

  private buildUrl(): string {
    if (!this.listenKey) {
      return this.wsUrl;
    }
    const sep = this.wsUrl.includes('?') ? '&' : '?';
    return `${this.wsUrl}${sep}listenKey=${encodeURIComponent(this.listenKey)}`;
  }

  private openSocket(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const url = this.buildUrl();
    this.logger.info(`[mexc-ws] connecting to ${this.wsUrl}${this.listenKey ? ' (private)' : ''}`);
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.on('open', () => {
      this.logger.info('[mexc-ws] connected');
      this.startPing();
      // (Re)subscribe to everything we want.
      if (this.subscriptions.size > 0) {
        this.sendSubscription([...this.subscriptions]);
      }
      this.emit('open');
    });

    ws.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
      this.handleMessage(data, isBinary);
    });

    ws.on('error', (err: Error) => {
      this.logger.error('[mexc-ws] error', err.message);
      this.emit('error', err);
    });

    ws.on('close', (code: number, reason: Buffer) => {
      this.logger.warn(`[mexc-ws] closed (${code}) ${reason.toString()}`);
      this.cleanupTimers();
      this.ws = null;
      this.emit('close', code, reason.toString());
      if (this.wantConnected) {
        this.scheduleReconnect();
      }
    });
  }

  private handleMessage(data: WebSocket.RawData, isBinary: boolean): void {
    if (isBinary) {
      try {
        const decoded = decodePushData(toUint8Array(data));
        this.emit('message', decoded);
        this.emitTrades(decoded);
        this.emitKline(decoded);
        this.emitPrivate(decoded);
      } catch (err) {
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
      }
      return;
    }

    // JSON text frame: subscription ack / PONG / error.
    let parsed: WsControlMessage;
    try {
      parsed = JSON.parse(data.toString()) as WsControlMessage;
    } catch {
      return;
    }
    if (parsed.msg === 'PONG' || (parsed as { msg?: string }).msg === 'PONG') {
      this.clearPongTimeout();
    }
    this.emit('response', parsed);
  }

  private emitTrades(decoded: DecodedPushData): void {
    const symbol = decoded.symbol ?? '';
    const channel = decoded.channel ?? '';
    const sendTime = decoded.sendTime;
    const payload = decoded.publicDeals ?? decoded.publicAggreDeals;
    if (!payload?.deals) {
      return;
    }
    for (const deal of payload.deals) {
      const trade: MexcTrade = {
        market: 'spot',
        symbol,
        channel,
        price: deal.price,
        quantity: deal.quantity,
        tradeType: deal.tradeType,
        side: deal.tradeType === 2 ? 'sell' : 'buy',
        time: deal.time,
        sendTime,
      };
      this.emit('trade', trade);
    }
  }

  private emitKline(decoded: DecodedPushData): void {
    if (!decoded.publicSpotKline) {
      return;
    }
    this.emit('kline', {
      ...decoded.publicSpotKline,
      symbol: decoded.symbol ?? '',
      channel: decoded.channel ?? '',
      sendTime: decoded.sendTime,
    } as MexcKline);
  }

  private emitPrivate(decoded: DecodedPushData): void {
    const symbol = decoded.symbol ?? '';
    const channel = decoded.channel ?? '';
    const sendTime = decoded.sendTime;

    if (decoded.privateOrders) {
      this.emit('order', { ...decoded.privateOrders, symbol, channel, sendTime } as MexcOrderUpdate);
    }
    if (decoded.privateDeals) {
      this.emit('execution', {
        ...decoded.privateDeals,
        symbol,
        channel,
        sendTime,
      } as MexcExecutionUpdate);
    }
    if (decoded.privateAccount) {
      this.emit('balance', { ...decoded.privateAccount, channel, sendTime } as MexcBalanceUpdate);
    }
  }

  /**
   * Subscribe to trade streams for one or more symbols on either market.
   *
   * @example
   * ws.subscribeTrades(['BTCUSDT'], { market: 'spot' });
   * ws.subscribeTrades(['BTC_USDT'], { market: 'future' });
   */
  subscribeTrades(symbols: string | string[], options: SubscribeTradesOptions = {}): void {
    if (options.market === 'future') {
      this.getFuturesClient().subscribeTrades(symbols);
      return;
    }
    // Ensure the spot socket is opening so the caller needn't call connect() first.
    this.connect();
    this.subscribeSpotTrades(symbols, options.interval ?? '100ms');
  }

  /** Unsubscribe from trade streams on either market. */
  unsubscribeTrades(symbols: string | string[], options: SubscribeTradesOptions = {}): void {
    if (options.market === 'future') {
      this.futuresClient?.unsubscribeTrades(symbols);
      return;
    }
    this.unsubscribeTradeStreams(symbols, options.interval ?? '100ms');
  }

  private getFuturesClient(): MexcFuturesWebsocketClient {
    if (!this.futuresClient) {
      const client = new MexcFuturesWebsocketClient({
        pingInterval: this.options.pingInterval,
        reconnectDelay: this.options.reconnectDelay,
        logger: this.logger,
      });
      // Bubble futures events up so consumers listen in one place.
      client.on('trade', (t) => this.emit('trade', t));
      client.on('error', (e) => this.emit('error', e));
      this.futuresClient = client;
      client.connect();
    }
    return this.futuresClient;
  }

  /**
   * Subscribe to the spot trades stream for one or more symbols (sent in one message).
   *
   * Uses MEXC's aggregated deals channel — the raw per-trade channel is currently
   * blocked by MEXC. `interval` is the aggregation window (10ms or 100ms).
   */
  subscribeSpotTrades(
    symbols: string | string[],
    interval: AggreDealsInterval = '100ms',
  ): void {
    this.subscribeSpotAggreTrades(symbols, interval);
  }

  /** Subscribe to the aggregated trades stream for one or more symbols (10ms or 100ms window). */
  subscribeSpotAggreTrades(
    symbols: string | string[],
    interval: AggreDealsInterval = '100ms',
  ): void {
    this.subscribe(toArray(symbols).map((s) => spotAggreTradesChannel(s, interval)));
  }

  /** Unsubscribe from the trade streams for one or more symbols. */
  unsubscribeTradeStreams(
    symbols: string | string[],
    interval: AggreDealsInterval = '100ms',
  ): void {
    this.unsubscribe(toArray(symbols).map((s) => spotAggreTradesChannel(s, interval)));
  }

  /** Subscribe to candlestick (kline) streams for one or more symbols. */
  subscribeCandlesticks(symbols: string | string[], interval: KlineInterval): void {
    this.subscribe(toArray(symbols).map((s) => spotKlineChannel(s, interval)));
  }

  /** Unsubscribe from candlestick (kline) streams for one or more symbols. */
  unsubscribeCandlesticks(symbols: string | string[], interval: KlineInterval): void {
    this.unsubscribe(toArray(symbols).map((s) => spotKlineChannel(s, interval)));
  }

  /** Subscribe to private order updates (requires a listenKey on the connection). */
  subscribeUserOrders(): void {
    this.subscribe(PRIVATE_ORDERS_CHANNEL);
  }

  /** Subscribe to private executions / fills (requires a listenKey on the connection). */
  subscribeUserDeals(): void {
    this.subscribe(PRIVATE_DEALS_CHANNEL);
  }

  /** Subscribe to private balance updates (requires a listenKey on the connection). */
  subscribeUserAccount(): void {
    this.subscribe(PRIVATE_ACCOUNT_CHANNEL);
  }

  /**
   * Open a private user-data stream with a fully managed listenKey: the client
   * creates the listenKey via REST, connects, keepalives it on an interval, and
   * recreates it (reconnecting) if it expires. Requires `apiKey`/`apiSecret` or a
   * `restClient` in the options. Returns the listenKey.
   *
   * @example
   * const ws = new MexcWebsocketClient({ apiKey, apiSecret });
   * ws.on('order', (o) => ...);
   * await ws.subscribeUserDataStream();
   */
  async subscribeUserDataStream(
    channels: { orders?: boolean; deals?: boolean; account?: boolean } = {
      orders: true,
      deals: true,
      account: true,
    },
  ): Promise<string> {
    const rest = this.getRestClient();
    const { listenKey } = await rest.createListenKey();
    this.listenKey = listenKey;
    this.managedListenKey = true;

    this.connect();
    this.startListenKeyKeepAlive();

    if (channels.orders) {
      this.subscribeUserOrders();
    }
    if (channels.deals) {
      this.subscribeUserDeals();
    }
    if (channels.account) {
      this.subscribeUserAccount();
    }
    return listenKey;
  }

  private getRestClient(): MexcRestClient {
    if (this.restClient) {
      return this.restClient;
    }
    if (!this.apiKey || !this.apiSecret) {
      throw new Error(
        'apiKey/apiSecret (or a restClient) are required to manage a user data stream',
      );
    }
    this.restClient = new MexcRestClient({ apiKey: this.apiKey, apiSecret: this.apiSecret });
    return this.restClient;
  }

  private startListenKeyKeepAlive(): void {
    this.stopListenKeyKeepAlive();
    this.keepAliveTimer = setInterval(() => {
      void this.keepListenKeyAlive();
    }, this.keepAliveInterval);
    // Don't let the keepalive timer keep the process alive on its own.
    this.keepAliveTimer.unref?.();
  }

  private async keepListenKeyAlive(): Promise<void> {
    if (!this.listenKey) {
      return;
    }
    try {
      await this.getRestClient().keepAliveListenKey(this.listenKey);
      this.logger.trace('[mexc-ws] listenKey kept alive');
    } catch (err) {
      this.logger.warn('[mexc-ws] listenKey keepalive failed, recreating', String(err));
      try {
        const { listenKey } = await this.getRestClient().createListenKey();
        this.listenKey = listenKey;
        // Reconnect with the new listenKey (close triggers an auto-reconnect).
        this.ws?.terminate();
      } catch (err2) {
        this.emit('error', err2 instanceof Error ? err2 : new Error(String(err2)));
      }
    }
  }

  private stopListenKeyKeepAlive(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  /**
   * Subscribe to one or more raw channel strings. New channels are tracked (and
   * replayed on reconnect) and sent batched in SUBSCRIPTION messages. If called
   * before {@link connect}, the socket auto-opens and the batch is sent on open.
   */
  subscribe(channels: string | string[]): void {
    const fresh = toArray(channels).filter((c) => !this.subscriptions.has(c));
    if (fresh.length === 0) {
      return;
    }
    fresh.forEach((c) => this.subscriptions.add(c));

    if (this.isOpen()) {
      this.sendSubscription(fresh);
    } else if (this.wantConnected && !this.ws) {
      // Auto-open if the caller subscribed before connect(); replayed on 'open'.
      this.openSocket();
    }
  }

  /** Unsubscribe from one or more channels. */
  unsubscribe(channels: string | string[]): void {
    const list = toArray(channels);
    list.forEach((c) => this.subscriptions.delete(c));
    if (!this.isOpen()) {
      return;
    }
    for (let i = 0; i < list.length; i += MAX_PARAMS_PER_MESSAGE) {
      this.send({
        method: 'UNSUBSCRIPTION',
        params: list.slice(i, i + MAX_PARAMS_PER_MESSAGE),
      });
    }
  }

  /** Gracefully close the connection (incl. any futures connection) and stop reconnecting. */
  close(): void {
    this.shutdown();
    this.futuresClient?.close();
    this.futuresClient = null;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Forcefully terminate the socket (no close handshake) and stop reconnecting.
   * Use when you need an immediate teardown of an unresponsive connection.
   */
  terminate(): void {
    this.shutdown();
    this.futuresClient?.terminate();
    this.futuresClient = null;
    if (this.ws) {
      this.ws.terminate();
      this.ws = null;
    }
  }

  private shutdown(): void {
    this.wantConnected = false;
    this.cleanupTimers();
    this.stopListenKeyKeepAlive();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    // Best-effort release of a listenKey we created.
    if (this.managedListenKey && this.listenKey && this.restClient) {
      const key = this.listenKey;
      this.managedListenKey = false;
      this.restClient.closeListenKey(key).catch(() => {
        /* ignore — it expires on its own */
      });
    }
  }

  private sendSubscription(channels: string[]): void {
    // MEXC allows up to 30 subscriptions per connection; chunk large batches so
    // a single SUBSCRIPTION message never exceeds that.
    for (let i = 0; i < channels.length; i += MAX_PARAMS_PER_MESSAGE) {
      this.send({
        method: 'SUBSCRIPTION',
        params: channels.slice(i, i + MAX_PARAMS_PER_MESSAGE),
      });
    }
  }

  private send(payload: unknown): void {
    if (this.isOpen()) {
      this.ws!.send(JSON.stringify(payload));
    }
  }

  private isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private startPing(): void {
    this.cleanupTimers();
    this.pingTimer = setInterval(() => {
      if (!this.isOpen()) {
        return;
      }
      this.send({ method: 'PING' });
      this.armPongTimeout();
    }, this.pingInterval);
  }

  private armPongTimeout(): void {
    this.clearPongTimeout();
    this.pongTimer = setTimeout(() => {
      this.logger.warn('[mexc-ws] PONG timeout — terminating socket');
      this.ws?.terminate();
    }, this.pongTimeout);
  }

  private clearPongTimeout(): void {
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  private cleanupTimers(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.clearPongTimeout();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }
    this.emit('reconnecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
      this.emit('reconnected');
    }, this.reconnectDelay);
  }
}

function toArray(value: string | string[]): string[] {
  return Array.isArray(value) ? value : [value];
}

function toUint8Array(data: WebSocket.RawData): Uint8Array {
  if (Buffer.isBuffer(data)) {
    return new Uint8Array(data);
  }
  if (Array.isArray(data)) {
    return new Uint8Array(Buffer.concat(data));
  }
  return new Uint8Array(data as ArrayBuffer);
}
