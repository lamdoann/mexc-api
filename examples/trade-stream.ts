import { MexcRestClient, MexcSpotTradeStream } from '../src';

const client = new MexcRestClient();

async function main() {
  const info = await client.fetchExchangeInfo();
  const usdtSymbols = info.symbols
    .filter((s) => s.quoteAsset === 'USDT' && s.isSpotTradingAllowed)
    .map((s) => s.symbol);
  console.log('USDT symbols:', usdtSymbols.length);

  // One emitter, many connections under the hood (30 symbols each).
  const stream = new MexcSpotTradeStream({ interval: '100ms' });

  stream.on('trade', (trade) => {
    console.log(
      trade.symbol, trade.price, trade.quantity, trade.time
    );
  });

  let opened = 0;
  stream.on('connectionOpen', (i) => {
    opened++;
    console.log(`[ws] connection ${i} open (${opened}/${stream.connectionCount})`);
  });
  stream.on('rejected', (msg) => console.warn('[ws] rejected:', msg));
  stream.on('error', (err) => console.error('[ws] error:', err.message));

  stream.subscribe(usdtSymbols);

  process.on('SIGINT', () => {
    stream.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
