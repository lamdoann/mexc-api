import { MexcRestClient } from '../src';

async function main() {
  const client = new MexcRestClient();

  // Fetch a single symbol's trading rules.
  const info = await client.fetchExchangeInfo({ symbol: 'BTCUSDT' });

  console.log('serverTime:', info.serverTime);
  console.log('symbol count:', info.symbols.length);

  const btc = info.symbols[0];
  console.log('BTCUSDT:', {
    status: btc.status,
    baseAsset: btc.baseAsset,
    quoteAsset: btc.quoteAsset,
    quotePrecision: btc.quotePrecision,
    makerCommission: btc.makerCommission,
    takerCommission: btc.takerCommission,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
