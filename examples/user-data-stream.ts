import { MexcWebsocketClient } from '../src';

// MEXC_API_KEY=... MEXC_API_SECRET=... npm run example:userdata
async function main() {
  // The client manages the listenKey for you: it creates one, keepalives it on an
  // interval, and recreates it (reconnecting) if it expires. No manual keepalive.
  const ws = new MexcWebsocketClient({
    apiKey: process.env.MEXC_API_KEY,
    apiSecret: process.env.MEXC_API_SECRET,
  });

  ws.on('order', (o) => console.log('[order]', o.symbol, 'status', o.status, 'price', o.price));
  ws.on('execution', (e) => console.log('[fill]', e.symbol, e.quantity, '@', e.price, 'fee', e.feeAmount));
  ws.on('balance', (b) => console.log('[balance]', b.vcoinName, '->', b.balanceAmount));
  ws.on('error', (err) => console.error('[ws] error:', err.message));

  const listenKey = await ws.subscribeUserDataStream();
  console.log('user data stream open, listenKey:', listenKey);

  process.on('SIGINT', () => {
    ws.close(); // also stops keepalive and releases the listenKey
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
