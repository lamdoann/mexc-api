import { EventEmitter } from 'events';
import { MexcWebsocketClient } from './MexcWebsocketClient';
import { MexcFuturesWebsocketClient } from './MexcFuturesWebsocketClient';
import { DefaultLogger, Logger } from '../util/logger';
import type {
  AggreDealsInterval,
  MarketType,
  MexcTrade,
  WsClientOptions,
} from '../types/websocket';

/** MEXC spot hard limit: 30 subscriptions per connection. */
export const MAX_SUBSCRIPTIONS_PER_CONNECTION = 30;
/** Futures has no strict per-connection cap; default to a moderate shard size. */
export const DEFAULT_FUTURES_PER_CONNECTION = 100;

export interface TradeStreamPoolOptions extends WsClientOptions {
  /** Which market to stream. Defaults to 'spot'. */
  market?: MarketType;
  /** Subscriptions per connection. Spot is capped at 30; futures defaults to 100. */
  maxPerConnection?: number;
  /** Spot only: aggregation window for the deals channel. Defaults to '100ms'. */
  interval?: AggreDealsInterval;
  /** Delay (ms) between opening successive connections, to avoid resets/rate-limits. Defaults to 300. */
  connectStagger?: number;
}

type PoolClient = MexcWebsocketClient | MexcFuturesWebsocketClient;

export declare interface MexcTradeStreamPool {
  on(event: 'trade', listener: (trade: MexcTrade) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  /** A subscription the server refused (delisted symbol, blocked, or over limit). */
  on(event: 'rejected', listener: (msg: string) => void): this;
  /** A backing connection opened. Payload is the 1-based connection index. */
  on(event: 'connectionOpen', listener: (index: number) => void): this;
}

/**
 * Fans trade subscriptions across a pool of connections so you can stream far
 * more symbols than a single connection allows (spot is capped at 30 per
 * connection). Works for both spot and futures — set `market` — and re-emits all
 * `trade` events from one place.
 *
 * @example
 * const pool = new MexcTradeStreamPool({ market: 'future' });
 * pool.on('trade', (t) => console.log(t.market, t.symbol, t.price));
 * pool.subscribe(allFuturesSymbols);
 */
export class MexcTradeStreamPool extends EventEmitter {
  private readonly market: MarketType;
  private readonly maxPerConnection: number;
  private readonly interval: AggreDealsInterval;
  private readonly connectStagger: number;
  private readonly wsOptions: WsClientOptions;
  private readonly logger: Logger;
  private readonly clients: PoolClient[] = [];
  private readonly timers: NodeJS.Timeout[] = [];

  constructor(options: TradeStreamPoolOptions = {}) {
    super();
    const { market, maxPerConnection, interval, connectStagger, logger, ...wsOptions } = options;
    this.market = market ?? 'spot';
    const isFuture = this.market === 'future';
    const requested = maxPerConnection ?? (isFuture ? DEFAULT_FUTURES_PER_CONNECTION : MAX_SUBSCRIPTIONS_PER_CONNECTION);
    // Spot is hard-capped at 30; futures is not.
    this.maxPerConnection = isFuture ? requested : Math.min(requested, MAX_SUBSCRIPTIONS_PER_CONNECTION);
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
   * connections as needed. Connections open with a stagger to stay within rate limits.
   */
  subscribe(symbols: string[]): void {
    const unique = [...new Set(symbols.map((s) => s.toUpperCase()))];
    const groups = chunk(unique, this.maxPerConnection);
    this.logger.info(
      `[mexc-pool] subscribing ${unique.length} ${this.market} symbols across ${groups.length} connections`,
    );

    groups.forEach((group, index) => {
      const timer = setTimeout(() => this.addConnection(group, index + 1), index * this.connectStagger);
      this.timers.push(timer);
    });
  }

  private addConnection(symbols: string[], index: number): void {
    const client =
      this.market === 'future'
        ? this.createFuturesClient(symbols, index)
        : this.createSpotClient(symbols, index);
    this.clients.push(client);
  }

  private createSpotClient(symbols: string[], index: number): MexcWebsocketClient {
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
    return client;
  }

  private createFuturesClient(symbols: string[], index: number): MexcFuturesWebsocketClient {
    const client = new MexcFuturesWebsocketClient({ ...this.wsOptions, logger: this.logger });
    client.on('trade', (trade) => this.emit('trade', trade));
    client.on('error', (err) => this.emit('error', err));
    client.on('open', () => this.emit('connectionOpen', index));
    client.on('response', (msg) => {
      if (msg?.channel === 'rs.sub.deal' && msg?.data !== 'success') {
        this.emit('rejected', JSON.stringify(msg));
      }
    });
    client.connect();
    client.subscribeTrades(symbols);
    return client;
  }

  /** Gracefully close every connection and cancel any pending opens. */
  close(): void {
    this.teardown((c) => c.close());
  }

  /** Force-kill every connection (no close handshake) and cancel any pending opens. */
  terminate(): void {
    this.teardown((c) => c.terminate());
  }

  private teardown(stop: (client: PoolClient) => void): void {
    this.timers.forEach(clearTimeout);
    this.timers.length = 0;
    this.clients.forEach(stop);
    this.clients.length = 0;
  }
}

/** @deprecated Use {@link MexcTradeStreamPool}. Kept as a spot-only alias. */
export class MexcSpotTradeStream extends MexcTradeStreamPool {
  constructor(options: Omit<TradeStreamPoolOptions, 'market'> = {}) {
    super({ ...options, market: 'spot' });
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
