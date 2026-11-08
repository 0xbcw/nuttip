/**
 * Nostr profile lookup for NutTip.
 *
 * Given an npub (or hex pubkey), fetch the creator's kind-0 profile
 * (name, display name, picture, about) from public relays via NDK.
 * Read-only: no keys, no signing, no publishing in this module.
 * Nut zap (NIP-61) is a stretch goal — see docs in README, not wired here.
 */
import NDK, { NDKUser } from '@nostr-dev-kit/ndk';
import { nip19 } from 'nostr-tools';

export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://relay.primal.net',
];

export interface CreatorProfile {
  npub: string;
  hexpubkey: string;
  name?: string;
  displayName?: string;
  picture?: string;
  about?: string;
}

/** Accept an npub (npub1…) or a 64-char hex pubkey; return the hex pubkey. */
export function parseNpub(input: string): string {
  const trimmed = input.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return trimmed.toLowerCase();
  if (trimmed.startsWith('npub1')) {
    const decoded = nip19.decode(trimmed);
    if (decoded.type !== 'npub') throw new Error('Not an npub');
    return decoded.data as string;
  }
  throw new Error('Enter an npub (npub1…) or a 64-char hex pubkey');
}

export function hexToNpub(hexpubkey: string): string {
  return nip19.npubEncode(hexpubkey);
}

let sharedNdk: NDK | null = null;

function getNdk(): NDK {
  if (!sharedNdk) {
    sharedNdk = new NDK({ explicitRelayUrls: DEFAULT_RELAYS });
  }
  return sharedNdk;
}

/** Fetch a kind-0 profile. Returns null if the relays have no profile. */
export async function fetchCreatorProfile(
  npubOrHex: string,
  timeoutMs = 8000,
): Promise<CreatorProfile | null> {
  const hexpubkey = parseNpub(npubOrHex);
  const ndk = getNdk();
  // Connect with a timeout: in sandboxed / offline environments the
  // relay websocket can hang, and the UI must not hang with it.
  await Promise.race([
    ndk.connect(),
    new Promise((_resolve, reject) =>
      setTimeout(
        () => reject(new Error('Timed out connecting to Nostr relays')),
        timeoutMs,
      ),
    ),
  ]);
  const user = new NDKUser({ hexpubkey });
  user.ndk = ndk;
  const profile = await Promise.race([
    user.fetchProfile(),
    new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), timeoutMs),
    ),
  ]);
  return {
    npub: hexToNpub(hexpubkey),
    hexpubkey,
    name: profile?.name,
    displayName: profile?.displayName,
    picture: profile?.image,
    about: profile?.about,
  };
}
