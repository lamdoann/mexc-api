/** A futures (contract) market, from GET /api/v1/contract/detail. */
export interface FuturesContract {
  symbol: string;
  displayName: string;
  displayNameEn: string;
  baseCoin: string;
  quoteCoin: string;
  settleCoin: string;
  contractSize: number;
  minLeverage: number;
  maxLeverage: number;
  priceScale: number;
  volScale: number;
  amountScale: number;
  priceUnit: number;
  volUnit: number;
  minVol: number;
  maxVol: number;
  takerFeeRate: number;
  makerFeeRate: number;
  /** 0 = enabled, 1 = delivery, 2 = completed, 3 = offline, 4 = pause. */
  state: number;
  isNew: boolean;
  isHot: boolean;
  isHidden: boolean;
  apiAllowed: boolean;
  [key: string]: unknown;
}

/** Raw envelope returned by the MEXC contract API. */
export interface FuturesApiResponse<T> {
  success: boolean;
  code: number;
  data: T;
  message?: string;
}

/** Direction: 1 open long, 2 close short, 3 open short, 4 close long. */
export type FuturesOrderSide = 1 | 2 | 3 | 4;

/** 1 limit, 2 post-only, 3 IOC, 4 FOK, 5 market, 6 market→current price. */
export type FuturesOrderType = 1 | 2 | 3 | 4 | 5 | 6;

/** Margin mode: 1 isolated, 2 cross. */
export type FuturesOpenType = 1 | 2;

export interface NewFuturesOrderRequest {
  symbol: string;
  /** Required for non-market order types. */
  price?: number;
  /** Order volume, in contracts. */
  vol: number;
  side: FuturesOrderSide;
  type: FuturesOrderType;
  openType: FuturesOpenType;
  /** Required for isolated margin when opening a fresh position. */
  leverage?: number;
  /** Recommended when closing. */
  positionId?: number;
  /** Client order id (max 32 chars). */
  externalOid?: string;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  [key: string]: unknown;
}

/** Modify the SL/TP attached to an existing order. */
export interface ChangeOrderPriceRequest {
  orderId: number | string;
  stopLossPrice?: number;
  takeProfitPrice?: number;
}

/** Modify the trigger price of a plan (stop-limit) order. */
export interface ChangeTriggerPriceRequest {
  stopPlanOrderId: number | string;
  stopLossPrice?: number;
  takeProfitPrice?: number;
}
