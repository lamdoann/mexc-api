/** A single filter entry on a symbol (shape varies by filter type). */
export interface SymbolFilter {
  filterType: string;
  [key: string]: unknown;
}

/** Per-symbol metadata returned by GET /api/v3/exchangeInfo. */
export interface SymbolInfo {
  symbol: string;
  status: string;
  baseAsset: string;
  baseAssetPrecision: number;
  quoteAsset: string;
  quotePrecision: number;
  quoteAssetPrecision: number;
  baseCommissionPrecision: number;
  quoteCommissionPrecision: number;
  orderTypes: string[];
  isSpotTradingAllowed: boolean;
  isMarginTradingAllowed: boolean;
  quoteAmountPrecision: string;
  baseSizePrecision: string;
  permissions: string[];
  filters: SymbolFilter[];
  maxQuoteAmount: string;
  makerCommission: string;
  takerCommission: string;
  quoteAmountPrecisionMarket: string;
  maxQuoteAmountMarket: string;
  fullName: string;
  contractAddress?: string;
  tradeSideType?: number;
  [key: string]: unknown;
}

export interface RateLimit {
  rateLimitType: string;
  interval: string;
  intervalNum: number;
  limit: number;
}

/** Response shape of GET /api/v3/exchangeInfo. */
export interface ExchangeInfo {
  timezone: string;
  serverTime: number;
  rateLimits: RateLimit[];
  exchangeFilters: unknown[];
  symbols: SymbolInfo[];
}
