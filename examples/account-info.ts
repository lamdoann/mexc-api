import { MexcRestClient } from '../src';

// Provide credentials via env: MEXC_API_KEY=... MEXC_API_SECRET=... npm run example:account
const client = new MexcRestClient({
  apiKey: process.env.MEXC_API_KEY,
  apiSecret: process.env.MEXC_API_SECRET,
});

async function main() {
  const account = await client.getAccountInformation();
  console.log('accountType:', account.accountType);
  console.log('canTrade:', account.canTrade);

  const nonZero = account.balances.filter(
    (b) => Number(b.free) > 0 || Number(b.locked) > 0,
  );
  console.log('non-zero balances:', nonZero);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
