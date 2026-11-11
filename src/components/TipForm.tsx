import { useMemo, useState } from 'react';
import type { NDKEvent } from '@nostr-dev-kit/ndk';
import type { Proof } from '@cashu/cashu-ts';
import {
  DEFAULT_MINT,
  TEST_MINTS,
  buildTipLink,
  encodeToken,
  getWallet,
  mintTestEcash,
  splitForSend,
  totalSats,
} from '../lib/cashu';
import { parseNpub } from '../lib/nostr';
import {
  NutzapError,
  pickNutzapMint,
  publishNutzapEvent,
  sendNutzap,
  type NutzapInfo,
  type NutzapSendResult,
} from '../lib/nutzap';
import { loadProofs, saveProofs } from '../lib/storage';
import TokenQR from './TokenQR';

export interface TipResult {
  npub: string;
  amount: number;
  message: string;
  token: string;
  tipLink: string;
  mint: string;
}

interface TipFormProps {
  npub: string;
  creatorName?: string;
  /** Creator's kind:10019 info when they publish one; null = token tip only. */
  nutzapInfo?: NutzapInfo | null;
  onTipped?: (result: TipResult) => void;
}

/** A nut zap whose proofs are locked but whose kind:9321 did not publish. */
interface FailedZap {
  event: NDKEvent;
  token: string;
  mint: string;
  amount: number;
  message: string;
}

/**
 * Tip form: mint fake test ecash if needed, then send a Cashu tip.
 *
 * Two ways to tip, same amount + message:
 * - Token tip (always available): split out `amount` sats, encode as a
 *   cashu: token, show token + QR + link. The tipper's remaining proofs
 *   stay in localStorage.
 * - One-tap nut zap (NIP-61, only when the creator publishes kind:10019
 *   listing testnut): mint, P2PK-lock the tip to the creator, publish a
 *   kind:9321 event. No token to share. On failure BEFORE the lock it
 *   falls back to the token tip automatically; on failure AFTER the lock
 *   (publish failed) it never re-sends — the locked tip is offered for a
 *   publish retry or as a shareable token instead.
 */
