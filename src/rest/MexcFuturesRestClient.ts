import crypto from 'crypto';
import { Method } from 'axios';
import { BaseRestClient, RequestParams } from './BaseRestClient';
import type { RestClientOptions } from '../types/request';
import type {
  ChangeOrderPriceRequest,
  ChangeTriggerPriceRequest,
  FuturesApiResponse,
  FuturesContract,
  NewFuturesOrderRequest,
} from '../types/futures';

export const DEFAULT_FUTURES_REST_BASE_URL = 'https://contract.mexc.com';

/**
 * REST client for the MEXC **Futures (contract)** API. Separate base URL and
 * response envelope (`{ success, code, data }`) from spot, and a different
 * signing scheme: `ApiKey` / `Request-Time` / `Signature` headers, signing
 * `accessKey + reqTime + paramStr` (sorted query for GET, JSON body for POST).
 *
 * ⚠️ MEXC has temporarily closed the **place/cancel order** endpoints for normal
 * API accounts since 2022-07 (only whitelisted market makers may use them). The
 * order methods here follow the spec but may return a maintenance error.
 *
 * @example
 * const fut = new MexcFuturesRestClient({ apiKey, apiSecret });
 * const contracts = await fut.fetchContracts();
 */
export class MexcFuturesRestClient extends BaseRestClient {
  private readonly accessKey?: string;
  private readonly secretKey?: string;
  private readonly contractRecvWindow: number;

  constructor(options: RestClientOptions = {}) {
    super({ ...options, baseUrl: options.baseUrl ?? DEFAULT_FUTURES_REST_BASE_URL });
    this.accessKey = options.apiKey;
    this.secretKey = options.apiSecret;
    this.contractRecvWindow = options.recvWindow ?? 60;
  }

  /**
   * All futures contracts (or a single one). GET /api/v1/contract/detail.
   * Returns the unwrapped contract list.
   */
  async fetchContracts(symbol?: string): Promise<FuturesContract[]> {
    const res = await this.publicGet<FuturesApiResponse<FuturesContract[]>>(
      '/api/v1/contract/detail',
      symbol ? { symbol } : undefined,
    );
    if (!res.success) {
      throw new Error(`MEXC futures API error ${res.code}`);
    }
    return res.data;
  }

  // --- Trading (signed) — see the maintenance note in the class docs ---

  /** Place an order. POST /api/v1/private/order/submit. */
  placeOrder<T = unknown>(params: NewFuturesOrderRequest): Promise<T> {
    return this.signedPost<T>('/api/v1/private/order/submit', params);
  }

  /** Place up to 50 orders at once. POST /api/v1/private/order/submit_batch. */
  placeBatchOrders<T = unknown>(orders: NewFuturesOrderRequest[]): Promise<T> {
    return this.signedPost<T>('/api/v1/private/order/submit_batch', orders);
  }

  /** Cancel orders by id (max 50). POST /api/v1/private/order/cancel. */
  cancelOrders<T = unknown>(orderIds: Array<number | string>): Promise<T> {
    return this.signedPost<T>('/api/v1/private/order/cancel', orderIds);
  }

  /** Cancel an order by its client id. POST /api/v1/private/order/cancel_with_external. */
  cancelOrderByExternalId<T = unknown>(symbol: string, externalOid: string): Promise<T> {
    return this.signedPost<T>('/api/v1/private/order/cancel_with_external', { symbol, externalOid });
  }

  /** Cancel all orders (optionally for one symbol). POST /api/v1/private/order/cancel_all. */
  cancelAllOrders<T = unknown>(symbol?: string): Promise<T> {
    return this.signedPost<T>('/api/v1/private/order/cancel_all', symbol ? { symbol } : {});
  }

  /**
   * Modify the SL/TP attached to an existing order.
   * POST /api/v1/private/stoporder/change_price.
   *
   * Note: MEXC futures has no plain "amend limit price" — to change a limit
   * order's price, cancel and re-place it.
   */
  changeOrderPrice<T = unknown>(params: ChangeOrderPriceRequest): Promise<T> {
    return this.signedPost<T>('/api/v1/private/stoporder/change_price', params);
  }

  /**
   * Modify the trigger price of a plan (stop-limit) order.
   * POST /api/v1/private/stoporder/change_plan_price.
   */
  changeTriggerPrice<T = unknown>(params: ChangeTriggerPriceRequest): Promise<T> {
    return this.signedPost<T>('/api/v1/private/stoporder/change_plan_price', params);
  }

  // --- Generic escape hatches (override spot signing with futures signing) ---

  /** Call any signed futures GET endpoint (e.g. open orders, positions). */
  privateGet<T = unknown>(endpoint: string, params?: RequestParams): Promise<T> {
    return this.signedGet<T>(endpoint, params);
  }

  /** Call any signed futures POST endpoint. */
  privatePost<T = unknown>(endpoint: string, params?: RequestParams): Promise<T> {
    return this.signedPost<T>(endpoint, params ?? {});
  }

  /** Call any signed futures endpoint (GET or POST). */
  privateRequest<T = unknown>(method: Method, endpoint: string, params?: RequestParams): Promise<T> {
    const m = String(method).toUpperCase();
    if (m === 'GET') {
      return this.signedGet<T>(endpoint, params);
    }
    if (m === 'POST') {
      return this.signedPost<T>(endpoint, params ?? {});
    }
    throw new Error(`Unsupported futures method: ${method}`);
  }

  // --- Signing ---

  /** Signed POST (body is JSON; signature covers the exact JSON string sent). */
  private async signedPost<T>(endpoint: string, params: unknown): Promise<T> {
    const reqTime = Date.now().toString();
    const body = JSON.stringify(params ?? {});
    const res = await this.request<FuturesApiResponse<T>>({
      method: 'POST',
      url: endpoint,
      data: body,
      headers: this.authHeaders(reqTime, body),
    });
    return this.unwrap(res);
  }

  /** Signed GET (params sorted alphabetically into the query string). */
  private async signedGet<T>(endpoint: string, params: RequestParams = {}): Promise<T> {
    const reqTime = Date.now().toString();
    const query = Object.keys(params)
      .filter((k) => params[k] !== undefined)
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join('&');
    const url = query ? `${endpoint}?${query}` : endpoint;
    const res = await this.request<FuturesApiResponse<T>>({
      method: 'GET' as Method,
      url,
      headers: this.authHeaders(reqTime, query),
    });
    return this.unwrap(res);
  }

  private authHeaders(reqTime: string, paramStr: string): Record<string, string> {
    if (!this.accessKey || !this.secretKey) {
      throw new Error('apiKey and apiSecret are required for signed futures endpoints');
    }
    const signature = crypto
      .createHmac('sha256', this.secretKey)
      .update(this.accessKey + reqTime + paramStr)
      .digest('hex');
    return {
      ApiKey: this.accessKey,
      'Request-Time': reqTime,
      'Recv-Window': String(this.contractRecvWindow),
      Signature: signature,
      'Content-Type': 'application/json',
    };
  }

  private unwrap<T>(res: FuturesApiResponse<T>): T {
    if (!res.success) {
      throw new Error(`MEXC futures API error ${res.code}: ${res.message ?? ''}`.trim());
    }
    return res.data;
  }
}
