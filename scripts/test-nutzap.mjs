/**
 * Nut zap verification — runs in this VM (node), testnut only, fake sats.
 *
 * What it verifies (all Cashu-side, no browser needed):
 *  1. testnut advertises NUT-11 (P2PK) support.
 *  2. Mint -> P2PK-locked send (lock to a test pubkey, refund to an
 *     ephemeral key, lockUntil +7d) -> the locked proofs carry the right
 *     P2PK secret (data = 02<lock pubkey>, refund tag, locktime tag).
 *  3. The locked token CANNOT be received without the lock key (negative
 *     control), and CAN be received with it (10 sats arrive).
 *  4. kind:10019 parsing (parseNutzapInfoEvent / pickNutzapMint) against
 *     synthetic events — via an esbuild bundle of src/lib/nutzap.ts.
 *  5. kind:9321 event construction (buildNutzapEvent): tags match NIP-61.
 *
 * What it can NOT verify here (relay websockets are blocked in this VM):
 *  - kind:10019 fetch from real relays (fetchNutzapInfo) — attempted,
 *    outcome recorded, not fatal.
 *  - kind:9321 publish to real relays — attempted with a timeout,
 *    outcome recorded, not fatal.
 * Those two need a real browser on the live site.
 *
 * Usage: node scripts/test-nutzap.mjs
 * Exit 0 = every VM-verifiable check passed. Relay checks are reported
 * but never fail the run.
 */
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Wallet, getEncodedToken, getDecodedToken, sumProofs } from '@cashu/cashu-ts';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BUNDLE = join(__dirname, '.nutzap-bundle.cjs');
const MINT = 'https://testnut.cashu.space';
const JACK_HEX = '82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2';

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}
function note(name, detail = '') {
  console.log(`NOTE  ${name}${detail ? ` — ${detail}` : ''}`);
}

// --- Bundle src/lib/nutzap.ts so the real parse/build code is tested ---
// esbuild ships inside vite (not a direct dep), so locate its binary under
// .pnpm rather than assuming node_modules/.bin.
import { readdirSync } from 'node:fs';
const esbuildDir = readdirSync(join(ROOT, 'node_modules', '.pnpm'))
  .find((d) => d.startsWith('esbuild@'));
const esbuildBin = esbuildDir
  ? join(ROOT, 'node_modules', '.pnpm', esbuildDir, 'node_modules', 'esbuild', 'bin', 'esbuild')
  : null;
if (!esbuildBin) {
  console.error('esbuild binary not found under node_modules/.pnpm');
  process.exit(1);
}
const esbuild = spawnSync(
  esbuildBin,
  ['src/lib/nutzap.ts', '--bundle', '--format=cjs', '--platform=node', `--outfile=${BUNDLE}`],
  { cwd: ROOT, encoding: 'utf8' },
);
if (esbuild.status !== 0) {
  console.error('esbuild bundle failed:', esbuild.stderr || esbuild.stdout);
  process.exit(1);
}
const { createRequire } = await import('node:module');
const nutzap = createRequire(import.meta.url)(BUNDLE);
const { parseNutzapInfoEvent, pickNutzapMint, buildNutzapEvent } = nutzap;

