import crypto from 'crypto';
import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { DefaultLogger, Logger } from '../util/logger';
import { backoffDelay } from '../util/backoff';
import type {
  KlineInterval,
  MexcFuturesKline,
  MexcFuturesOrder,
  MexcTrade,
  WsClientOptions,
} from '../types/websocket';

export const DEFAULT_FUTURES_WS_URL = 'wss://contract.mexc.com/edge';

/**
 * Normalise a futures symbol to MEXC's `BASE_QUOTE` form. Accepts either
 * "BTC_USDT" (returned as-is) or "BTCUSDT" (converted) for common quote assets.
 */
export function toFuturesSymbol(symbol: string): string {
  const s = symbol.toUpperCase();
  if (s.includes('_')) {
    return s;
  }
  const match = s.match(/^(.+?)(USDT|USDC|USD|BTC|ETH)$/);
  return match ? `${match[1]}_${match[2]}` : s;
}

/** Raw futures deal item from the `push.deal` channel. */
interface FuturesDealItem {
  p: number;
  v: number;
  T: number; // 1 buy, 2 sell
  t: number;
  i?: string;
}

interface SubMessage {
  method: string; // e.g. 'sub.deal', 'sub.kline'
  param: Record<string, unknown>;
}

export declare interface MexcFuturesWebsocketClient {
  on(event: 'open', listener: () => void): this;
  on(event: 'close', listener: (code: number, reason: string) => void): this;
  on(event: 'reconnecting', listener: (attempt: number) => void): this;
  on(event: 'reconnected', listener: () => void): this;
  /** All reconnect attempts exhausted; the client gave up. */
  on(event: 'reconnectFailed', listener: (attempts: number) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  /** Raw JSON control/data frame. */
  on(event: 'response', listener: (msg: Record<string, unknown>) => void): this;
  /** One normalised trade per deal item. */
  on(event: 'trade', listener: (trade: MexcTrade) => void): this;
  /** A candlestick update (public kline stream). */
  on(event: 'kline', listener: (kline: MexcFuturesKline) => void): this;
  /** Private login result (true on success). */
  on(event: 'login', listener: (success: boolean) => void): this;
  /** Private order update (after login). */
  on(event: 'order', listener: (order: MexcFuturesOrder) => void): this;
}

/**
 * WebSocket client for MEXC **Futures (contract)** streams.
 *
 * The futures feed at `wss://contract.mexc.com/edge` is plain JSON: subscribe
 * with `{ method: 'sub.deal'|'sub.kline', param: {...} }`, keepalive with
 * `{ method: 'ping' }`. Public trades arrive on `push.deal`, candlesticks on
 * `push.kline`. Private order updates (`push.personal.order`) require a login
 * (apiKey/apiSecret) and are auto-pushed afterwards.
 */
export class MexcFuturesWebsocketClient extends EventEmitter {
  private readonly wsUrl: string;
  private readonly pingInterval: number;
  private readonly reconnectDelay: number;
  private readonly maxReconnectDelay: number;
  private readonly maxReconnectAttempts: number;
  private reconnectAttempts = 0;
  private readonly logger: Logger;
  private readonly apiKey?: string;
  private readonly apiSecret?: string;

  private ws: WebSocket | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;

  /** Public subscriptions to replay on (re)connect, keyed uniquely. */
  private readonly subscriptions = new Map<string, SubMessage>();
  private wantConnected = false;
  /** Whether the caller wants private (logged-in) channels. */
  private wantPrivate = false;

  constructor(options: WsClientOptions = {}) {
    super();
    this.wsUrl = options.wsUrl ?? DEFAULT_FUTURES_WS_URL;
    this.pingInterval = options.pingInterval ?? 15000;
    this.reconnectDelay = options.reconnectDelay ?? 2000;
    this.maxReconnectDelay = options.maxReconnectDelay ?? 30000;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? Infinity;
    this.logger = options.logger ?? DefaultLogger;
    this.apiKey = options.apiKey;
    this.apiSecret = options.apiSecret;
  }

  /** Open the connection. Subscriptions can be added before or after. */
  connect(): void {
    this.wantConnected = true;
    this.reconnectAttempts = 0;
    this.openSocket();
  }

  private openSocket(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.logger.info(`[mexc-futures-ws] connecting to ${this.wsUrl}`);
    const ws = new WebSocket(this.wsUrl);
    this.ws = ws;

    ws.on('open', () => {
      this.logger.info('[mexc-futures-ws] connected');
      const wasReconnect = this.reconnectAttempts > 0;
      this.reconnectAttempts = 0;
      this.startPing();
      if (this.wantPrivate) {
        this.login();
      }
      this.subscriptions.forEach((msg) => this.send(msg));
      this.emit('open');
      if (wasReconnect) {
        this.emit('reconnected');
      }
    });

    ws.on('message', (data: WebSocket.RawData) => this.handleMessage(data));
    ws.on('error', (err: Error) => this.emit('error', err));
    ws.on('close', (code: number, reason: Buffer) => {
      this.logger.warn(`[mexc-futures-ws] closed (${code})`);
      this.stopPing();
      this.ws = null;
      this.emit('close', code, reason.toString());
      if (this.wantConnected) {
        this.scheduleReconnect();
      }
    });
  }

  private handleMessage(data: WebSocket.RawData): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    this.emit('response', msg);

