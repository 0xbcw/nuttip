/**
 * Nostr profile lookup for NutTip.
 *
 * Given an npub (or hex pubkey), fetch the creator's kind-0 profile
 * (name, display name, picture, about) from public relays via NDK.
 * Read-only: no keys, no signing, no publishing in this module.
 * Nut zap (NIP-61) is a stretch goal — see docs in README, not wired here.
 *
 * Reliability notes (8 Nov 2026 fix):
 * - NDK's pool `connect()` only resolves when *every* configured relay is
 *   connected, so one slow/dead relay used to block the whole lookup and the
 *   live site showed "Timed out connecting to Nostr relays" for real
 *   profiles. We now call `ndk.connect(ms)` with a real timeout: NDK
 *   resolves when the timeout elapses even if only some relays are up, and
 *   keeps connecting in the background.
 * - If the relay lookup fails or comes back empty, we fall back to public
 *   HTTP profile caches (nostr.band API, njump.me Open Graph tags) run in
 *   parallel. Either path can supply name/avatar.
 * - A missing profile is never an error: the tip form works without a
 *   display name and TipPage falls back to showing the npub. Only an
 *   invalid npub/hex input throws. The whole lookup is time-bounded
 *   (~20s worst case) so the UI can never hang on it.
 */
import NDK, { NDKUser } from '@nostr-dev-kit/ndk';
import { nip19 } from 'nostr-tools';

export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://relay.primal.net',
];

/** NDK connect: resolve after this long even if only some relays are up. */
const RELAY_CONNECT_TIMEOUT_MS = 6000;
/** Longest to wait for a kind-0 event once (partially) connected. */
const RELAY_PROFILE_TIMEOUT_MS = 5000;
/** Longest to wait for each HTTP fallback request. */
const HTTP_TIMEOUT_MS = 8000;
/** Absolute cap on the whole lookup; the UI never waits longer than this. */
const OVERALL_TIMEOUT_MS = 20000;

export interface CreatorProfile {
  npub: string;
  hexpubkey: string;
  name?: string;
  displayName?: string;
  picture?: string;
  about?: string;
}

type PartialProfile = Pick<
  CreatorProfile,
  'name' | 'displayName' | 'picture' | 'about'
>;

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

export function getNdk(): NDK {
  if (!sharedNdk) {
    sharedNdk = new NDK({ explicitRelayUrls: DEFAULT_RELAYS });
  }
  return sharedNdk;
}

/** Race a promise against a timer; resolve with `fallback` on timeout. */
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function hasUsableProfile(p: PartialProfile | null): p is PartialProfile {
  return !!p && !!(p.name || p.displayName || p.picture);
}

/** Primary path: kind-0 event from the relays. Null on any failure. */
async function fetchProfileViaRelays(
  hexpubkey: string,
): Promise<PartialProfile | null> {
  const ndk = getNdk();
  try {
    // NDK's own timeout: resolves when it elapses even if only some relays
    // connected, and connection continues in the background.
    await ndk.connect(RELAY_CONNECT_TIMEOUT_MS);
  } catch {
    return null;
  }
  const user = new NDKUser({ hexpubkey });
  user.ndk = ndk;
  try {
    const profile = await withTimeout(
      user.fetchProfile(),
      RELAY_PROFILE_TIMEOUT_MS,
      null,
    );
    if (!profile) return null;
    return {
      name: profile.name,
      displayName: profile.displayName,
      picture: profile.image,
      about: profile.about,
    };
  } catch {
    return null;
  }
}

async function fetchJson(url: string, ms: number): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!res.ok) return null;
  return (await res.json()) as unknown;
}

/** nostr.band public profile API. Response shape varies (wrapped in
 *  `profile` or the kind-0 content itself), so accept both. */
async function fetchProfileViaNostrBand(
  hexpubkey: string,
): Promise<PartialProfile | null> {
  try {
    const json = await fetchJson(
      `https://api.nostr.band/v0/profile/${hexpubkey}`,
      HTTP_TIMEOUT_MS,
    );
    if (!json || typeof json !== 'object') return null;
    const record = json as Record<string, unknown>;
    const raw =
      record.profile && typeof record.profile === 'object'
        ? (record.profile as Record<string, unknown>)
        : record;
    const str = (v: unknown): string | undefined =>
      typeof v === 'string' && v.length > 0 ? v : undefined;
    const profile: PartialProfile = {
      name: str(raw.name),
      displayName: str(raw.display_name) ?? str(raw.displayName),
      picture: str(raw.picture) ?? str(raw.image),
      about: str(raw.about),
    };
    return hasUsableProfile(profile) ? profile : null;
  } catch {
    return null;
  }
}

