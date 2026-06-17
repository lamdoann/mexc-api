import { BaseRestClient } from './BaseRestClient';
import type { RestClientOptions } from '../types/request';
import type { FuturesApiResponse, FuturesContract } from '../types/futures';

export const DEFAULT_FUTURES_REST_BASE_URL = 'https://contract.mexc.com';

/**
 * REST client for the MEXC **Futures (contract)** API. Separate base URL and
 * response envelope (`{ success, code, data }`) from spot.
 *
 * @example
 * const fut = new MexcFuturesRestClient();
 * const contracts = await fut.fetchContracts();
 */
export class MexcFuturesRestClient extends BaseRestClient {
  constructor(options: RestClientOptions = {}) {
    super({ ...options, baseUrl: options.baseUrl ?? DEFAULT_FUTURES_REST_BASE_URL });
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
}
