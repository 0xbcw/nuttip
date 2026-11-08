/**
 * NutTip Cashu loop test — mint -> send -> receive on nofee.testnut.
 *
 * Fake sats only. Run: `pnpm test:cashu` (or `node scripts/test-cashu-loop.mjs`).
 * Exits 0 on success, 1 on failure. Prints each step so the result is
 * auditable in the build report.
 */
import { Wallet, getEncodedToken, sumProofs } from '@cashu/cashu-ts';

const MINT = process.env.NUTTIP_MINT ?? 'https://testnut.cashu.space';
const AMOUNT = Number(process.env.NUTTIP_AMOUNT ?? 21);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`mint: ${MINT}`);
  console.log(`amount: ${AMOUNT} sats (FAKE testnut sats)`);

  const wallet = new Wallet(MINT);
  await wallet.loadMint();
  console.log('1. loadMint OK — mint info:', wallet.getMintInfo().name ?? '(no name)');

  // 2. Mint quote + poll until the test mint marks it PAID.
  const quote = await wallet.createMintQuoteBolt11(AMOUNT, 'NutTip loop test');
  console.log(`2. mint quote ${quote.quote} state=${quote.state} request=${String(quote.request).slice(0, 40)}…`);
  let paid = false;
  for (let i = 0; i < 30; i++) {
    const state = await wallet.checkMintQuoteBolt11(quote.quote);
    console.log(`   poll ${i + 1}: state=${state.state}`);
    if (state.state === 'PAID') { paid = true; break; }
    await sleep(2000);
  }
  if (!paid) throw new Error('mint quote was not paid within 60s — testnut may be down or requires a real LN payment');

  const proofs = await wallet.ops.mintBolt11(AMOUNT, quote).run();
  console.log(`3. minted proofs: ${proofs.length} proofs, total ${sumProofs(proofs).toNumber()} sats`);
  if (sumProofs(proofs).toNumber() !== AMOUNT) throw new Error(`minted total != ${AMOUNT}`);

  // 4. Send half as a token.
  const sendAmount = Math.floor(AMOUNT / 2);
  const { keep, send } = await wallet.ops.send(sendAmount, proofs).includeFees(true).run();
  console.log(`4. send ${sendAmount}: keep=${sumProofs(keep).toNumber()} sats, send=${sumProofs(send).toNumber()} sats`);
  const token = getEncodedToken({ mint: MINT, proofs: send, memo: 'NutTip loop test', unit: 'sat' });
  console.log(`   token: ${token.slice(0, 60)}…`);

  // 5. Receive the token with a fresh wallet (simulates the creator claiming).
  const wallet2 = new Wallet(MINT);
  await wallet2.loadMint();
  const received = await wallet2.ops.receive(token).run();
  console.log(`5. received: ${received.length} proofs, total ${sumProofs(received).toNumber()} sats`);
  if (sumProofs(received).toNumber() !== sendAmount) {
    throw new Error(`received total ${sumProofs(received).toNumber()} != sent ${sendAmount}`);
  }

  console.log('CASHU LOOP OK: mint -> send -> receive on testnut');
}

main().catch((e) => {
  console.error('CASHU LOOP FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
