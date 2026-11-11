/**
 * Nut zap (NIP-61) one-tap Cashu tips for NutTip.
 *
 * A nut zap is a P2PK-locked Cashu token where the payment itself is the
 * receipt: the tipper mints/swaps ecash on a mint the creator listed in
 * their kind:10019 event, locks it to the pubkey in that event, and
 * publishes a kind:9321 event p-tagging the creator. The creator's wallet
 * client picks the event up and swaps the token in.
 *
 * Rules enforced here (from NIP-61, read 12 Nov 2026):
 * - NEVER send to a mint the recipient has NOT listed in kind:10019.
 * - The lock pubkey MUST be prefixed with "02".
 * - The kind:9321 `u` tag must be the mint URL EXACTLY as the recipient
 *   listed it.
 * - No kind:10019 (or no listed mint NutTip can use) means NO nut zap:
 *   the caller must fall back to the token tip. This is the normal case
 *   today — jack, the demo creator, publishes no kind:10019 at all.
 *
 * NutTip is no-account, so publishing kind:9321 needs a signing key:
 * each nut zap uses a fresh ephemeral in-browser keypair, generated per
 * tip and discarded afterwards — except its secret is saved (with the
 * locked token) in localStorage, so an unclaimed zap stays reclaimable
 * via its refund pubkey until lockUntil. Nothing is sent to a server.
 *
 * Test sats only (testnut). No real funds, no mainnet change.
 */
import NDK, {
  NDKEvent,
  NDKPrivateKeySigner,
  NDKRelaySet,
} from '@nostr-dev-kit/ndk';
import {
  P2PKBuilder,
  type P2PKOptions,
  type Proof,
  type Wallet,
} from '@cashu/cashu-ts';
import {
  generateSecretKey,
  getPublicKey,
  nip19,
} from 'nostr-tools';
import { DEFAULT_RELAYS, getNdk } from './nostr';
import { encodeToken } from './cashu';
import { saveProofs } from './storage';

/** NIP-61: nutzap informational event. */
export const NUTZAP_INFO_KIND = 10019;
/** NIP-61: nutzap event. */
export const NUTZAP_KIND = 9321;
/** Refund window: an unclaimed nut zap can be reclaimed after this long. */
export const NUTZAP_REFUND_LOCK_DAYS = 7;
/** Longest to wait for a kind:10019 fetch. */
const NUTZAP_FETCH_TIMEOUT_MS = 8000;
/** Longest to wait for a kind:9321 publish. */
const NUTZAP_PUBLISH_TIMEOUT_MS = 10000;
/** Longest to wait for the publish relay pool to connect. */
const PUBLISH_CONNECT_TIMEOUT_MS = 6000;

export interface NutzapMintEntry {
  /** Mint URL exactly as listed in kind:10019. */
  url: string;
  /** Units the mint tag lists (e.g. ["sat"]); empty when unlisted. */
  units: string[];
}

export interface NutzapInfo {
  /** Mints the creator listed, in kind:10019 order. */
  mints: NutzapMintEntry[];
  /** x-only hex pubkey to P2PK-lock to (pubkey tag, else the creator's own). */
  pubkey: string;
  /** Relays the creator reads nut zaps from. */
  relays: string[];
  eventId: string;
  createdAt: number;
}

/** A mint NutTip can actually use for a nut zap. */
export interface NutzapMintMatch {
  /** Mint URL exactly as the creator listed it — goes in the `u` tag. */
  listedUrl: string;
  /** NutTip's URL for the same mint — used to load the wallet. */
  walletUrl: string;
}

/** Ephemeral in-browser keypair: the anonymous "sender" of one nut zap. */
export interface EphemeralSigner {
  secretKey: Uint8Array;
  secretHex: string;
  /** x-only hex pubkey. */
  pubkey: string;
  signer: NDKPrivateKeySigner;
}

/** A nut zap whose proofs are locked but whose kind:9321 did not publish. */
export interface PendingNutzap {
  mint: string;
  /** cashuA token of the P2PK-locked proofs — shareable directly. */
  token: string;
  /** Ephemeral sender secret: needed to reclaim after lockUntil. */
  secretHex: string;
  recipient: string;
  amount: number;
  lockUntil: number;
  createdAt: number;
}

