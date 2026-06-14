import { BaseRestClient, RequestParams } from './BaseRestClient';
import type { ExchangeInfoRequest } from '../types/request';
import type { ExchangeInfo } from '../types/spot';
import type { AccountInformation } from '../types/account';
import type {
  CancelOrderRequest,
  ListenKeyResponse,
  NewOrderRequest,
  NewOrderResponse,
  QueryOrderRequest,
  SpotOrder,
} from '../types/order';

/**
 * REST client for the MEXC Spot V3 API.
 *
 * @example
 * // Public usage
 * const client = new MexcRestClient();
 * const info = await client.fetchExchangeInfo({ symbol: 'BTCUSDT' });
 *
 * @example
 * // Private (signed) usage
 * const client = new MexcRestClient({ apiKey: '...', apiSecret: '...' });
 * const account = await client.getAccountInformation();
 */
export class MexcRestClient extends BaseRestClient {
  /**
   * Current exchange trading rules and symbol information.
   * GET /api/v3/exchangeInfo
   *
   * - No params: returns every symbol.
   * - `symbol`: a single trading pair.
   * - `symbols`: a list of trading pairs (sent as a comma-separated list).
   */
  fetchExchangeInfo(params: ExchangeInfoRequest = {}): Promise<ExchangeInfo> {
    const query: Record<string, string> = {};
    if (params.symbol) {
      query.symbol = params.symbol;
    }
    if (params.symbols && params.symbols.length > 0) {
      query.symbols = params.symbols.join(',');
    }
    return this.get<ExchangeInfo>('/api/v3/exchangeInfo', query);
  }

  /**
   * Account information — balances, commission rates, and permissions.
   * GET /api/v3/account (signed; requires apiKey + apiSecret).
   */
  getAccountInformation(): Promise<AccountInformation> {
    return this.requestSigned<AccountInformation>('GET', '/api/v3/account');
  }

  /** Place a new order. POST /api/v3/order (signed). */
  placeOrder(params: NewOrderRequest): Promise<NewOrderResponse> {
    return this.requestSigned<NewOrderResponse>('POST', '/api/v3/order', { ...params } as RequestParams);
  }

  /** Cancel an active order. DELETE /api/v3/order (signed). */
  cancelOrder(params: CancelOrderRequest): Promise<SpotOrder> {
    return this.requestSigned<SpotOrder>('DELETE', '/api/v3/order', { ...params } as RequestParams);
  }

  /** Cancel all open orders on a symbol. DELETE /api/v3/openOrders (signed). */
  cancelAllOrders(symbol: string): Promise<SpotOrder[]> {
    return this.requestSigned<SpotOrder[]>('DELETE', '/api/v3/openOrders', { symbol });
  }

  /** Query a single order. GET /api/v3/order (signed). */
  queryOrder(params: QueryOrderRequest): Promise<SpotOrder> {
    return this.requestSigned<SpotOrder>('GET', '/api/v3/order', { ...params } as RequestParams);
  }

  /** All open orders, optionally filtered by symbol. GET /api/v3/openOrders (signed). */
  getOpenOrders(symbol?: string): Promise<SpotOrder[]> {
    return this.requestSigned<SpotOrder[]>('GET', '/api/v3/openOrders', { symbol });
  }

  // --- User data stream (listenKey) lifecycle ---

  /** Create a listenKey for the user data websocket stream. POST /api/v3/userDataStream (signed). */
  createListenKey(): Promise<ListenKeyResponse> {
    return this.requestSigned<ListenKeyResponse>('POST', '/api/v3/userDataStream');
  }

  /** Keep a listenKey alive (call every ~30 min). PUT /api/v3/userDataStream (signed). */
  keepAliveListenKey(listenKey: string): Promise<ListenKeyResponse> {
    return this.requestSigned<ListenKeyResponse>('PUT', '/api/v3/userDataStream', { listenKey });
  }

  /** Close a listenKey. DELETE /api/v3/userDataStream (signed). */
  closeListenKey(listenKey: string): Promise<Record<string, never>> {
    return this.requestSigned<Record<string, never>>('DELETE', '/api/v3/userDataStream', {
      listenKey,
    });
  }
}