    switch (msg.channel) {
      case 'push.deal':
        return this.emitTrades(msg);
      case 'push.kline':
        return this.emitKline(msg);
      case 'push.personal.order':
        return this.emitOrder(msg);
      case 'rs.login':
        this.emit('login', msg.data === 'success');
        if (msg.data !== 'success') {
          this.logger.error('[mexc-futures-ws] login failed', JSON.stringify(msg));
        }
        return;
      default:
        return;
    }
  }

  private emitTrades(msg: Record<string, unknown>): void {
    const symbol = String(msg.symbol ?? '');
    const deals = Array.isArray(msg.data) ? (msg.data as FuturesDealItem[]) : [msg.data as FuturesDealItem];
    for (const deal of deals) {
      if (!deal) {
        continue;
      }
      this.emit('trade', {
        market: 'future',
        symbol,
        channel: 'push.deal',
        price: String(deal.p),
        quantity: String(deal.v),
        side: deal.T === 2 ? 'sell' : 'buy',
        tradeType: deal.T,
        time: deal.t,
        tradeId: deal.i,
      } as MexcTrade);
    }
  }

  private emitKline(msg: Record<string, unknown>): void {
    const d = msg.data as Record<string, unknown>;
    if (!d) {
      return;
    }
    this.emit('kline', {
      market: 'future',
      symbol: String(d.symbol ?? msg.symbol ?? ''),
      interval: String(d.interval ?? ''),
      time: Number(d.t),
      open: String(d.o),
      high: String(d.h),
      low: String(d.l),
      close: String(d.c),
      volume: String(d.q),
      amount: String(d.a),
    } as MexcFuturesKline);
  }

  private emitOrder(msg: Record<string, unknown>): void {
    const d = msg.data as MexcFuturesOrder | undefined;
    if (d) {
      this.emit('order', d);
    }
  }

  /** Subscribe to futures trade streams for one or more symbols. */
  subscribeTrades(symbols: string | string[]): void {
    for (const symbol of toArray(symbols).map(toFuturesSymbol)) {
      this.addSub(`deal:${symbol}`, { method: 'sub.deal', param: { symbol } });
    }
  }

  /** Unsubscribe from futures trade streams for one or more symbols. */
  unsubscribeTrades(symbols: string | string[]): void {
    for (const symbol of toArray(symbols).map(toFuturesSymbol)) {
      this.removeSub(`deal:${symbol}`);
    }
  }

  /** Subscribe to futures candlestick (kline) streams for one or more symbols. */
  subscribeCandlesticks(symbols: string | string[], interval: KlineInterval): void {
    for (const symbol of toArray(symbols).map(toFuturesSymbol)) {
      this.addSub(`kline:${symbol}:${interval}`, { method: 'sub.kline', param: { symbol, interval } });
    }
  }

  /** Unsubscribe from futures candlestick streams for one or more symbols. */
  unsubscribeCandlesticks(symbols: string | string[], interval: KlineInterval): void {
    for (const symbol of toArray(symbols).map(toFuturesSymbol)) {
      this.removeSub(`kline:${symbol}:${interval}`);
    }
  }

  /**
   * Enable the private order stream. Logs in with apiKey/apiSecret; after a
   * successful login MEXC auto-pushes `push.personal.order`, surfaced as `order`
   * events. Requires apiKey/apiSecret in the constructor options.
   */
  subscribeOrders(): void {
    if (!this.apiKey || !this.apiSecret) {
      throw new Error('apiKey and apiSecret are required for the private order stream');
    }
    this.wantPrivate = true;
    if (this.isOpen()) {
      this.login();
    } else if (!this.ws) {
      this.connect();
    }
  }

  private login(): void {
    if (!this.apiKey || !this.apiSecret) {
      return;
    }
    const reqTime = Date.now().toString();
    const signature = crypto
      .createHmac('sha256', this.apiSecret)
      .update(this.apiKey + reqTime)
      .digest('hex');
    this.send({ method: 'login', param: { apiKey: this.apiKey, reqTime, signature } });
  }

  private addSub(key: string, msg: SubMessage): void {
    if (this.subscriptions.has(key)) {
      return;
    }
    this.subscriptions.set(key, msg);
    if (this.isOpen()) {
      this.send(msg);
    } else if (this.wantConnected && !this.ws) {
      this.openSocket();
    }
  }

  private removeSub(key: string): void {
    const msg = this.subscriptions.get(key);
    if (!msg) {
      return;
    }
    this.subscriptions.delete(key);
    if (this.isOpen()) {
      this.send({ method: msg.method.replace('sub.', 'unsub.'), param: msg.param });
    }
  }

  /** Gracefully close and stop reconnecting. */
  close(): void {
    this.shutdown();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /** Force-kill the socket and stop reconnecting. */
  terminate(): void {
    this.shutdown();
    if (this.ws) {
      this.ws.terminate();
      this.ws = null;
    }
  }

  private shutdown(): void {
    this.wantConnected = false;
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
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
    this.stopPing();
    this.pingTimer = setInterval(() => this.send({ method: 'ping' }), this.pingInterval);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error(`[mexc-futures-ws] gave up after ${this.reconnectAttempts} reconnect attempts`);
      this.wantConnected = false;
      this.emit('reconnectFailed', this.reconnectAttempts);
      return;
    }
    this.reconnectAttempts += 1;
    const delay = backoffDelay(this.reconnectAttempts, this.reconnectDelay, this.maxReconnectDelay);
    this.emit('reconnecting', this.reconnectAttempts);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }
}

function toArray(value: string | string[]): string[] {
  return Array.isArray(value) ? value : [value];
}
