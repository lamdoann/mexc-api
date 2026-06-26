# mexc-api

Minimal Node.js / TypeScript connector for the [MEXC Spot V3 API](https://www.mexc.com/api-docs/spot-v3/introduction).
Structure is inspired by the [tiagosiebler](https://github.com/tiagosiebler/binance) connectors
(a thin `BaseRestClient`, a typed REST client, and an `EventEmitter`-based websocket client).

Scope (by design):

- **REST**: `fetchExchangeInfo()` — `GET /api/v3/exchangeInfo`
- **WebSocket**: spot **trade (deals) streams**, decoded from MEXC's protobuf push format

## Install

Use it as a dependency in another project (the `prepare` script builds `dist`
automatically on install):

```bash
# from a local path
npm install /path/to/mexc-api
# from git
npm install github:<you>/mexc-api
# from npm (after publishing)
npm install mexc-api
```

Developing this package itself:

```bash
npm install
npm run build
```

## REST — exchange info

```ts
import { MexcRestClient } from 'mexc-api';

const client = new MexcRestClient();

const all = await client.fetchExchangeInfo();                 // every symbol
const one = await client.fetchExchangeInfo({ symbol: 'BTCUSDT' });
const some = await client.fetchExchangeInfo({ symbols: ['BTCUSDT', 'ETHUSDT'] });
```

Futures (contract) markets live on the futures client (`https://contract.mexc.com`),
handy for feeding the futures trade pool:

```ts
import { MexcFuturesRestClient } from 'mexc-api';

const futuresRest = new MexcFuturesRestClient();
const contracts = await futuresRest.fetchContracts();         // all contracts
const enabled = contracts.filter((c) => c.state === 0 && c.quoteCoin === 'USDT');
// → enabled.map((c) => c.symbol) gives BTC_USDT, ETH_USDT, ...
```

### Futures account & positions

```ts
const fut = new MexcFuturesRestClient({ apiKey, apiSecret });

await fut.getAccountAssets();                 // all wallet assets
await fut.getAccountAsset('USDT');            // one currency
await fut.getOpenPositions({ symbol: 'BTC_USDT' });
await fut.getHistoricalPositions({ page_num: 1, page_size: 20 });
await fut.getFundingRecords({ symbol: 'BTC_USDT' });
await fut.getTransferRecords({ page_num: 1, page_size: 20 });
await fut.getRiskLimits('BTC_USDT');
await fut.getLeverage('BTC_USDT');
await fut.getPositionMode();                  // 1 hedge, 2 one-way

await fut.changeMargin({ positionId: 123, amount: 5, type: 'ADD' });   // or 'SUB'
await fut.changeLeverage({ positionId: 123, leverage: 20 });
await fut.changePositionMode(2);              // 1 hedge, 2 one-way
```

### Futures (perpetual) trading

`MexcFuturesRestClient` signs contract requests with the contract scheme
(`ApiKey` / `Request-Time` / `Signature` headers; sign `accessKey + reqTime +
paramStr`).

```ts
const fut = new MexcFuturesRestClient({ apiKey, apiSecret });

// Place (POST order/create): side 1 open long / 2 close short / 3 open short /
// 4 close long; type 1 limit … 5 market; openType 1 isolated / 2 cross.
await fut.placeOrder({ symbol: 'BTC_USDT', price: 60000, vol: 1, side: 1, type: 1, openType: 1, leverage: 20 });
await fut.placeBatchOrders([ /* up to 50 */ ]);

// Modify a live limit order's price & quantity (order/change_limit_order):
await fut.modifyOrder({ orderId: 123, price: 61000, vol: 2 });
// Modify SL/TP on a limit order (stoporder/change_price):
await fut.modifyOrderTpSl({ orderId: 123, stopLossPrice: 58000, takeProfitPrice: 65000 });
// Modify SL/TP on a plan/trigger order (planorder/change_stop_order):
await fut.modifyPlanOrderTpSl({ symbol: 'BTC_USDT', orderId: 456, stopLossPrice: 58000 });

// Cancel:
await fut.cancelOrders([123, 456]);          // by id (max 50)
await fut.cancelOrderByExternalId('BTC_USDT', 'my-oid');
await fut.cancelAllOrders('BTC_USDT');        // or omit symbol for all

// Any other signed contract endpoint:
await fut.privateGet('/api/v1/private/order/list/open_orders/BTC_USDT');
```

> **Futures trading access:** these endpoints are open via the API — your account
> just needs **contract/futures API permission** enabled. The contract host sits
> behind Akamai, which returns `403 Access Denied` for the order paths when the
> `User-Agent` is `axios/*`; the client sends a non-axios User-Agent
> (`DEFAULT_USER_AGENT`) so requests get through.

## REST — private (signed) endpoints

Private endpoints need an API key + secret. The client adds `timestamp` +
`recvWindow` and signs the query string with HMAC SHA256 (`X-MEXC-APIKEY` header).

```ts
const client = new MexcRestClient({
  apiKey: process.env.MEXC_API_KEY,
  apiSecret: process.env.MEXC_API_SECRET,
});

const account = await client.getAccountInformation();           // GET /api/v3/account
const open = await client.getOpenOrders('BTCUSDT');             // GET /api/v3/openOrders

const order = await client.placeOrder({                         // POST /api/v3/order
  symbol: 'BTCUSDT',
  side: 'BUY',
  type: 'LIMIT',
  quantity: '0.001',
  price: '20000',
});

await client.cancelOrder({ symbol: 'BTCUSDT', orderId: order.orderId });
```

Available signed methods: `getAccountInformation`, `placeOrder`, `cancelOrder`,
`cancelAllOrders`, `queryOrder`, `getOpenOrders`, plus the listenKey lifecycle
(`createListenKey`, `keepAliveListenKey`, `closeListenKey`).

### Calling any endpoint (generic helpers)

For endpoints without a dedicated method, use the generic helpers — just pass the
path and params (timestamp + signing are handled for the private ones):

```ts
// Public
await client.publicGet('/api/v3/time');
await client.publicGet<{ symbol: string; price: string }>('/api/v3/ticker/price', {
  symbol: 'BTCUSDT',
});

// Private (signed)
await client.privateGet('/api/v3/myTrades', { symbol: 'BTCUSDT' });
await client.privatePost('/api/v3/order', { symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quoteOrderQty: 10 });
await client.privateDelete('/api/v3/order', { symbol: 'BTCUSDT', orderId: '123' });
// or a custom method:
await client.privateRequest('PUT', '/api/v3/userDataStream', { listenKey });
```

## WebSocket — private (user data) streams

Private streams need a **listenKey**. The simplest path is `subscribeUserDataStream()`,
which **manages the listenKey for you** — it creates one, keepalives it on an
interval, and recreates it (reconnecting) if it expires. Just pass credentials:

```ts
const ws = new MexcWebsocketClient({ apiKey, apiSecret });
ws.on('order', (o) => console.log('order', o.symbol, o.status));
ws.on('execution', (e) => console.log('fill', e.symbol, e.quantity, e.price));
ws.on('balance', (b) => console.log('balance', b.vcoinName, b.balanceAmount));

await ws.subscribeUserDataStream();        // all three channels (default)
// await ws.subscribeUserDataStream({ orders: true });  // pick channels

ws.close(); // stops keepalive and releases the listenKey
```

Tune the refresh cadence with `listenKeyKeepAliveInterval` (default 30 min), or
pass a pre-configured `restClient`.

<details>
<summary>Manual listenKey management (advanced)</summary>

```ts
const rest = new MexcRestClient({ apiKey, apiSecret });
const { listenKey } = await rest.createListenKey();

const ws = new MexcWebsocketClient({ listenKey });
ws.connect();
ws.subscribeUserOrders();
ws.subscribeUserDeals();
ws.subscribeUserAccount();

setInterval(() => rest.keepAliveListenKey(listenKey), 30 * 60 * 1000);
```
</details>

## WebSocket — spot trade streams

MEXC pushes spot market data as **protobuf-encoded binary frames** over
`wss://wbs-api.mexc.com/ws`; subscription acks and `PONG` arrive as JSON text frames.
This client handles the connection lifecycle, keepalive `PING`s, automatic
reconnect + re-subscribe, and protobuf decoding for you.

```ts
import { MexcWebsocketClient } from 'mexc-api';

const ws = new MexcWebsocketClient();

ws.on('trade', (t) => {
  console.log(t.symbol, t.side, t.price, t.quantity, t.time);
});

ws.connect();
ws.subscribeSpotTrades('BTCUSDT');                          // single symbol
ws.subscribeSpotTrades(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);  // many → one SUBSCRIPTION message
ws.subscribeSpotTrades('ADAUSDT', '10ms');                  // tighter aggregation window
```

> **Note:** MEXC currently **blocks** the raw per-trade channel
> (`spot@public.deals.v3.api.pb@...` → `Reason: Blocked!`). `subscribeSpotTrades`
> therefore subscribes to the **aggregated** deals channel
> (`spot@public.aggre.deals.v3.api.pb@<interval>@<symbol>`, default `100ms`),
> which still emits one `trade` event per deal. `subscribeSpotAggreTrades` is an
> explicit alias.

Multi-symbol subscriptions are batched into a single `SUBSCRIPTION` message and
chunked at 30 channels (MEXC's per-connection limit). You can also pass raw
channels directly via `ws.subscribe([...])`.

### Spot trades (`MexcWebsocketClient`)

The spot client streams spot trades over the protobuf feed
(`wss://wbs-api.mexc.com/ws`). It auto-connects on subscribe:

```ts
const ws = new MexcWebsocketClient();
ws.on('trade', (t) => console.log(t.market, t.symbol, t.side, t.price, t.quantity));
ws.subscribeTrades(['BTCUSDT', 'ETHUSDT']);       // optional 2nd arg: '10ms' | '100ms'
ws.unsubscribeTrades(['ETHUSDT']);
```

### Futures trades, candlesticks & orders (`MexcFuturesWebsocketClient`)

Futures lives on its own client (JSON feed `wss://contract.mexc.com/edge`).
Symbols use the `BTC_USDT` form — `BTCUSDT` is auto-converted. Trades include a
`tradeId`; spot trades include `sendTime`.

```ts
import { MexcFuturesWebsocketClient } from 'mexc-api';

const fut = new MexcFuturesWebsocketClient({ apiKey, apiSecret }); // keys only needed for orders
fut.on('trade', (t) => console.log(t.symbol, t.side, t.price));
fut.on('kline', (k) => console.log(k.symbol, k.interval, k.open, k.close, k.volume));
fut.on('order', (o) => console.log('order', o.symbol, 'state', o.state, o.price, o.vol));

fut.connect();
fut.subscribeTrades(['BTC_USDT', 'ETH_USDT']);
fut.subscribeCandlesticks(['BTC_USDT'], 'Min1');   // intervals: Min1 … Month1
fut.subscribeOrders();                              // logs in, then auto-pushes push.personal.order
```

Futures private order updates need a WS **login** (handled for you with your
`apiKey`/`apiSecret`); after `rs.login` success MEXC auto-pushes orders. To stream
both markets through one aggregated emitter, use `MexcTradeStreamPool` (below).

### Candlesticks (kline)

```ts
ws.connect();
ws.subscribeCandlesticks(['BTCUSDT', 'ETHUSDT'], 'Min1');
ws.on('kline', (k) =>
  console.log(k.symbol, k.interval, 'O', k.openingPrice, 'C', k.closingPrice, 'V', k.volume),
);

ws.unsubscribeCandlesticks('ETHUSDT', 'Min1');
```

Intervals: `Min1`, `Min5`, `Min15`, `Min30`, `Min60`, `Hour4`, `Hour8`, `Day1`,
`Week1`, `Month1`. `windowStart` / `windowEnd` are **second** timestamps.

### Unsubscribing & closing

```ts
ws.unsubscribeTradeStreams(['BTCUSDT', 'ETHUSDT']); // stop trade streams
ws.unsubscribeCandlesticks('BTCUSDT', 'Min1');      // stop a kline stream
ws.unsubscribe(['spot@...']);                       // raw channels

ws.close();      // graceful close, stops reconnecting
ws.terminate();  // force-kill the socket immediately, stops reconnecting
```

### Streaming many symbols (connection pool)

Spot enforces a **hard limit of 30 subscriptions per connection**. To stream more
symbols (e.g. every USDT pair — ~1800+), use `MexcTradeStreamPool`, which shards
symbols across a pool of auto-reconnecting connections and re-emits all trades
from one place. It works for **both markets** via the `market` option:

```ts
import { MexcRestClient, MexcTradeStreamPool } from 'mexc-api';

const rest = new MexcRestClient();
const symbols = (await rest.fetchExchangeInfo()).symbols
  .filter((s) => s.quoteAsset === 'USDT' && s.isSpotTradingAllowed)
  .map((s) => s.symbol);

// Spot (default)
const spot = new MexcTradeStreamPool({ interval: '100ms' });
spot.on('trade', (t) => console.log(t.market, t.symbol, t.side, t.price));
spot.on('rejected', (msg) => console.warn('refused:', msg)); // delisted/blocked
spot.subscribe(symbols); // ~1800 symbols → ~60 connections (30 each)

// Futures
const fut = new MexcTradeStreamPool({ market: 'future' });
fut.on('trade', (t) => console.log(t.symbol, t.price, t.quantity));
fut.subscribe(futuresSymbols); // no 30-cap → 100 per connection by default
```

Options: `market` (`spot` / `future`), `maxPerConnection` (spot capped at 30;
futures defaults to 100), `interval` (spot only), and `connectStagger` (ms between
opening connections — raise it if you hit rate limits). `close()` / `terminate()`
tear everything down. `MexcSpotTradeStream` remains as a spot-only alias.

**Caveats for large fan-outs:**

- ~1800 symbols means ~60 simultaneous connections from one IP. If you hit
  connection-rate or per-IP limits, increase `connectStagger` or split the symbol
  list across multiple processes / IPs.
- Some symbols from `exchangeInfo` are delisted/migrated and return
  `Reason: Blocked!` — surfaced via the `rejected` event; they simply won't stream.
- Subscribing to everything is a firehose — sample or buffer downstream.

### Events

| Event          | Payload                | Description                                  |
| -------------- | ---------------------- | -------------------------------------------- |
| `open`         | —                      | Socket connected                             |
| `close`        | `(code, reason)`       | Socket closed                                |
| `reconnecting` | `attempt` (number)     | A reconnect attempt is scheduled             |
| `reconnected`  | —                      | Reconnection succeeded (socket re-opened)    |
| `reconnectFailed` | `attempts` (number) | Gave up after `maxReconnectAttempts`         |
| `error`        | `Error`                | Socket or decode error                       |
| `response`     | `WsControlMessage`     | JSON control frame (sub ack / `PONG`)        |
| `message`      | `DecodedPushData`      | Raw decoded protobuf push                    |
| `trade`        | `MexcTrade`            | One normalised trade per deal item (public)  |
| `order`        | `MexcOrderUpdate`      | Private order update (needs listenKey)       |
| `execution`    | `MexcExecutionUpdate`  | Private fill (needs listenKey)               |
| `balance`      | `MexcBalanceUpdate`    | Private balance update (needs listenKey)     |

`MexcTrade.side` is `'buy'` / `'sell'` (raw `tradeType` 1 / 2 also included).

### Reconnection

Both websocket clients reconnect automatically with **exponential backoff + jitter**
and re-subscribe (and re-login for private streams). Tune via options:

```ts
new MexcWebsocketClient({
  reconnectDelay: 2000,        // base delay (ms); doubles each attempt
  maxReconnectDelay: 30000,    // backoff cap (ms)
  maxReconnectAttempts: 10,    // give up after N (default: Infinity)
});
```

When the cap is hit the client emits `reconnectFailed` and stops; calling
`connect()` again resets the counter.

## Run the examples

```bash
npm run example:exchange-info
npm run example:trades
```

## Notes

- The bundled protobuf schema is a trimmed, self-contained subset of MEXC's
  [official websocket-proto](https://github.com/mexcdevelop/websocket-proto),
  keeping the original `oneof` field numbers (`publicDeals = 301`,
  `publicAggreDeals = 314`) so the wire format matches.
- MEXC allows up to 30 subscriptions per connection and drops idle sockets after
  ~60s — the client PINGs every 20s by default.