const PENDING_KEY = 'nuttip:nutzap-pending:v1';

/** Error from the nut zap flow. `locked` is true once proofs are P2PK-locked:
 *  in that case the tip must NOT be silently re-sent as a token tip (that
 *  would mint fresh proofs and strand the locked ones) — retry the publish
 *  or share the locked token instead. */
export class NutzapError extends Error {
  locked: boolean;
  /** The signed kind:9321 event, when the lock succeeded but publish failed. */
  event?: NDKEvent;
  /** cashuA token of the locked proofs, for manual sharing. */
  token?: string;

  constructor(
    message: string,
    opts: { locked?: boolean; event?: NDKEvent; token?: string } = {},
  ) {
    super(message);
    this.name = 'NutzapError';
    this.locked = opts.locked ?? false;
    this.event = opts.event;
    this.token = opts.token;
  }
}

/** Race a promise against a timer; resolve with `fallback` on timeout. */
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Compare mint URLs ignoring trailing slashes and host case. */
export function normalizeMintUrl(url: string): string {
  return url.trim().replace(/\/+$/, '').toLowerCase();
}

/**
 * Parse a kind:10019 event into NutzapInfo. Pure function (no network) so
 * it is unit-testable. Returns null when the event lists no usable mint —
 * a nut zap cannot be sent to that creator.
 */
export function parseNutzapInfoEvent(
  event: { id: string; created_at?: number; tags: string[][] },
  recipientHex: string,
): NutzapInfo | null {
  const mints: NutzapMintEntry[] = [];
  const relays: string[] = [];
  let pubkey: string | null = null;
  for (const tag of event.tags ?? []) {
    if (!Array.isArray(tag) || tag.length < 2 || typeof tag[1] !== 'string') {
      continue;
    }
    if (tag[0] === 'mint' && tag[1].startsWith('http')) {
      mints.push({
        url: tag[1],
        units: tag
          .slice(2)
          .filter((u): u is string => typeof u === 'string'),
      });
    } else if (tag[0] === 'relay' && tag[1].startsWith('wss://')) {
      relays.push(tag[1]);
    } else if (tag[0] === 'pubkey') {
      const raw = tag[1].toLowerCase();
      const xonly =
        raw.startsWith('02') || raw.startsWith('03') ? raw.slice(2) : raw;
      if (/^[0-9a-f]{64}$/.test(xonly)) pubkey = xonly;
    }
  }
  if (mints.length === 0) return null;
  return {
    mints,
    // NIP-61: if no pubkey tag, lock to the recipient's own pubkey.
    pubkey: pubkey ?? recipientHex.toLowerCase(),
    relays: [...new Set(relays)],
    eventId: event.id,
    createdAt: event.created_at ?? 0,
  };
}

/**
 * Fetch a creator's kind:10019 nutzap info from the relays. Returns null
 * when the creator publishes none, when it lists no mint, or when the
 * lookup fails/times out — all of which mean "no nut zap, use the token
 * tip". Never throws.
 */
export async function fetchNutzapInfo(
  hexpubkey: string,
): Promise<NutzapInfo | null> {
  const ndk = getNdk();
  try {
    await ndk.connect(PUBLISH_CONNECT_TIMEOUT_MS);
  } catch {
    return null;
  }
  let events: Set<NDKEvent>;
  try {
    events = await withTimeout(
      ndk.fetchEvents({ kinds: [NUTZAP_INFO_KIND], authors: [hexpubkey], limit: 5 }),
      NUTZAP_FETCH_TIMEOUT_MS,
      new Set<NDKEvent>(),
    );
  } catch {
    return null;
  }
  // Newest event wins (kind:10019 is replaceable in practice).
  let best: NDKEvent | null = null;
  for (const e of events) {
    if (!best || (e.created_at ?? 0) > (best.created_at ?? 0)) best = e;
  }
  if (!best) return null;
  return parseNutzapInfoEvent(
    { id: best.id, created_at: best.created_at, tags: best.tags as string[][] },
    hexpubkey,
  );
}

