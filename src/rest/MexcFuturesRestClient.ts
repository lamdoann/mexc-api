import crypto from 'crypto';
import { Method } from 'axios';
import { BaseRestClient, RequestParams } from './BaseRestClient';
import type { RestClientOptions } from '../types/request';
import type {
  ModifyOrderRequest,
  ModifyOrderTpSlRequest,
  ModifyPlanOrderTpSlRequest,
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
 * Futures trading endpoints are open via the API. Your account still needs
 * contract/futures API permission enabled. Note the contract host is fronted by
 * Akamai, which blocks the private order paths when the User-Agent is `axios/*`;
 * the shared {@link BaseRestClient} sets a non-axios User-Agent so requests get
 * through (see DEFAULT_USER_AGENT).
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

  /** Place an order. POST /api/v1/private/order/create. */
  placeOrder<T = unknown>(params: NewFuturesOrderRequest): Promise<T> {
    return this.signedPost<T>('/api/v1/private/order/create', params);
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
   * Amend a live limit order's price and quantity.
   * POST /api/v1/private/order/change_limit_order.
   */
  modifyOrder<T = unknown>(params: ModifyOrderRequest): Promise<T> {
    return this.signedPost<T>('/api/v1/private/order/change_limit_order', params);
  }

  /**
   * Modify the SL/TP attached to a limit order.
   * POST /api/v1/private/stoporder/change_price.
   */
  modifyOrderTpSl<T = unknown>(params: ModifyOrderTpSlRequest): Promise<T> {
    return this.signedPost<T>('/api/v1/private/stoporder/change_price', params);
  }

  /**
   * Modify the SL/TP on a plan (trigger) order.
   * POST /api/v1/private/planorder/change_stop_order.
   */
  modifyPlanOrderTpSl<T = unknown>(params: ModifyPlanOrderTpSlRequest): Promise<T> {
    return this.signedPost<T>('/api/v1/private/planorder/change_stop_order', params);
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
