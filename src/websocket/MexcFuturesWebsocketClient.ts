import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { DefaultLogger, Logger } from '../util/logger';
import type { MexcTrade, WsClientOptions } from '../types/websocket';

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

export declare interface MexcFuturesWebsocketClient {
  on(event: 'open', listener: () => void): this;
  on(event: 'close', listener: (code: number, reason: string) => void): this;
  on(event: 'reconnecting', listener: () => void): this;
  on(event: 'reconnected', listener: () => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  /** Raw JSON control/data frame. */
  on(event: 'response', listener: (msg: Record<string, unknown>) => void): this;
  /** One normalised trade per deal item. */
  on(event: 'trade', listener: (trade: MexcTrade) => void): this;
}

/**
 * WebSocket client for MEXC **Futures (contract)** public trade streams.
 *
 * Unlike spot, the futures feed at `wss://contract.mexc.com/edge` is plain JSON:
 * subscribe with `{ method: 'sub.deal', param: { symbol } }`, keepalive with
 * `{ method: 'ping' }`, and trades arrive on the `push.deal` channel. Symbols use
 * the `BTC_USDT` form (auto-converted from `BTCUSDT`).
 */
export class MexcFuturesWebsocketClient extends EventEmitter {
  private readonly wsUrl: string;
  private readonly pingInterval: number;
  private readonly reconnectDelay: number;
  private readonly logger: Logger;

  private ws: WebSocket | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;

  private readonly subscriptions = new Set<string>();
  private wantConnected = false;

  constructor(options: WsClientOptions = {}) {
    super();
    this.wsUrl = options.wsUrl ?? DEFAULT_FUTURES_WS_URL;
    this.pingInterval = options.pingInterval ?? 15000;
    this.reconnectDelay = options.reconnectDelay ?? 2000;
    this.logger = options.logger ?? DefaultLogger;
  }

  /** Open the connection. Subscriptions can be added before or after. */
  connect(): void {
    this.wantConnected = true;
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
      this.startPing();
      this.subscriptions.forEach((symbol) => this.sendSub(symbol));
      this.emit('open');
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

    if (msg.channel === 'push.deal') {
      this.emitTrades(msg);
    }
  }

  private emitTrades(msg: Record<string, unknown>): void {
    const symbol = String(msg.symbol ?? '');
    const deals = Array.isArray(msg.data) ? (msg.data as FuturesDealItem[]) : [msg.data as FuturesDealItem];
    for (const deal of deals) {
      if (!deal) {
        continue;
      }
      const trade: MexcTrade = {
        market: 'future',
        symbol,
        channel: 'push.deal',
        price: String(deal.p),
        quantity: String(deal.v),
        side: deal.T === 2 ? 'sell' : 'buy',
        tradeType: deal.T,
        time: deal.t,
        tradeId: deal.i,
      };
      this.emit('trade', trade);
    }
  }

  /** Subscribe to futures trade streams for one or more symbols. */
  subscribeTrades(symbols: string | string[]): void {
    const list = toArray(symbols).map(toFuturesSymbol);
    const fresh = list.filter((s) => !this.subscriptions.has(s));
    fresh.forEach((s) => this.subscriptions.add(s));
    if (fresh.length === 0) {
      return;
    }
    if (this.isOpen()) {
      fresh.forEach((s) => this.sendSub(s));
    } else if (this.wantConnected && !this.ws) {
      this.openSocket();
    }
  }

  /** Unsubscribe from futures trade streams for one or more symbols. */
  unsubscribeTrades(symbols: string | string[]): void {
    const list = toArray(symbols).map(toFuturesSymbol);
    list.forEach((s) => this.subscriptions.delete(s));
    if (this.isOpen()) {
      list.forEach((s) => this.send({ method: 'unsub.deal', param: { symbol: s } }));
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

  private sendSub(symbol: string): void {
    this.send({ method: 'sub.deal', param: { symbol } });
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
