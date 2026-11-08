/**
 * Proof storage for NutTip.
 *
 * Cashu wallets are stateless — proofs ARE the money. NutTip stores the
 * tipper's proofs in localStorage only, on their own device. Nothing is
 * sent to a server (there is no server). Clearing browser data loses the
 * proofs, so the UI warns about that before minting.
 */
import type { Proof } from '@cashu/cashu-ts';

const KEY = 'nuttip:proofs:v1';
const MINT_KEY = 'nuttip:mint:v1';

export interface StoredProofs {
  mint: string;
  proofs: Proof[];
}

export function loadProofs(): StoredProofs | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredProofs;
    if (!parsed || !Array.isArray(parsed.proofs)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveProofs(mint: string, proofs: Proof[]): void {
  localStorage.setItem(KEY, JSON.stringify({ mint, proofs }));
  localStorage.setItem(MINT_KEY, mint);
}

export function clearProofs(): void {
  localStorage.removeItem(KEY);
}

export function loadMint(): string | null {
  return localStorage.getItem(MINT_KEY);
}
