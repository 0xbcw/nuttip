/**
 * NutTip — Cashu wallet helpers.
 *
 * Built on @cashu/cashu-ts v4.13. Cashu wallets are stateless: the app must
 * store proofs itself (see storage.ts). All minting here targets testnut,
 * a test mint with unbacked FAKE ecash — no real sats, ever, in this app.
 *
 * Docs: https://cashu-ts.dev/ — Wallet, loadMint(), ops.send/receive,
 * createMintQuoteBolt11(), ops.mintBolt11().
 */
import {
  Wallet,
  getEncodedToken,
  getDecodedToken,
  sumProofs,
  type P2PKOptions,
  type Proof,
} from '@cashu/cashu-ts';

/** Default mint: testnut, no fees, fake ecash. Clearly labelled in the UI. */
export const DEFAULT_MINT = 'https://testnut.cashu.space';

export const TEST_MINTS = [
  // testnut.cashu.space is the working default (verified 8 Nov 2026):
  // FakeWallet — all Lightning invoices are auto-marked paid, fake sats only.
  { url: 'https://testnut.cashu.space', label: 'testnut (fake sats)' },
  // nofee.testnut.cashu.space returned empty replies on 8 Nov 2026 — kept as
  // a fallback in case it comes back.
  { url: 'https://nofee.testnut.cashu.space', label: 'testnut, no fees (fallback, fake sats)' },
] as const;

export type { Proof };

export function totalSats(proofs: Proof[]): number {
  return sumProofs(proofs).toNumber();
}

/** Load a wallet for a mint URL. Must be called before any wallet op. */
export async function getWallet(mintUrl: string): Promise<Wallet> {
  const wallet = new Wallet(mintUrl);
  await wallet.loadMint();
  return wallet;
}

/**
 * Mint fake test ecash on testnut.
 *
 * Testnut mints are for testing: the mint quote's Lightning invoice is
 * settled by the test mint itself (no real payment). We poll the quote
 * until the mint marks it PAID, then mint the proofs.
 *
 * @throws if the quote is not paid within the poll window.
 */
export async function mintTestEcash(
  wallet: Wallet,
  amount: number,
  opts: { pollMs?: number; maxWaitMs?: number } = {},
): Promise<Proof[]> {
  const pollMs = opts.pollMs ?? 2000;
  const maxWaitMs = opts.maxWaitMs ?? 60_000;
  const quote = await wallet.createMintQuoteBolt11(amount, 'NutTip test mint');
  const started = Date.now();
  for (;;) {
    const state = await wallet.checkMintQuoteBolt11(quote.quote);
    if (state.state === 'PAID') break;
    if (Date.now() - started > maxWaitMs) {
      throw new Error(
        `Mint quote ${quote.quote} was not paid after ${maxWaitMs / 1000}s ` +
          `(state: ${state.state}). On testnut this normally auto-settles; ` +
          'the mint may be down — try the other test mint.',
      );
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  const proofs = await wallet.ops.mintBolt11(amount, quote).run();
  return proofs;
}

/** Split proofs into a sendable amount; returns { keep, send }. */
export async function splitForSend(
  wallet: Wallet,
  proofs: Proof[],
  amount: number,
): Promise<{ keep: Proof[]; send: Proof[] }> {
  return wallet.ops.send(amount, proofs).includeFees(true).run();
}

/**
 * Split proofs into a P2PK-locked sendable amount; returns { keep, send }.
 * The `send` proofs are locked to the spending condition in `p2pk`
 * (e.g. a nut zap lock); the `keep` (change) proofs stay bearer.
 */
export async function splitForSendLocked(
  wallet: Wallet,
  proofs: Proof[],
  amount: number,
  p2pk: P2PKOptions,
): Promise<{ keep: Proof[]; send: Proof[] }> {
  return wallet.ops.send(amount, proofs).includeFees(true).asLocked(p2pk).run();
}

/** Encode proofs as a Cashu token string (cashuA…), with an optional memo. */
export function encodeToken(
  mintUrl: string,
  proofs: Proof[],
  memo?: string,
): string {
  return getEncodedToken({ mint: mintUrl, proofs, memo, unit: 'sat' });
}

/** Build a shareable tip link for a token: /tip/<npub>?token=<cashu…> */
export function buildTipLink(npub: string, token: string): string {
  const base = `${window.location.origin}/tip/${encodeURIComponent(npub)}`;
  return `${base}?token=${encodeURIComponent(token)}`;
}

/** Decode a Cashu token string. Needs the mint's keyset ids for v4 tokens. */
export function decodeToken(token: string, keysetIds: string[]) {
  return getDecodedToken(token, keysetIds);
}

/**
 * Receive a Cashu token into this wallet (swaps with the mint for new proofs).
 * Returns the received proofs.
 */
export async function receiveToken(
  wallet: Wallet,
  token: string,
): Promise<Proof[]> {
  return wallet.ops.receive(token).run();
}
