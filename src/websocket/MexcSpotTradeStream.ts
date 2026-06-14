import { EventEmitter } from 'events';
import { MexcWebsocketClient } from './MexcWebsocketClient';
import { DefaultLogger, Logger } from '../util/logger';
import type { AggreDealsInterval, MexcTrade, WsClientOptions } from '../types/websocket';

/** MEXC hard limit: 30 subscriptions per connection. */
export const MAX_SUBSCRIPTIONS_PER_CONNECTION = 30;

export interface TradeStreamPoolOptions extends WsClientOptions {
  /** Subscriptions per connection. Capped at MEXC's limit of 30. */
  maxPerConnection?: number;
  /** Aggregation window for the deals channel. Defaults to '100ms'. */
  interval?: AggreDealsInterval;
  /** Delay (ms) between opening successive connections, to avoid resets/rate-limits. Defaults to 300. */
  connectStagger?: number;
}

export declare interface MexcSpotTradeStream {
  on(event: 'trade', listener: (trade: MexcTrade) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  /** A subscription the server refused (delisted symbol, blocked, or over limit). */
  on(event: 'rejected', listener: (msg: string) => void): this;
  /** A backing connection opened. Payload is the 1-based connection index. */
  on(event: 'connectionOpen', listener: (index: number) => void): this;
}

/**
 * Fans spot trade subscriptions across a pool of {@link MexcWebsocketClient}
 * connections so you can stream far more symbols than the 30-per-connection
 * limit allows (e.g. every USDT pair). Symbols are sharded into groups of
 * `maxPerConnection`, each handled by its own auto-reconnecting socket, and all
 * `trade` events are re-emitted from this single emitter.
 *
 * @example
 * const stream = new MexcSpotTradeStream();
 * stream.on('trade', (t) => console.log(t.symbol, t.side, t.price));
 * stream.subscribe(allUsdtSymbols); // 1900+ symbols across ~64 connections
 */
export class MexcSpotTradeStream extends EventEmitter {
  private readonly maxPerConnection: number;
  private readonly interval: AggreDealsInterval;
  private readonly connectStagger: number;
  private readonly wsOptions: WsClientOptions;
  private readonly logger: Logger;
  private readonly clients: MexcWebsocketClient[] = [];
  private readonly timers: NodeJS.Timeout[] = [];

  constructor(options: TradeStreamPoolOptions = {}) {
    super();
    const { maxPerConnection, interval, connectStagger, logger, ...wsOptions } = options;
    this.maxPerConnection = Math.min(
      maxPerConnection ?? MAX_SUBSCRIPTIONS_PER_CONNECTION,
      MAX_SUBSCRIPTIONS_PER_CONNECTION,
    );
    this.interval = interval ?? '100ms';
    this.connectStagger = connectStagger ?? 300;
    this.logger = logger ?? DefaultLogger;
    this.wsOptions = wsOptions;
  }

  /** Number of backing connections currently created. */
  get connectionCount(): number {
    return this.clients.length;
  }

  /**
   * Subscribe to trade streams for the given symbols, sharding across as many
   * connections as needed. Connections are opened with a stagger to stay within
   * MEXC's connection rate limits.
   */
  subscribe(symbols: string[]): void {
    const unique = [...new Set(symbols.map((s) => s.toUpperCase()))];
    const groups = chunk(unique, this.maxPerConnection);
    this.logger.info(
      `[mexc-pool] subscribing ${unique.length} symbols across ${groups.length} connections`,
    );

    groups.forEach((group, index) => {
      const timer = setTimeout(() => this.addConnection(group, index + 1), index * this.connectStagger);
      this.timers.push(timer);
    });
  }

  private addConnection(symbols: string[], index: number): void {
    const client = new MexcWebsocketClient({ ...this.wsOptions, logger: this.logger });

    client.on('trade', (trade) => this.emit('trade', trade));
    client.on('error', (err) => this.emit('error', err));
    client.on('open', () => this.emit('connectionOpen', index));
    client.on('response', (msg) => {
      const text = typeof msg?.msg === 'string' ? msg.msg : '';
      if (/not subscribed|blocked|exceeded/i.test(text)) {
        this.emit('rejected', text);
      }
    });

    client.connect();
    client.subscribeSpotTrades(symbols, this.interval);
    this.clients.push(client);
  }

  /** Gracefully close every connection and cancel any pending opens. */
  close(): void {
    this.teardown((c) => c.close());
  }

  /** Force-kill every connection (no close handshake) and cancel any pending opens. */
  terminate(): void {
    this.teardown((c) => c.terminate());
  }

  private teardown(stop: (client: MexcWebsocketClient) => void): void {
    this.timers.forEach(clearTimeout);
    this.timers.length = 0;
    this.clients.forEach(stop);
    this.clients.length = 0;
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
