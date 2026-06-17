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
}
