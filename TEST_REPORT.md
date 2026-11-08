# NutTip — build + test report (8 Nov 2026)

Scaffold + Nov 8–10 scope. Local only — not pushed to GitHub, no repo
created, nothing posted, nothing submitted, no real sats.

## Build

- `pnpm install` — @cashu/cashu-ts 4.13.0, @nostr-dev-kit/ndk 2.13, React 18,
  Vite 5, TypeScript 5.9. One hiccup: pnpm ignored the esbuild postinstall
  script; fixed with `pnpm approve-builds esbuild`.
- `pnpm build` — **PASS** (tsc + vite). Output `dist/` (~838 kB JS, 256 kB
  gzip — chunk-size warning only, code-splitting is a later polish item).
- `vite preview` smoke test — **PASS** (HTTP 200, correct index.html).

## Cashu loop test — `pnpm test:cashu` — PASS (run 3×)

Script: `scripts/test-cashu-loop.mjs`, 21 fake sats on testnut.

1. `loadMint()` — OK, "Testnut mint" (cdk-mintd 0.18.1, FakeWallet).
2. Mint quote created (UNPAID) → auto-marked **PAID after ~4 s** (testnut
   FakeWallet settles its own invoices; no real payment).
3. Minted **21 sats** (3 proofs).
4. Send 10 sats → keep 9, send proofs 11 (1 sat input fee at 100 ppk;
   receiver gets exactly 10).
5. Fresh wallet receives the token → **10 sats**. Loop: mint → send →
   receive **OK**.

Findings while testing:
- `nofee.testnut.cashu.space` returns empty replies (curl 52) from this VM
  on 8 Nov 2026 — it is **down/unreachable here**. Default mint switched
  to `https://testnut.cashu.space` (with fees); nofee kept as a fallback
  option in the mint selector. All code + README updated.
- One early run failed with an undici `UND_ERR_SOCKET` on the first POST
  after `loadMint` (keep-alive race); re-runs passed 3×. The app retries
  nothing yet — if a user hits this, retrying the tip is the workaround;
  a retry wrapper is a known polish item.
- `cashu-ts` v4 deprecation: implicit `Number(Amount)` coercion warns;
  code now uses `Amount.toNumber()`.
- Fee buffer: the tip form now mints `amount + max(2, 2%)` when the local
  balance is short, because minting exactly `amount` would leave the send
  short after input fees. The extra stays in localStorage as change.

## Nostr profile lookup — NOT VERIFIED live in this VM

- `scripts/test-nostr.mjs` (`pnpm test:nostr`): NDK `connect()` hung with
  no output for 60 s+ — relay websocket egress appears blocked in this
  sandbox. Killed; no profile was fetched.
- Fix applied: `fetchCreatorProfile()` now races `ndk.connect()` against
  an 8 s timeout and surfaces a clear error instead of hanging the UI.
- **Must be verified in a browser / on the deployed site** before the
  demo video: open a real creator's tip page and confirm name/avatar load.
  The code path itself (NDK + `fetchProfile`, npub parsing via
  `nostr-tools` nip19) type-checks and builds.

## What works end-to-end (code-complete, testnut-proven for Cashu)

- Home page: paste npub/hex → opens `/tip/<npub>`.
- Tip form: mint test ecash if short → split tip → Cashu token
  (`cashuA…`) + `cashu:` URI + QR + shareable tip link.
- Tip page: creator card (Nostr profile), claim box for `?token=` links
  (receive into a fresh wallet, proofs saved to localStorage).
- Proofs persist in localStorage only; testnet warning shown throughout.

## Still missing (next steps, Nov 11–27 plan)

1. **Nostr profile lookup live verification** in a browser (see above).
2. Nut zap (NIP-61) — stretch goal, time-boxed 13–14 Nov; token/QR is the
   core path and already works.
3. Deploy draft (Vercel / GitHub Pages) + SPA fallback for `/tip/<npub>`.
4. Demo video (1–2 min, testnut) + screenshots.
5. Create GitHub repo `0xbcw/nuttip` (parent, via browser login) and push
   this code; README + Notes for the Nut November form (all work Nov 8–27).
6. Submit via https://nutnovember.org/form on 26 Nov (not the 27th).
7. After it is on GitHub: share on X (@0xbcw_) with #NutNovember, repo
   link + demo (per Eoet, 8 Nov 2026). Do NOT post before the repo is live.
