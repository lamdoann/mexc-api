export { MexcRestClient } from './rest/MexcRestClient';
export { BaseRestClient, DEFAULT_REST_BASE_URL, DEFAULT_USER_AGENT } from './rest/BaseRestClient';
export type { RequestParams } from './rest/BaseRestClient';
export {
  MexcFuturesRestClient,
  DEFAULT_FUTURES_REST_BASE_URL,
} from './rest/MexcFuturesRestClient';
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
  MexcFuturesWebsocketClient,
  DEFAULT_FUTURES_WS_URL,
  toFuturesSymbol,
} from './websocket/MexcFuturesWebsocketClient';
export {
  MexcTradeStreamPool,
  MexcSpotTradeStream,
  MAX_SUBSCRIPTIONS_PER_CONNECTION,
  DEFAULT_FUTURES_PER_CONNECTION,
} from './websocket/MexcTradeStreamPool';
export type { TradeStreamPoolOptions } from './websocket/MexcTradeStreamPool';
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
  FuturesContract,
  FuturesApiResponse,
  FuturesOrderSide,
  FuturesOrderType,
  FuturesOpenType,
  NewFuturesOrderRequest,
  ModifyOrderRequest,
  ModifyOrderTpSlRequest,
  ModifyPlanOrderTpSlRequest,
  FuturesAccountAsset,
  FuturesPosition,
  MarginAdjustType,
  ChangeMarginRequest,
  ChangeLeverageRequest,
  TransferRecordQuery,
  PositionHistoryQuery,
  FundingRecordsQuery,
} from './types/futures';
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
  MarketType,
  TradeSide,
  MexcTrade,
  MexcKline,
  MexcFuturesKline,
  MexcFuturesOrder,
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
