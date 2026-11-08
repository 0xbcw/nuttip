import { useState } from 'react';
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
  onTipped?: (result: TipResult) => void;
}

/**
 * Tip form: mint fake test ecash if needed, then send a Cashu token tip.
 *
 * Flow: load wallet on the test mint -> if local proofs cover the amount,
 * use them; otherwise mint test ecash first (testnut, fake sats) -> split
 * out `amount` sats -> encode as a cashu: token -> show token + QR + link.
 * The tipper's remaining proofs stay in localStorage.
 */
export default function TipForm({ npub, creatorName, onTipped }: TipFormProps) {
  const [amount, setAmount] = useState(21);
  const [message, setMessage] = useState('');
  const [mintUrl, setMintUrl] = useState(DEFAULT_MINT);
  const [status, setStatus] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TipResult | null>(null);
  const [error, setError] = useState<string>('');

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
      <button onClick={handleTip} disabled={busy}>
        {busy ? 'Working…' : `Send ${amount} sats tip`}
      </button>
      {status && <p className="status">{status}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
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
