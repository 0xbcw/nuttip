import { useState } from 'react';
import TipPage from '../components/TipPage';
import { hexToNpub, parseNpub } from '../lib/nostr';

/**
 * NutTip home page.
 *
 * Paste a creator's npub to open their tip page (/tip/<npub>), or open a
 * tip link directly. Routing is hash-free and dependency-free: the path
 * after /tip/ is read from window.location.pathname, so the static build
 * works on Vercel / GitHub Pages with a SPA fallback.
 */
export function getRoute(): { npub: string | null; token: string | null } {
  if (typeof window === 'undefined') return { npub: null, token: null };
  const match = window.location.pathname.match(/\/tip\/([^/]+)/);
  const params = new URLSearchParams(window.location.search);
  return {
    npub: match ? decodeURIComponent(match[1]) : null,
    token: params.get('token'),
  };
}

export default function Page() {
  const [route] = useState(getRoute);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');

  if (route.npub) {
    return <TipPage npub={route.npub} token={route.token} />;
  }

  function openTipPage() {
    try {
      const hex = parseNpub(input);
      // Always navigate with a clean npub URL.
      window.location.assign(`/tip/${encodeURIComponent(hexToNpub(hex))}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section className="home">
      <h2>Tip any Nostr creator in sats — no account, no login.</h2>
      <p>
        NutTip is a Cashu tip jar. Paste a creator&apos;s npub, type an
        amount, and pay with Cashu ecash. They get a shareable tip link and a
        QR code they can claim in any Cashu wallet.
      </p>
      <label>
        Creator&apos;s npub (npub1…) or hex pubkey
        <input
          type="text"
          placeholder="npub1…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') openTipPage();
          }}
        />
      </label>
      <button onClick={openTipPage}>Open tip page</button>
      {error && <p className="error">{error}</p>}
      <p className="testnet-warning">
        ⚠️ Test mint only — NutTip currently uses testnut, a test mint with
        fake sats, for testing. Do not send real money here.
      </p>
    </section>
  );
}
