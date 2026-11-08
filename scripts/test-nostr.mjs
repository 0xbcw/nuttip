import NDK, { NDKUser } from '@nostr-dev-kit/ndk';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
// Freshly generated keypair: no profile exists, so fetchProfile should
// return null — this only proves relay connect + query round-trip works.
// NOTE (8 Nov 2026): in this sandbox VM, ndk.connect() hung with no output
// for 60s+ (websocket egress to relays appears blocked here). The app's
// fetchCreatorProfile now calls ndk.connect(6000) (NDK resolves on timeout
// even if only some relays are up) and falls back to HTTP profile caches,
// so the UI cannot hang. Use scripts/test-nostr-fix.mjs for the app-level
// check; re-run this script from a normal network / browser to verify the
// raw relay round-trip live.
const sk = generateSecretKey();
const hex = getPublicKey(sk);
console.log('test npub:', nip19.npubEncode(hex));
const ndk = new NDK({ explicitRelayUrls: ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.nostr.band'] });
await ndk.connect();
console.log('NDK connected, relays:', [...ndk.pool.relays.values()].map(r => r.url + ':' + r.status).join(' | '));
const user = new NDKUser({ hexpubkey: hex });
user.ndk = ndk;
const profile = await Promise.race([
  user.fetchProfile(),
  new Promise((res) => setTimeout(() => res('TIMEOUT'), 10000)),
]);
console.log('fetchProfile result:', profile === null ? 'null (expected — fresh key, no profile)' : profile === 'TIMEOUT' ? 'TIMEOUT' : JSON.stringify(profile));
await ndk.disconnect?.();
process.exit(0);
