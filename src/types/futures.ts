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

import type { KlineInterval } from './websocket';

/** A futures ticker (GET /api/v1/contract/ticker). */
export interface FuturesTicker {
  contractId: number;
  symbol: string;
  lastPrice: number;
  bid1: number;
  ask1: number;
  volume24: number;
  amount24: number;
  holdVol: number;
  lower24Price: number;
  high24Price: number;
  riseFallRate: number;
  riseFallValue: number;
  indexPrice: number;
  fairPrice: number;
  fundingRate: number;
  timestamp: number;
  [key: string]: unknown;
}

/** Column-oriented kline data (GET /api/v1/contract/kline/{symbol}). */
export interface FuturesKlineData {
  /** Window start times, in seconds. */
  time: number[];
  open: number[];
  close: number[];
  high: number[];
  low: number[];
  vol: number[];
  amount: number[];
  realOpen: number[];
  realClose: number[];
  realHigh: number[];
  realLow: number[];
}

export interface FuturesKlineRequest {
  interval: KlineInterval;
  /** Start time, seconds. */
  start?: number;
  /** End time, seconds. */
  end?: number;
}

/** An open futures order (GET /api/v1/private/order/list/open_orders). */
export interface FuturesOpenOrder {
  orderId: number | string;
  symbol: string;
  price: number | string;
  vol: number | string;
  side: number;
  state: number;
  orderType: number;
  category?: number;
  leverage?: number;
  dealAvgPrice?: number | string;
  dealVol?: number | string;
  remainVol?: number | string;
  externalOid?: string;
  createTime?: number;
  updateTime?: number;
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

/** 1 limit, 2 post-only, 3 IOC, 4 FOK, 5 market. */
export type FuturesOrderType = 1 | 2 | 3 | 4 | 5;

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

/** Amend a live limit order's price and quantity (order/change_limit_order). */
export interface ModifyOrderRequest {
  orderId: number | string;
  price: number;
  vol: number;
}

/** Modify the SL/TP attached to a limit order (stoporder/change_price). */
export interface ModifyOrderTpSlRequest {
  orderId: number | string;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  /** SL reference price: 1 latest, 2 fair, 3 index. */
  lossTrend?: number;
  /** TP reference price: 1 latest, 2 fair, 3 index. */
  profitTrend?: number;
}

/** Modify the SL/TP on a plan (trigger) order (planorder/change_stop_order). */
export interface ModifyPlanOrderTpSlRequest {
  symbol: string;
  orderId: number | string;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  lossTrend?: number;
  profitTrend?: number;
}

// --- Account & positions ---

/** A futures wallet asset (account/assets). */
export interface FuturesAccountAsset {
  currency: string;
  positionMargin: number;
  availableBalance: number;
  cashBalance: number;
  frozenBalance: number;
  equity: number;
  unrealized: number;
  bonus: number;
  availableCash?: number;
  availableOpen?: number;
  [key: string]: unknown;
}

/** A futures position (position/open_positions). */
export interface FuturesPosition {
  positionId: number;
  symbol: string;
  holdVol: number;
  /** 1 long, 2 short. */
  positionType: number;
  /** 1 isolated, 2 cross. */
  openType: number;
  /** 1 holding, 2 system-held, 3 closed. */
  state: number;
  leverage: number;
  holdAvgPrice: number;
  liquidatePrice: number;
  unrealized?: number;
  realised?: number;
  [key: string]: unknown;
}

export type MarginAdjustType = 'ADD' | 'SUB';

/** Add/reduce margin on a position (position/change_margin). */
export interface ChangeMarginRequest {
  positionId: number | string;
  amount: number;
  type: MarginAdjustType;
}

/** Change leverage (position/change_leverage). */
export interface ChangeLeverageRequest {
  /** Existing position id (when adjusting a live position). */
  positionId?: number | string;
  leverage: number;
  /** 1 isolated, 2 cross — required when no positionId. */
  openType?: FuturesOpenType;
  /** Required when no positionId. */
  symbol?: string;
  /** 1 long, 2 short — required when no positionId. */
  positionType?: number;
}

export interface TransferRecordQuery {
  currency?: string;
  state?: 'WAIT' | 'SUCCESS' | 'FAILED';
  type?: 'IN' | 'OUT';
  page_num?: number;
  page_size?: number;
}

export interface PositionHistoryQuery {
  symbol?: string;
  type?: number;
  page_num?: number;
  page_size?: number;
  start_time?: number;
  end_time?: number;
}

export interface FundingRecordsQuery {
  symbol?: string;
  position_id?: number;
  page_num?: number;
  page_size?: number;
}
