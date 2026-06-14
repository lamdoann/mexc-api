export type OrderSide = 'BUY' | 'SELL';

export type OrderType =
  | 'LIMIT'
  | 'MARKET'
  | 'LIMIT_MAKER'
  | 'IMMEDIATE_OR_CANCEL'
  | 'FILL_OR_KILL';

export interface NewOrderRequest {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  /** Order quantity in base asset. Required for LIMIT; for MARKET use this or quoteOrderQty. */
  quantity?: number | string;
  /** Quote-asset amount (MARKET orders only). */
  quoteOrderQty?: number | string;
  /** Order price. Required for LIMIT / LIMIT_MAKER. */
  price?: number | string;
  /** Optional client-supplied order id. */
  newClientOrderId?: string;
}

export interface NewOrderResponse {
  symbol: string;
  orderId: string;
  orderListId?: number;
  price: string;
  origQty: string;
  type: string;
  side: string;
  transactTime: number;
}

export interface CancelOrderRequest {
  symbol: string;
  /** Cancel by exchange order id. */
  orderId?: string;
  /** Cancel by original client order id. */
  origClientOrderId?: string;
  newClientOrderId?: string;
}

export interface QueryOrderRequest {
  symbol: string;
  orderId?: string;
  origClientOrderId?: string;
}

export interface SpotOrder {
  symbol: string;
  orderId: string;
  orderListId: number;
  clientOrderId: string;
  price: string;
  origQty: string;
  executedQty: string;
  cummulativeQuoteQty: string;
  status: string;
  timeInForce: string;
  type: string;
  side: string;
  stopPrice: string;
  time: number;
  updateTime: number;
  isWorking: boolean;
  origQuoteOrderQty: string;
  [key: string]: unknown;
}

export interface ListenKeyResponse {
  listenKey: string;
}
