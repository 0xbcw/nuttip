import { useEffect, useState } from 'react';
import {
  fetchCreatorProfile,
  parseNpub,
  type CreatorProfile,
} from '../lib/nostr';
import {
  fetchNutzapInfo,
  type NutzapInfo,
} from '../lib/nutzap';
import {
  DEFAULT_MINT,
  getWallet,
  receiveToken,
  totalSats,
} from '../lib/cashu';
import { saveProofs } from '../lib/storage';
import TipForm from './TipForm';
import TokenQR from './TokenQR';

interface TipPageProps {
  npub: string;
  /** Cashu token from ?token= — someone sent this creator a tip. */
  token?: string | null;
}

/**
 * Public tip page for one Nostr creator: /tip/<npub>
 * Shows the creator's Nostr profile (name, picture, about), a tip form,
 * and — when opened with ?token= — a claim box for that tip.
 */
export default function TipPage({ npub, token }: TipPageProps) {
  const [profile, setProfile] = useState<CreatorProfile | null>(null);
  const [profileError, setProfileError] = useState('');
  const [nutzapInfo, setNutzapInfo] = useState<NutzapInfo | null>(null);
  const [claimStatus, setClaimStatus] = useState('');
  const [claimed, setClaimed] = useState<number | null>(null);
  const [claimError, setClaimError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchCreatorProfile(npub)
      .then((p) => {
        if (!cancelled) setProfile(p);
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setProfileError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [npub]);

  // Nut zap availability (kind:10019) is looked up alongside the profile.
  // Null is the normal case — most creators publish none, and the page
  // then offers the token tip only. A failed lookup is never an error.
  useEffect(() => {
    let cancelled = false;
    let hex: string;
    try {
      hex = parseNpub(npub);
    } catch {
      return;
    }
    fetchNutzapInfo(hex)
      .then((info) => {
        if (!cancelled) setNutzapInfo(info);
      })
      .catch(() => {
        // Lookup failure = no nut zap; token tip stays available.
      });
    return () => {
      cancelled = true;
    };
  }, [npub]);

  async function handleClaim() {
    if (!token) return;
    setClaimStatus('Claiming your tip…');
    setClaimError('');
    try {
      const wallet = await getWallet(DEFAULT_MINT);
      const received = await receiveToken(wallet, token);
      saveProofs(DEFAULT_MINT, received);
      setClaimed(totalSats(received));
      setClaimStatus('');
    } catch (e) {
      setClaimError(e instanceof Error ? e.message : String(e));
      setClaimStatus('');
    }
  }

  const displayName =
    profile?.displayName || profile?.name || npub.slice(0, 12) + '…';

  return (
    <section className="tip-page">
      <div className="creator-card">
        {profile?.picture && (
          <img src={profile.picture} alt="" className="creator-avatar" />
        )}
        <h2>{displayName}</h2>
        {profile?.about && <p>{profile.about}</p>}
        <p className="npub">{npub}</p>
        {profileError && (
          <p className="error">Could not load Nostr profile: {profileError}</p>
        )}
      </div>

      {token && (
        <div className="claim-box">
          <h3>🎁 You received a Cashu tip!</h3>
          <TokenQR value={token} size={160} />
          {claimed === null ? (
            <>
              <button onClick={handleClaim} disabled={!!claimStatus}>
                {claimStatus || 'Claim this tip'}
              </button>
              {claimError && <p className="error">{claimError}</p>}
              <p className="testnet-warning">
                Test mint only — this tip is fake testnut ecash, for testing.
              </p>
            </>
          ) : (
            <p className="status">
              Claimed {claimed} sats! The proofs are saved in this browser.
            </p>
          )}
        </div>
      )}

      <TipForm npub={npub} creatorName={displayName} nutzapInfo={nutzapInfo} />
    </section>
  );
}
