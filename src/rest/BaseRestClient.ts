import crypto from 'crypto';
import axios, { AxiosInstance, AxiosError, Method } from 'axios';
import type { RestClientOptions } from '../types/request';

export const DEFAULT_REST_BASE_URL = 'https://api.mexc.com';

export type RequestParams = Record<string, string | number | boolean | undefined>;

/**
 * Thin axios wrapper for the MEXC Spot V3 REST API.
 *
 * Public endpoints are unsigned (`get`). Private endpoints require an API key +
 * secret and an HMAC SHA256 signature over the request's query string
 * (`requestSigned`). MEXC sends all signed parameters in the query string —
 * including for POST/DELETE — so signing is uniform across HTTP methods.
 */
export class BaseRestClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly apiSecret?: string;
  private readonly recvWindow: number;
  private readonly axiosInstance: AxiosInstance;

  constructor(options: RestClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_REST_BASE_URL;
    this.apiKey = options.apiKey;
    this.apiSecret = options.apiSecret;
    this.recvWindow = options.recvWindow ?? 5000;
    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      timeout: options.timeout ?? 10000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /** Unsigned (public) GET. */
  protected async get<T>(endpoint: string, params?: RequestParams): Promise<T> {
    try {
      const response = await this.axiosInstance.get<T>(endpoint, {
        params: clean(params),
      });
      return response.data;
    } catch (e) {
      throw this.normaliseError(e);
    }
  }

  /** Signed (private) request. Adds timestamp + recvWindow, signs, and sends the API key header. */
  protected async requestSigned<T>(
    method: Method,
    endpoint: string,
    params: RequestParams = {},
  ): Promise<T> {
    if (!this.apiKey || !this.apiSecret) {
      throw new Error('apiKey and apiSecret are required for signed (private) endpoints');
    }

    const query = this.buildSignedQuery(params);
    try {
      const response = await this.axiosInstance.request<T>({
        method,
        url: `${endpoint}?${query}`,
        headers: { 'X-MEXC-APIKEY': this.apiKey },
      });
      return response.data;
    } catch (e) {
      throw this.normaliseError(e);
    }
  }

  /**
   * Low-level request with caller-supplied headers/body. Used by market-specific
   * signing (e.g. the contract API, whose auth scheme differs from spot).
   */
  protected async request<T>(config: {
    method: Method;
    url: string;
    params?: RequestParams;
    data?: unknown;
    headers?: Record<string, string>;
  }): Promise<T> {
    try {
      const response = await this.axiosInstance.request<T>({
        method: config.method,
        url: config.url,
        params: clean(config.params),
        data: config.data,
        headers: config.headers,
      });
      return response.data;
    } catch (e) {
      throw this.normaliseError(e);
    }
  }

  // --- Generic escape hatches for endpoints without a dedicated method ---

  /** Call any public (unsigned) GET endpoint. */
  publicGet<T = unknown>(endpoint: string, params?: RequestParams): Promise<T> {
    return this.get<T>(endpoint, params);
  }

  /** Call any private (signed) endpoint with a custom HTTP method. */
  privateRequest<T = unknown>(
    method: Method,
    endpoint: string,
    params?: RequestParams,
  ): Promise<T> {
    return this.requestSigned<T>(method, endpoint, params);
  }

  /** Call any private (signed) GET endpoint. */
  privateGet<T = unknown>(endpoint: string, params?: RequestParams): Promise<T> {
    return this.requestSigned<T>('GET', endpoint, params);
  }

  /** Call any private (signed) POST endpoint. */
  privatePost<T = unknown>(endpoint: string, params?: RequestParams): Promise<T> {
    return this.requestSigned<T>('POST', endpoint, params);
  }

  /** Call any private (signed) PUT endpoint. */
  privatePut<T = unknown>(endpoint: string, params?: RequestParams): Promise<T> {
    return this.requestSigned<T>('PUT', endpoint, params);
  }

  /** Call any private (signed) DELETE endpoint. */
  privateDelete<T = unknown>(endpoint: string, params?: RequestParams): Promise<T> {
    return this.requestSigned<T>('DELETE', endpoint, params);
  }

  private buildSignedQuery(params: RequestParams): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        search.append(key, String(value));
      }
    }
    search.append('recvWindow', String(this.recvWindow));
    search.append('timestamp', String(Date.now()));

    const queryString = search.toString();
    const signature = crypto
      .createHmac('sha256', this.apiSecret as string)
      .update(queryString)
      .digest('hex');

    return `${queryString}&signature=${signature}`;
  }

  private normaliseError(e: unknown): Error {
    const err = e as AxiosError<{ code?: number; msg?: string }>;
    if (err.response?.data) {
      const { code, msg } = err.response.data;
      return new Error(`MEXC API error ${code ?? err.response.status}: ${msg ?? err.message}`);
    }
    return err instanceof Error ? err : new Error(String(e));
  }
}

function clean(params?: RequestParams): RequestParams | undefined {
  if (!params) {
    return undefined;
  }
  const out: RequestParams = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}