function metaContent(html: string, property: string): string | null {
  // <meta property="og:title" content="..."> (attribute order varies)
  const patterns = [
    new RegExp(
      `<meta\\s[^>]*property=["']${property}["'][^>]*content=["']([^"']*)["']`,
      'i',
    ),
    new RegExp(
      `<meta\\s[^>]*content=["']([^"']*)["'][^>]*property=["']${property}["']`,
      'i',
    ),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return decodeHtmlEntities(m[1]);
  }
  return null;
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCodePoint(Number(code)));
}

/** njump.me profile pages carry Open Graph tags with the display name,
 *  avatar and bio — usable as a no-key HTTP fallback. */
async function fetchProfileViaNjump(
  npub: string,
): Promise<PartialProfile | null> {
  try {
    const res = await fetch(`https://njump.me/${npub}`, {
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      headers: { Accept: 'text/html' },
    });
    if (!res.ok) return null;
    const html = await res.text();
    // og:title on njump is the display name, sometimes "name (@nip05)".
    const rawTitle = metaContent(html, 'og:title');
    const name = rawTitle
      ?.replace(/\s*\(@[^)]*\)\s*$/, '')
      .trim();
    const profile: PartialProfile = {
      name: name && name.length > 0 ? name : undefined,
      displayName: name && name.length > 0 ? name : undefined,
      picture: metaContent(html, 'og:image') ?? undefined,
      about: metaContent(html, 'og:description') ?? undefined,
    };
    return hasUsableProfile(profile) ? profile : null;
  } catch {
    return null;
  }
}

/** Fallback path: both public HTTP caches in parallel, first usable wins. */
async function fetchProfileViaHttp(
  npub: string,
  hexpubkey: string,
): Promise<PartialProfile | null> {
  const results = await Promise.all([
    fetchProfileViaNostrBand(hexpubkey),
    fetchProfileViaNjump(npub),
  ]);
  return results.find((p) => hasUsableProfile(p)) ?? null;
}

/**
 * Fetch a kind-0 profile. Always resolves (never throws except for an
 * invalid npub/hex input). The relay lookup and the HTTP caches run in
 * parallel and the first usable profile wins, so one slow/dead relay (or
 * a blocked websocket) cannot stall the page: if nothing answers, a bare
 * { npub, hexpubkey } profile is returned and the tip form works without
 * a display name. Worst case is bounded by OVERALL_TIMEOUT_MS.
 */
export async function fetchCreatorProfile(
  npubOrHex: string,
): Promise<CreatorProfile> {
  const hexpubkey = parseNpub(npubOrHex);
  const npub = hexToNpub(hexpubkey);

  // A path that yields no usable profile never settles, so it cannot win
  // the race — it only matters via the "both paths finished" branch.
  const never: Promise<PartialProfile> = new Promise(() => {});
  const usable = (p: PartialProfile | null): Promise<PartialProfile> =>
    hasUsableProfile(p) ? Promise.resolve(p) : never;

  const relayAttempt = fetchProfileViaRelays(hexpubkey);
  const httpAttempt = fetchProfileViaHttp(npub, hexpubkey);

  const winner = await Promise.race([
    relayAttempt.then(usable),
    httpAttempt.then(usable),
    // Both paths finished without a usable profile: give up gracefully,
    // merging any partial metadata (e.g. a relay profile with only an
    // about field) over the bare profile.
    Promise.all([relayAttempt, httpAttempt]).then(([relay, http]) => {
      if (typeof console !== 'undefined') {
        console.warn(
          'NutTip: could not load Nostr profile from relays or HTTP fallback for',
          npub,
        );
      }
      return { ...(relay ?? {}), ...(http ?? {}) } as PartialProfile;
    }),
    // Absolute safety cap, in case an inner timeout ever fails to fire.
    // (A plain delay — not withTimeout, which would resolve immediately
    // on an already-resolved promise.)
    new Promise<PartialProfile>((resolve) =>
      setTimeout(() => resolve({}), OVERALL_TIMEOUT_MS),
    ),
  ]);

  return { npub, hexpubkey, ...winner };
}