/**
 * Pick a mint for the nut zap: it must be listed by the creator AND one
 * NutTip can use, and (when the creator lists units) it must support sats.
 * Returns the listed URL verbatim for the `u` tag plus NutTip's URL for
 * the same mint for the wallet. Null when no listed mint qualifies.
 */
export function pickNutzapMint(
  info: NutzapInfo,
  supportedMintUrls: string[],
): NutzapMintMatch | null {
  for (const mint of info.mints) {
    if (
      mint.units.length > 0 &&
      !mint.units.map((u) => u.toLowerCase()).includes('sat')
    ) {
      continue;
    }
    const norm = normalizeMintUrl(mint.url);
    for (const supported of supportedMintUrls) {
      if (norm === normalizeMintUrl(supported)) {
        return { listedUrl: mint.url, walletUrl: supported };
      }
    }
  }
  return null;
}

/** Fresh ephemeral keypair for one nut zap (sender is anonymous). */
export function createEphemeralSigner(ndk: NDK): EphemeralSigner {
  const secretKey = generateSecretKey();
  const pubkey = getPublicKey(secretKey);
  const signer = new NDKPrivateKeySigner(secretKey, ndk);
  return { secretKey, secretHex: bytesToHex(secretKey), pubkey, signer };
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** P2PK lock for a nut zap: lock to the creator, refund to the ephemeral
 *  sender after `lockDays`. The "02" prefix is required by NIP-61. */
export function buildNutzapLock(
  info: NutzapInfo,
  refundPubkeyHex: string,
  lockDays: number = NUTZAP_REFUND_LOCK_DAYS,
): P2PKOptions {
  const lockUntil = Math.floor(Date.now() / 1000) + lockDays * 86400;
  return new P2PKBuilder()
    .addLockPubkey(`02${info.pubkey}`)
    .addRefundPubkey(`02${refundPubkeyHex}`)
    .lockUntil(lockUntil)
    .toOptions();
}

/** Build the kind:9321 nutzap event (unsigned — the signer signs on publish).
 *  Tags per NIP-61: amount, unit, one `proof` tag per proof (JSON), `u`
 *  (mint URL exactly as listed), `p` (recipient). No `e` tag: NutTip tips
 *  a creator, not a specific event. */
export function buildNutzapEvent(
  ndk: NDK,
  opts: {
    recipientHex: string;
    amount: number;
    mintUrl: string;
    proofs: Proof[];
    message?: string;
  },
): NDKEvent {
  const tags: string[][] = [
    ['amount', String(opts.amount)],
    ['unit', 'sat'],
    ...opts.proofs.map((p) => ['proof', JSON.stringify(p)]),
    ['u', opts.mintUrl],
    ['p', opts.recipientHex],
  ];
  return new NDKEvent(ndk, {
    kind: NUTZAP_KIND,
    content: opts.message ?? '',
    tags,
  });
}

export interface NutzapPublishResult {
  eventId: string;
  noteId: string;
  publishedRelays: string[];
}

/**
 * Publish a signed kind:9321 event to the recipient's listed relays
 * (falling back to NutTip's default relays when none are listed).
 * Throws when no relay accepted it.
 */
export async function publishNutzapEvent(opts: {
  ndk: NDK;
  event: NDKEvent;
  relays?: string[];
  timeoutMs?: number;
}): Promise<NutzapPublishResult> {
  const { ndk, event, relays, timeoutMs = NUTZAP_PUBLISH_TIMEOUT_MS } = opts;
  let relaySet: NDKRelaySet | undefined;
  if (relays && relays.length > 0) {
    relaySet = NDKRelaySet.fromRelayUrls(relays, ndk, true);
  }
  const published = await event.publish(relaySet, timeoutMs);
  const publishedRelays = [...published].map((r) => r.url);
  if (publishedRelays.length === 0) {
    throw new Error('Nut zap event was not accepted by any relay');
  }
  return {
    eventId: event.id,
    noteId: nip19.noteEncode(event.id),
    publishedRelays,
  };
}

/** Pending (locked but unpublished / unclaimed) nut zaps, for refunds. */
export function savePendingNutzap(p: PendingNutzap): void {
  try {
    const list = listPendingNutzaps();
    list.push(p);
    localStorage.setItem(PENDING_KEY, JSON.stringify(list));
  } catch {
    // Storage failure must never break a tip; the in-memory flow continues.
  }
}

export function listPendingNutzaps(): PendingNutzap[] {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PendingNutzap[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function removePendingNutzap(createdAt: number): void {
  try {
    const list = listPendingNutzaps().filter((p) => p.createdAt !== createdAt);
    localStorage.setItem(PENDING_KEY, JSON.stringify(list));
  } catch {
    // Ignore storage failures.
  }
}

export interface NutzapSendResult {
  eventId: string;
  noteId: string;
  amount: number;
  mint: string;
  publishedRelays: string[];
  /** Change proofs — already saved to localStorage by this function. */
  keep: Proof[];
}

/**
 * Send a one-tap nut zap: P2PK-lock `amount` sats to the creator (refund
 * to the ephemeral sender after the lock window), then publish kind:9321.
 *
 * Safety order: the lock happens first, then the change proofs are saved
 * and the refund key + locked token are persisted, THEN the event is
 * published — so a publish failure can never silently strand the tip.
 * On failure before the lock, throws NutzapError with locked=false (the
 * caller should fall back to the token tip). On failure after the lock,
 * throws NutzapError with locked=true plus the signed event and the
 * locked token (the caller must offer a publish retry / manual share,
 * never a silent re-send).
 */
export async function sendNutzap(opts: {
  wallet: Wallet;
  proofs: Proof[];
  amount: number;
  message: string;
  recipientHex: string;
  info: NutzapInfo;
  mint: NutzapMintMatch;
  onStatus?: (s: string) => void;
}): Promise<NutzapSendResult> {
  const { wallet, proofs, amount, message, recipientHex, info, mint } = opts;

  // Dedicated publishing NDK: recipient's relays first, then NutTip's
  // defaults. Isolated from the read-only shared NDK — this one signs.
  const publishNdk = new NDK({
    explicitRelayUrls: [
      ...new Set([...(info.relays.length > 0 ? info.relays : []), ...DEFAULT_RELAYS]),
    ],
  });
  const ephemeral = createEphemeralSigner(publishNdk);
  publishNdk.signer = ephemeral.signer;

  const lock = buildNutzapLock(info, ephemeral.pubkey);
  const lockUntil =
    Math.floor(Date.now() / 1000) + NUTZAP_REFUND_LOCK_DAYS * 86400;

  opts.onStatus?.('Locking your tip to the creator…');
  let sendResult: { keep: Proof[]; send: Proof[] };
  try {
    sendResult = await wallet.ops
      .send(amount, proofs)
      .includeFees(true)
      .asLocked(lock)
      .run();
  } catch (e) {
    throw new NutzapError(e instanceof Error ? e.message : String(e), {
      locked: false,
    });
  }

  // Proofs are now P2PK-locked. Save change + refund record BEFORE
  // publishing, so nothing is lost if the publish fails.
  saveProofs(mint.walletUrl, sendResult.keep);
  const token = encodeToken(mint.walletUrl, sendResult.send, message || undefined);
  savePendingNutzap({
    mint: mint.walletUrl,
    token,
    secretHex: ephemeral.secretHex,
    recipient: recipientHex,
    amount,
    lockUntil,
    createdAt: Date.now(),
  });

  const event = buildNutzapEvent(publishNdk, {
    recipientHex,
    amount,
    mintUrl: mint.listedUrl,
    proofs: sendResult.send,
    message,
  });
  opts.onStatus?.('Publishing the nut zap…');
  try {
    await publishNdk.connect(PUBLISH_CONNECT_TIMEOUT_MS);
  } catch {
    // Connect timeout still allows publish attempts; NDK keeps connecting.
  }
  try {
    const published = await publishNutzapEvent({
      ndk: publishNdk,
      event,
      relays: info.relays,
    });
    return {
      eventId: published.eventId,
      noteId: published.noteId,
      amount,
      mint: mint.walletUrl,
      publishedRelays: published.publishedRelays,
      keep: sendResult.keep,
    };
  } catch (e) {
    throw new NutzapError(e instanceof Error ? e.message : String(e), {
      locked: true,
      event,
      token,
    });
  }
}
