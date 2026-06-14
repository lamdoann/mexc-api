import type { Logger } from '../util/logger';
import type { MexcRestClient } from '../rest/MexcRestClient';

export interface WsClientOptions {
  /** Override the websocket URL. Defaults to wss://wbs-api.mexc.com/ws */
  wsUrl?: string;
  /**
   * listenKey for private (user data) streams. Appended to the connect URL as
   * `?listenKey=...`. Usually you don't set this manually — call
   * `subscribeUserDataStream()`, which creates and keepalives a listenKey for you.
   */
  listenKey?: string;
  /** API key — enables the client to create/keepalive a listenKey for user data streams. */
  apiKey?: string;
  /** API secret — enables the client to create/keepalive a listenKey for user data streams. */
  apiSecret?: string;
  /** Provide a pre-configured REST client for listenKey management (overrides apiKey/apiSecret). */
  restClient?: MexcRestClient;
  /**
   * How often (ms) to keepalive a managed listenKey. Defaults to 1,800,000 (30 min).
   * MEXC expires a listenKey 60 min after the last keepalive.
   */
  listenKeyKeepAliveInterval?: number;
  /** Interval (ms) between client PING frames. Defaults to 20000. MEXC drops idle sockets after 60s. */
  pingInterval?: number;
  /** How long (ms) to wait for a PONG before treating the socket as dead. Defaults to 10000. */
  pongTimeout?: number;
  /** Delay (ms) before attempting to reconnect after a drop. Defaults to 2000. */
  reconnectDelay?: number;
  /** Custom logger. Defaults to console-based DefaultLogger. */
  logger?: Logger;
}

/** Aggregation window for the aggregated-deals trade channel. */
export type AggreDealsInterval = '10ms' | '100ms';

/** Candlestick (kline) interval accepted by MEXC spot streams. */
export type KlineInterval =
  | 'Min1'
  | 'Min5'
  | 'Min15'
  | 'Min30'
  | 'Min60'
  | 'Hour4'
  | 'Hour8'
  | 'Day1'
  | 'Week1'
  | 'Month1';

/** MEXC trade side: 1 = buy (taker bought), 2 = sell (taker sold). */
export type TradeSide = 'buy' | 'sell';

/** A single normalised trade, emitted on the `trade` event. */
export interface MexcTrade {
  /** Trading pair, e.g. "BTCUSDT". */
  symbol: string;
  /** Source channel, e.g. "spot@public.deals.v3.api.pb@BTCUSDT". */
  channel: string;
  price: string;
  quantity: string;
  /** Human-friendly side. */
  side: TradeSide;
  /** Raw MEXC trade type (1 buy, 2 sell). */
  tradeType: number;
  /** Trade timestamp (ms). */
  time: number;
  /** Server push time (ms), if present. */
  sendTime?: number;
}

interface DealsBody {
  eventType: string;
  deals: { price: string; quantity: string; tradeType: number; time: number }[];
}

/** Private order update body (spot@private.orders.v3.api.pb). */
export interface PrivateOrderBody {
  id: string;
  clientId: string;
  price: string;
  quantity: string;
  amount: string;
  avgPrice: string;
  orderType: number;
  tradeType: number;
  isMaker: boolean;
  remainAmount: string;
  remainQuantity: string;
  lastDealQuantity?: string;
  cumulativeQuantity: string;
  cumulativeAmount: string;
  status: number;
  createTime: number;
  [key: string]: unknown;
}

/** Private execution (fill) body (spot@private.deals.v3.api.pb). */
export interface PrivateDealBody {
  price: string;
  quantity: string;
  amount: string;
  tradeType: number;
  isMaker: boolean;
  isSelfTrade: boolean;
  tradeId: string;
  clientOrderId: string;
  orderId: string;
  feeAmount: string;
  feeCurrency: string;
  time: number;
}

/** Candlestick body (spot@public.kline.v3.api.pb). Timestamps are second-based. */
export interface SpotKlineBody {
  interval: string;
  windowStart: number;
  openingPrice: string;
  closingPrice: string;
  highestPrice: string;
  lowestPrice: string;
  volume: string;
  amount: string;
  windowEnd: number;
}

/** A normalised candlestick, emitted on `kline`. */
export interface MexcKline extends SpotKlineBody {
  symbol: string;
  channel: string;
  sendTime?: number;
}

/** Private account/balance update body (spot@private.account.v3.api.pb). */
export interface PrivateAccountBody {
  vcoinName: string;
  coinId: string;
  balanceAmount: string;
  balanceAmountChange: string;
  frozenAmount: string;
  frozenAmountChange: string;
  type: string;
  time: number;
}

/** Raw decoded protobuf push, emitted on the `message` event. */
export interface DecodedPushData {
  channel: string;
  symbol?: string;
  symbolId?: string;
  createTime?: number;
  sendTime?: number;
  publicDeals?: DealsBody;
  publicAggreDeals?: DealsBody;
  publicSpotKline?: SpotKlineBody;
  privateOrders?: PrivateOrderBody;
  privateDeals?: PrivateDealBody;
  privateAccount?: PrivateAccountBody;
}

/** A private order update with the symbol from the wrapper, emitted on `order`. */
export interface MexcOrderUpdate extends PrivateOrderBody {
  symbol: string;
  channel: string;
  sendTime?: number;
}

/** A private execution with the symbol from the wrapper, emitted on `execution`. */
export interface MexcExecutionUpdate extends PrivateDealBody {
  symbol: string;
  channel: string;
  sendTime?: number;
}

/** A private balance update, emitted on `balance`. */
export interface MexcBalanceUpdate extends PrivateAccountBody {
  channel: string;
  sendTime?: number;
}

/** JSON control message (subscription ack / PONG / error). */
export interface WsControlMessage {
  id?: number;
  code?: number;
  msg?: string;
}