export default function TipForm({ npub, creatorName, nutzapInfo, onTipped }: TipFormProps) {
  const [amount, setAmount] = useState(21);
  const [message, setMessage] = useState('');
  const [mintUrl, setMintUrl] = useState(DEFAULT_MINT);
  const [status, setStatus] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TipResult | null>(null);
  const [error, setError] = useState<string>('');
  const [nutzapResult, setNutzapResult] = useState<NutzapSendResult | null>(null);
  const [nutzapNote, setNutzapNote] = useState<string>('');
  const [failedZap, setFailedZap] = useState<FailedZap | null>(null);

  // Nut zap only when the creator listed a mint NutTip can actually use.
  // Deliberately testnut only: the nofee fallback mint is unreliable, and
  // a nut zap must go to a mint the recipient listed AND that works.
  const nutzapMint = useMemo(
    () => (nutzapInfo ? pickNutzapMint(nutzapInfo, [DEFAULT_MINT]) : null),
    [nutzapInfo],
  );

  async function handleTip() {
    if (amount <= 0) {
      setError('Amount must be at least 1 sat.');
      return;
    }
    setBusy(true);
    setError('');
    setResult(null);
    try {
      setStatus('Loading test mint…');
      const wallet = await getWallet(mintUrl);
      let stored = loadProofs();
      let proofs: Proof[] =
        stored && stored.mint === mintUrl ? stored.proofs : [];
      if (totalSats(proofs) < amount) {
        // Mint a little extra: testnut charges input fees (~100 ppk), so
        // minting exactly `amount` would leave the send short. The extra
        // stays in localStorage as change for the next tip.
        const feeBuffer = Math.max(2, Math.ceil(amount * 0.02));
        const mintAmount = amount - totalSats(proofs) + feeBuffer;
        setStatus(
          `Minting ${mintAmount} test sats on testnut (fake ecash)…`,
        );
        const minted = await mintTestEcash(wallet, mintAmount);
        proofs = [...proofs, ...minted];
      }
      setStatus('Creating your Cashu tip token…');
      const { keep, send } = await splitForSend(wallet, proofs, amount);
      saveProofs(mintUrl, keep);
      const token = encodeToken(mintUrl, send, message || undefined);
      const tipLink = buildTipLink(npub, token);
      const tip: TipResult = { npub, amount, message, token, tipLink, mint: mintUrl };
      setResult(tip);
      setStatus('');
      onTipped?.(tip);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus('');
    } finally {
      setBusy(false);
    }
  }

  async function handleNutzap() {
    if (!nutzapInfo || !nutzapMint || amount <= 0) return;
    setBusy(true);
    setError('');
    setResult(null);
    setNutzapResult(null);
    setFailedZap(null);
    setNutzapNote('');
    try {
      setStatus('Loading test mint…');
      const wallet = await getWallet(nutzapMint.walletUrl);
      let stored = loadProofs();
      let proofs: Proof[] =
        stored && stored.mint === nutzapMint.walletUrl ? stored.proofs : [];
      if (totalSats(proofs) < amount) {
        const feeBuffer = Math.max(2, Math.ceil(amount * 0.02));
        const mintAmount = amount - totalSats(proofs) + feeBuffer;
        setStatus(
          `Minting ${mintAmount} test sats on testnut (fake ecash)…`,
        );
        const minted = await mintTestEcash(wallet, mintAmount);
        proofs = [...proofs, ...minted];
      }
      const sent = await sendNutzap({
        wallet,
        proofs,
        amount,
        message,
        recipientHex: parseNpub(npub),
        info: nutzapInfo,
        mint: nutzapMint,
        onStatus: setStatus,
      });
      setNutzapResult(sent);
      setStatus('');
    } catch (e) {
      if (e instanceof NutzapError && e.locked) {
        // Proofs are already P2PK-locked to the creator. Never auto-fallback
        // to a token tip here — that would mint fresh proofs and strand the
        // locked ones. Offer a publish retry and the locked token instead.
        setFailedZap({
          event: e.event!,
          token: e.token ?? '',
          mint: nutzapMint.walletUrl,
          amount,
          message,
        });
        setError(
          `Nut zap created but publishing failed: ${e.message}. Your tip is locked to the creator — retry publishing below, or share the token directly.`,
        );
        setStatus('');
      } else {
        // Failed before any lock: nothing is locked, so fall back to the
        // normal token tip — the tip still goes through.
        setNutzapNote(
          'One-tap tip didn’t go through — sending as a token tip instead.',
        );
        setStatus('');
        await handleTip();
        return;
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleRetryZapPublish() {
    if (!failedZap) return;
    setBusy(true);
    setError('');
    try {
      setStatus('Retrying nut zap publish…');
      const published = await publishNutzapEvent({
        ndk: failedZap.event.ndk!,
        event: failedZap.event,
        relays: nutzapInfo?.relays,
      });
      setNutzapResult({
        eventId: published.eventId,
        noteId: published.noteId,
        amount: failedZap.amount,
        mint: failedZap.mint,
        publishedRelays: published.publishedRelays,
        keep: [],
      });
      setFailedZap(null);
      setStatus('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="tip-form">
      <h2>Tip {creatorName ? `${creatorName} ` : ''}with Cashu</h2>
      <p className="testnet-warning">
        ⚠️ Test mint only — these are <strong>fake sats</strong> from
        testnut, for testing. Do not send real money here.
      </p>
      <label>
        Mint
        <select
          value={mintUrl}
          onChange={(e) => setMintUrl(e.target.value)}
          disabled={busy}
        >
          {TEST_MINTS.map((m) => (
            <option key={m.url} value={m.url}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Amount (sats)
        <input
          type="number"
          min={1}
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
          disabled={busy}
        />
      </label>
      <label>
        Message (optional)
        <input
          type="text"
          maxLength={140}
          placeholder="Thanks for the great notes!"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={busy}
        />
      </label>

      {nutzapMint && (
        <div className="nutzap-box">
          <p>
            ⚡ This creator accepts one-tap Cashu tips (nut zap). One tap
            mints, locks and sends — no token to share.
          </p>
          <button onClick={handleNutzap} disabled={busy}>
            {busy ? 'Working…' : `⚡ Send ${amount} sats in one tap`}
          </button>
        </div>
      )}

      <button onClick={handleTip} disabled={busy}>
        {busy ? 'Working…' : `Send ${amount} sats tip`}
      </button>
      {nutzapNote && <p className="status">{nutzapNote}</p>}
      {status && <p className="status">{status}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {nutzapResult && (
        <div className="tip-result">
          <h3>⚡ Nut zap sent!</h3>
          <p>
            {nutzapResult.amount} sats locked to the creator on{' '}
            {nutzapResult.mint}. Their Nostr client will pick it up from
            the relays.
          </p>
          <label>
            Nut zap event
            <input readOnly value={nutzapResult.noteId} />
          </label>
          <p>
            Published to {nutzapResult.publishedRelays.length} relay
            {nutzapResult.publishedRelays.length === 1 ? '' : 's'}.
          </p>
        </div>
      )}

      {failedZap && (
        <div className="tip-result">
          <h3>⚡ Nut zap created — not yet published</h3>
          <p>
            {failedZap.amount} sats are locked to the creator. Share this
            token with them directly — it can be claimed in a Cashu wallet
            that holds their nutzap key:
          </p>
          <label>
            Locked Cashu token
            <textarea readOnly value={failedZap.token} rows={4} />
          </label>
          <button onClick={handleRetryZapPublish} disabled={busy}>
            {busy ? 'Working…' : 'Retry publishing the nut zap'}
          </button>
        </div>
      )}

      {result && (
        <div className="tip-result">
          <h3>Tip ready — share it!</h3>
          <TokenQR value={result.token} />
          <label>
            Cashu token
            <textarea readOnly value={result.token} rows={4} />
          </label>
          <label>
            Tip link
            <input readOnly value={result.tipLink} />
          </label>
          <p>
            Send the link or token to the creator — they can claim it in any
            Cashu wallet. Amount: {result.amount} sats
            {result.message ? ` · “${result.message}”` : ''} · Mint:{' '}
            {result.mint}
          </p>
        </div>
      )}
    </section>
  );
}