try {
  // 1. testnut NUT-11 support
  const infoRes = await fetch(`${MINT}/v1/info`);
  const info = await infoRes.json();
  check('testnut advertises NUT-11 (P2PK)', info?.nuts?.['11']?.supported === true, JSON.stringify(info?.nuts?.['11']));

  // 2. Mint + P2PK-locked send
  const lockSecret = generateSecretKey();
  const lockPubkey = getPublicKey(lockSecret); // x-only hex
  const refundSecret = generateSecretKey();
  const refundPubkey = getPublicKey(refundSecret);
  const wallet = new Wallet(MINT);
  await wallet.loadMint();
  const quote = await wallet.createMintQuoteBolt11(21, 'NutTip nutzap test');
  let paid = false;
  for (let i = 0; i < 30; i++) {
    const state = await wallet.checkMintQuoteBolt11(quote.quote);
    if (state.state === 'PAID') { paid = true; break; }
    await new Promise((r) => setTimeout(r, 2000));
  }
  check('mint quote auto-paid on testnut', paid);
  const proofs = await wallet.ops.mintBolt11(21, quote).run();
  check('minted 21 sats', sumProofs(proofs).toNumber() === 21, `${sumProofs(proofs).toNumber()} sats`);

  const { P2PKBuilder } = await import('@cashu/cashu-ts');
  const lockUntil = Math.floor(Date.now() / 1000) + 7 * 86400;
  const p2pk = new P2PKBuilder()
    .addLockPubkey(`02${lockPubkey}`)
    .addRefundPubkey(`02${refundPubkey}`)
    .lockUntil(lockUntil)
    .toOptions();
  const { keep, send } = await wallet.ops.send(10, proofs).includeFees(true).asLocked(p2pk).run();
  // send proofs total 10 + the mint's input fee (1 sat here — the fee
  // buffer in the app accounts for this); the recipient still gets 10.
  check('P2PK-locked send of 10 sats', sumProofs(send).toNumber() >= 10 && sumProofs(send).toNumber() + sumProofs(keep).toNumber() <= 21, `sent ${sumProofs(send).toNumber()}, kept ${sumProofs(keep).toNumber()} (1 sat fee)`);

  const secret = JSON.parse(send[0].secret);
  check('locked proof secret is P2PK', Array.isArray(secret) && secret[0] === 'P2PK', JSON.stringify(secret).slice(0, 80));
  check('lock data is 02 + lock pubkey', secret[1]?.data === `02${lockPubkey}`);
  const tags = secret[1]?.tags ?? [];
  check('refund tag present', tags.some((t) => t[0] === 'refund' && JSON.stringify(t[1]).includes(`02${refundPubkey}`)), JSON.stringify(tags));
  check('locktime tag present', tags.some((t) => t[0] === 'locktime' && Number(t[1]) === lockUntil), JSON.stringify(tags));

  // 3. Receive: negative control + with-key
  const token = getEncodedToken({ mint: MINT, proofs: send, unit: 'sat' });
  const rxWallet = new Wallet(MINT);
  await rxWallet.loadMint();
  const wrongSecret = generateSecretKey();
  const wrongHex = [...wrongSecret].map((b) => b.toString(16).padStart(2, '0')).join('');
  let wrongFailed = false;
  try {
    await rxWallet.ops.receive(token).privkey(wrongHex).run();
  } catch {
    wrongFailed = true;
  }
  check('locked token CANNOT be received with a wrong key', wrongFailed);

  const lockHex = [...lockSecret].map((b) => b.toString(16).padStart(2, '0')).join('');
  const received = await rxWallet.ops.receive(token).privkey(lockHex).run();
  check('locked token received with the lock key (10 sats)', sumProofs(received).toNumber() === 10, `${sumProofs(received).toNumber()} sats`);

  // 4. kind:10019 parsing (synthetic events, real code)
  const recipientHex = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const full = parseNutzapInfoEvent(
    {
      id: 'evt1',
      created_at: 100,
      tags: [
        ['relay', 'wss://relay.damus.io'],
        ['relay', 'wss://nos.lol'],
        ['mint', 'https://testnut.cashu.space', 'sat'],
        ['mint', 'https://other.example', 'usd'],
        ['pubkey', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'],
      ],
    },
    recipientHex,
  );
  check('parse full kind:10019', full !== null && full.mints.length === 2 && full.relays.length === 2 && full.pubkey.startsWith('bbbb'));
  check('pick testnut from listed mints', (() => {
    const m = pickNutzapMint(full, [MINT]);
    return m !== null && m.listedUrl === 'https://testnut.cashu.space' && m.walletUrl === MINT;
  })());
  check('USD-only mint is skipped', (() => {
    const usdOnly = parseNutzapInfoEvent(
      { id: 'evt2', created_at: 1, tags: [['mint', 'https://testnut.cashu.space', 'usd']] },
      recipientHex,
    );
    return pickNutzapMint(usdOnly, [MINT]) === null;
  })());
  check('no pubkey tag falls back to recipient hex', (() => {
    const noPub = parseNutzapInfoEvent(
      { id: 'evt3', created_at: 1, tags: [['mint', 'https://testnut.cashu.space', 'sat']] },
      recipientHex,
    );
    return noPub !== null && noPub.pubkey === recipientHex;
  })());
  check('no mints listed returns null', parseNutzapInfoEvent({ id: 'evt4', created_at: 1, tags: [['relay', 'wss://relay.damus.io']] }, recipientHex) === null);
  check('trailing-slash mint URL still matches', (() => {
    const slash = parseNutzapInfoEvent(
      { id: 'evt5', created_at: 1, tags: [['mint', 'https://testnut.cashu.space/', 'sat']] },
      recipientHex,
    );
    const m = pickNutzapMint(slash, [MINT]);
    return m !== null && m.listedUrl === 'https://testnut.cashu.space/';
  })());

  // 5. kind:9321 event construction (real code, no publish yet)
  const { default: NDK } = await import('@nostr-dev-kit/ndk');
  const ndk = new NDK({ explicitRelayUrls: ['wss://relay.damus.io'] });
  const evt = buildNutzapEvent(ndk, {
    recipientHex,
    amount: 10,
    mintUrl: 'https://testnut.cashu.space',
    proofs: send,
    message: 'test zap',
  });
  check('kind:9321 event kind', evt.kind === 9321);
  const tagMap = new Map(evt.tags.map((t) => [t[0] + ':' + (t[1] ?? ''), t]));
  check('amount tag = 10', evt.tags.some((t) => t[0] === 'amount' && t[1] === '10'));
  check('unit tag = sat', evt.tags.some((t) => t[0] === 'unit' && t[1] === 'sat'));
  check('u tag is the listed mint verbatim', evt.tags.some((t) => t[0] === 'u' && t[1] === 'https://testnut.cashu.space'));
  check('p tag is the recipient', evt.tags.some((t) => t[0] === 'p' && t[1] === recipientHex));
  const proofTags = evt.tags.filter((t) => t[0] === 'proof');
  const proofSum = proofTags.reduce((s, t) => s + Number(JSON.parse(t[1]).amount), 0);
  // Proof tags sum to the locked proofs (10 + 1 sat mint input fee),
  // while the amount tag is what the creator receives (10).
  check('proof tags match the locked proofs (>= 10 sats)', proofTags.length === send.length && proofSum === sumProofs(send).toNumber() && proofSum >= 10, `${proofTags.length} proof tags, sum ${proofSum}`);
  check('no e tag (tipping a creator, not an event)', !evt.tags.some((t) => t[0] === 'e'));

  // 5b. Publish attempt — expected to fail in this VM (websockets blocked).
  // Recorded, never fatal.
  try {
    const { NDKPrivateKeySigner } = await import('@nostr-dev-kit/ndk');
    const eph = generateSecretKey();
    ndk.signer = new NDKPrivateKeySigner(eph, ndk);
    const published = await Promise.race([
      evt.publish(undefined, 10000).then((s) => [...s].map((r) => r.url)),
      new Promise((_, rej) => setTimeout(() => rej(new Error('publish timeout (10s)')), 11000)),
    ]);
    note('kind:9321 publish (VM)', published.length > 0 ? `published to ${published.join(', ')}` : 'accepted by no relay');
  } catch (e) {
    note('kind:9321 publish (VM)', `did not publish from this VM — ${e.message} (relay websockets are blocked here; needs a real browser)`);
  }

  // 6. kind:10019 fetch attempts — expected to fail/time out in this VM.
  try {
    const got = await Promise.race([
      nutzap.fetchNutzapInfo(JACK_HEX),
      new Promise((res) => setTimeout(() => res('TIMEOUT'), 25000)),
    ]);
    note('fetchNutzapInfo(jack) from VM', got === 'TIMEOUT' ? 'timed out (25s) — relays blocked here' : got === null ? 'returned null (no kind:10019 seen from this VM)' : 'unexpectedly returned info');
  } catch (e) {
    note('fetchNutzapInfo(jack) from VM', `errored — ${e.message}`);
  }
} finally {
  try { rmSync(BUNDLE, { force: true }); } catch { /* ignore */ }
}

console.log(failures === 0 ? '\nAll VM-verifiable nut zap checks PASSED.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
