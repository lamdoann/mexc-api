export { MexcRestClient } from './rest/MexcRestClient';
export { BaseRestClient, DEFAULT_REST_BASE_URL } from './rest/BaseRestClient';
export type { RequestParams } from './rest/BaseRestClient';
export {
  MexcWebsocketClient,
  DEFAULT_WS_URL,
  spotTradesChannel,
  spotAggreTradesChannel,
  spotKlineChannel,
  PRIVATE_ORDERS_CHANNEL,
  PRIVATE_DEALS_CHANNEL,
  PRIVATE_ACCOUNT_CHANNEL,
} from './websocket/MexcWebsocketClient';
export {
  MexcSpotTradeStream,
  MAX_SUBSCRIPTIONS_PER_CONNECTION,
} from './websocket/MexcSpotTradeStream';
export type { TradeStreamPoolOptions } from './websocket/MexcSpotTradeStream';
export { decodePushData } from './websocket/proto';
export { DefaultLogger, SilentLogger } from './util/logger';
export type { Logger } from './util/logger';

export type { RestClientOptions, ExchangeInfoRequest } from './types/request';
export type {
  ExchangeInfo,
  SymbolInfo,
  SymbolFilter,
  RateLimit,
} from './types/spot';
export type { AccountInformation, AccountBalance } from './types/account';
export type {
  OrderSide,
  OrderType,
  NewOrderRequest,
  NewOrderResponse,
  CancelOrderRequest,
  QueryOrderRequest,
  SpotOrder,
  ListenKeyResponse,
} from './types/order';
export type {
  WsClientOptions,
  AggreDealsInterval,
  KlineInterval,
  TradeSide,
  MexcTrade,
  MexcKline,
  SpotKlineBody,
  DecodedPushData,
  WsControlMessage,
  PrivateOrderBody,
  PrivateDealBody,
  PrivateAccountBody,
  MexcOrderUpdate,
  MexcExecutionUpdate,
  MexcBalanceUpdate,
} from './types/websocket';
