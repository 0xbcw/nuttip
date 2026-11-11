/**
 * Prepare the throwaway NutTip nut-zap test identity.
 *
 * Generates a fresh, clearly test-only Nostr identity, builds its
 * kind:10019 event (listing testnut for sats), and ATTEMPTS to publish it
 * from this VM. Relay websockets are blocked in this VM, so the publish
 * is expected to fail — in that case the script writes everything needed
 * for a real browser to publish it (event JSON + instructions) and exits
 * honestly reporting "NOT published".
 *
 * TEST ONLY: this identity is a throwaway. Never use it as a real
 * identity, never fund it with real sats, testnut only.
 *
 * Output: scripts/test-identity.json (mode 600, gitignored — never commit).
 *
 * Usage: node scripts/test-nutzap-identity.mjs
 */
import { writeFileSync, chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import NDK, { NDKEvent, NDKPrivateKeySigner } from '@nostr-dev-kit/ndk';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'test-identity.json');
const MINT = 'https://testnut.cashu.space';
const RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://relay.primal.net',
];

const bytesToHex = (b) =>
  [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

const secretKey = generateSecretKey();
const hexpubkey = getPublicKey(secretKey);
const npub = nip19.npubEncode(hexpubkey);
const nsec = nip19.nsecEncode(secretKey);

const kind10019 = {
  kind: 10019,
  created_at: Math.floor(Date.now() / 1000),
  tags: [
    ...RELAYS.map((r) => ['relay', r]),
    ['mint', MINT, 'sat'],
    ['pubkey', hexpubkey],
  ],
  content: '',
  pubkey: hexpubkey,
};

console.log('Test identity:');
console.log(`  npub:      ${npub}`);
console.log(`  hex:       ${hexpubkey}`);
console.log(`  tip page:  https://nuttip.vercel.app/tip/${npub}`);
console.log('  kind:10019 tags:');
for (const t of kind10019.tags) console.log(`    ${JSON.stringify(t)}`);

let published = false;
let publishError = null;
try {
  const ndk = new NDK({ explicitRelayUrls: RELAYS });
  const signer = new NDKPrivateKeySigner(secretKey, ndk);
  ndk.signer = signer;
  const event = new NDKEvent(ndk, kind10019);
  const accepted = await Promise.race([
    event.publish(undefined, 12000).then((s) => [...s].map((r) => r.url)),
    new Promise((_, rej) => setTimeout(() => rej(new Error('publish timeout (12s)')), 13000)),
  ]);
  published = accepted.length > 0;
  console.log(published ? `Published to: ${accepted.join(', ')}` : 'Publish: accepted by no relay');
} catch (e) {
  publishError = e.message;
  console.log(`Publish attempt failed: ${publishError}`);
}

const record = {
  note: 'TEST-ONLY throwaway identity for the NutTip nut-zap demo. Never use as a real identity. Test sats only, testnut only. Contains a private key — never commit or share.',
  npub,
  hexpubkey,
  nsec,
  nsecHex: bytesToHex(secretKey),
  tipPage: `https://nuttip.vercel.app/tip/${npub}`,
  mint: MINT,
  relays: RELAYS,
  kind10019,
  published,
  publishError,
  createdAt: new Date().toISOString(),
  howToPublishFromBrowser: [
    'Option A — Nostr client (e.g. Primal / Snort / Damus): import the nsec as a throwaway account, then set your nutzap info to testnut (Settings → Lightning / Zap settings, or publish kind:10019 via the client if it supports it).',
    'Option B — nostr console / CLI (nostr-tool or noscl): sign and publish the kind10019 event JSON above with the nsecHex key.',
    'After publishing, wait a minute, then open the tip page above: the ⚡ one-tap tip should appear. Tip it from another browser profile — the locked tip can be claimed by importing the nsec into a Cashu wallet that supports nut zaps, or via the pending token in localStorage.',
  ],
};

writeFileSync(OUT, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
chmodSync(OUT, 0o600);
console.log(`\nWrote ${OUT} (mode 600, gitignored — never commit)`);
console.log(published ? '\nSTATUS: kind:10019 PUBLISHED.' : '\nSTATUS: kind:10019 NOT published from this VM (relay websockets blocked here). Publish it from a real browser using the instructions in the file.');
process.exit(0);
