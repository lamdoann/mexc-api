export interface RestClientOptions {
  /** Override the REST base URL. Defaults to https://api.mexc.com */
  baseUrl?: string;
  /** Request timeout in milliseconds. Defaults to 10000. */
  timeout?: number;
  /** API key for signed (private) endpoints. */
  apiKey?: string;
  /** API secret for signed (private) endpoints. */
  apiSecret?: string;
  /**
   * Receive window (ms) sent with signed requests. The server rejects a request
   * if it arrives later than `timestamp + recvWindow`. Defaults to MEXC's 5000.
   */
  recvWindow?: number;
}

export interface ExchangeInfoRequest {
  /** Single symbol filter, e.g. "BTCUSDT". */
  symbol?: string;
  /** Multiple symbol filter, e.g. ["BTCUSDT", "ETHUSDT"]. */
  symbols?: string[];
}
