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

## Nostr profile lookup fix — 8 Nov 2026 (evening, after Vercel deploy)

- Live failure: real npubs jack (npub1sg6…) and fiatjaf (npub180c…) showed
  "Could not load Nostr profile: Timed out connecting to Nostr relays"
  after ~20-25s on https://nuttip-1pt6i3eo9-0xbcw.vercel.app. Tip form
  and navigation worked; only the profile fetch failed.
- Root cause (confirmed in NDK 2.13 source): `NDKPool.connect()` only
  resolves when *every* configured relay is CONNECTED. The old code called
  `ndk.connect()` with no timeout, so one slow/dead relay blocked the
  whole lookup. (The old 8s `Promise.race` rejected the lookup instead of
  letting a partial connection through.)
- Fix (`src/lib/nostr.ts`, no new deps, no backend/env vars):
  - `ndk.connect(6000)` — NDK's own timeout: resolves when it elapses even
    if only some relays are up; connection continues in the background.
  - Relay kind-0 fetch raced at 5s.
  - HTTP fallback in parallel: nostr.band API
    (`api.nostr.band/v0/profile/<hex>`, wrapped or bare JSON) and njump.me
    profile page Open Graph tags (`og:title`/`og:image`/`og:description`).
    First usable profile wins.
  - A missing profile is never an error any more: `fetchCreatorProfile()`
    resolves a bare { npub, hexpubkey } profile and TipPage falls back to
    showing the npub. Only an invalid npub/hex throws. Whole lookup is
    capped at 20s (typical failure in this VM ~11s).
- Verification in this VM (`node scripts/test-nostr-fix.mjs`, new script):
  `pnpm build` PASS. jack resolved in ~8s WITH name + picture via the HTTP
  fallback (relays blocked here) — the fallback path is proven live.
  fiatjaf degraded gracefully in ~11s (bare profile, console warning, no
  throw, no hang). Invalid npub still throws as expected.
- NOT verifiable from this VM: relay path in a real browser (websocket
  egress blocked here), and the nostr.band API specifically (blocked here
  with empty replies; njump.me is the fallback that demonstrably works).
- **Must be re-checked in a browser on the deployed site after redeploy:**
  open /tip/<real npub> for jack and fiatjaf and confirm name/avatar load
  quickly (seconds, not ~20s). Redeploy = upload changed files to GitHub
  (Vercel auto-deploys main): `src/lib/nostr.ts`,
  `scripts/test-nostr-fix.mjs`, `scripts/test-nostr.mjs` (comment only),
  `TEST_REPORT.md`.

## Nut zap (NIP-61) one-tap tip — BUILT 12 Nov 2026, verified locally

Eoet tapped "Build the nut zap now" 12 Nov 2026 (see the "Add one-tap
Cashu tip" commit in `git log`). Test sats only, testnut only; token tip
untouched as the fallback everywhere.

What changed: new `src/lib/nutzap.ts` (`fetchNutzapInfo`,
`parseNutzapInfoEvent`, `pickNutzapMint`, `createEphemeralSigner`,
`buildNutzapLock`, `buildNutzapEvent`, `publishNutzapEvent`,
`sendNutzap`, pending-zap localStorage helpers, `NutzapError` with a
`locked` flag); `TipForm` gains the one-tap box + "⚡ Nut zap sent"
result + locked-but-unpublished retry UI; `TipPage` fetches kind:10019
alongside the profile (null = token tip only, lookup failure never an
error); `src/lib/cashu.ts` gains `splitForSendLocked()`;
`src/lib/nostr.ts` exports `getNdk()`; `.nutzap-box` style in
`src/index.css`. New scripts: `scripts/test-nutzap.mjs` (verification)
and `scripts/test-nutzap-identity.mjs` (throwaway test identity).

Design (per NUTZAP_PLAN.md): a nut zap is only offered when the creator
publishes kind:10019 listing a mint NutTip can use (testnut). The tip is
minted on the listed mint, P2PK-locked to the pubkey in kind:10019
("02" prefix), refund pubkey + lockUntil (+7 days) to the ephemeral
sender key, then kind:9321 is published (ephemeral in-browser keypair
per tip, discarded except its secret saved with the locked token for
refunds). The `u` tag carries the mint URL exactly as listed.
jack publishes no kind:10019 (verified 11 Nov), so his page shows only
the token tip — as before.

Verification in this VM, `node scripts/test-nutzap.mjs` — **all
VM-verifiable checks PASSED** (exit 0):
- testnut /v1/info: NUT-11 supported.
- Mint 21 sats → P2PK-locked send 10 (send proofs 11 incl. 1 sat input
  fee, keep 9) → locked proof secret is P2PK, data = `02<lock pubkey>`,
  refund tag + locktime tag present.
- Locked token CANNOT be received with a wrong key; received with the
  lock key → exactly 10 sats.
- kind:10019 parse/pick (real code, synthetic events): full event,
  testnut picked, USD-only mint skipped, no pubkey tag falls back to
  recipient hex, no mints → null, trailing-slash URL still matches.
- kind:9321 event (real code): kind 9321, amount 10, unit sat, `u` =
  listed mint verbatim, `p` = recipient, proof tags match the locked
  proofs, no `e` tag.
- `pnpm test:cashu` re-run 12 Nov 2026 — **PASS** (mint → send → receive,
  21 in / 10 received). Token tip path unchanged and working.
- `pnpm build` — **PASS** (tsc + vite; only the pre-existing chunk-size
  warning).

NOT verifiable from this VM (honest gap): kind:10019 fetch from real
relays and kind:9321 publish both fail here — relay websockets are
blocked (publish attempt timed out after 10s; `fetchNutzapInfo(jack)`
returned null). Both need a real browser on the live site.

Throwaway test identity: `node scripts/test-nutzap-identity.mjs`
generated a fresh test-only npub
`npub15j2l90pzsjc7cpvzr7w4s6m0fqp8kjcujuq0gq78fyg5h90czjms0znqja`
(hex `a495f2bc2284b1ec05821f9d586b6f48027b4b1c9700f403c749114b95f814b7`),
tip page https://nuttip.vercel.app/tip/npub15j2l90pzsjc7cpvzr7w4s6m0fqp8kjcujuq0gq78fyg5h90czjms0znqja.
Its kind:10019 (testnut, sats) is in `scripts/test-identity.json`
(mode 600, gitignored — contains the nsec, NEVER commit or share).
Publish from the VM failed as expected (12s timeout) — publish it from
a real browser (instructions in the file), then tip the test npub end
to end and confirm the ⚡ box appears and kind:9321 publishes.

Still to do (parent agent): upload changed files to GitHub as 0xbcw
(Vercel auto-deploys main), verify live at https://nuttip.vercel.app
only (never the stale Vercel-auth URL), publish the test identity's
kind:10019 from a real browser, tip the test npub end to end in a real
browser.
