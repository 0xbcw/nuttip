# Nut zap (NIP-61) one-tap tip — feasibility + build plan for NutTip
Prepared 10 Nov 2026 · Status: **BUILT 12 Nov 2026, locally verified —
NOT yet deployed, NOT yet verified in a real browser.** Token tip stays
as the fallback throughout. Target: before the 17 Nov 2026 builder
show-and-tell (23:00 WIB). Test sats only; no real funds, no mainnet
change without Eoet's explicit approval; no public post without a draft
shown first.
Update 11 Nov 2026: jack (the demo creator) has NO kind:10019 — verified
by direct relay query (see gap 2). Nut zap cannot demo on jack; it can
only activate for creators who publish kind:10019.
Update 12 Nov 2026: Eoet tapped "Build the nut zap now". Built in
~/workspace/nuttip.
`pnpm build` PASS; Cashu loop + nut zap P2PK flow verified on testnut
(see TEST_REPORT.md). Kind:10019 fetch + kind:9321 publish still need
a real browser. Throwaway test identity prepared, kind:10019 NOT yet
published (needs a real browser).

## What a nut zap is (NIP-61, read 10 Nov 2026)
- A Nut Zap is a P2PK-locked Cashu token where the payment itself is
  the receipt. Spec: https://raw.githubusercontent.com/StellarStoic/nips/master/61.md
- Sender flow: (1) fetch the recipient's kind:10019 event to see which
  mints they trust; (2) mint/swap a token at one of those mints,
  P2PK-locked to the pubkey in kind:10019 (prefix the pubkey with "02");
  (3) publish a kind:9321 event to the recipient's relays, p-tagging them.
- Recipient flow: their client fetches kind:9321 events p-tagging them,
  swaps the token into their wallet, and publishes a kind:7376 claim
  event e-tagging the nut zap.
- Rule: never send to a mint the recipient has NOT listed in kind:10019
  — they may never see the event and the tokens are effectively donated
  to the mint.

## What checks out for NutTip (verified 10 Nov 2026)
- cashu-ts 4.13 (already in NutTip) supports P2PK sends:
  `wallet.ops.send(amount, proofs).asP2PK(p2pk).run()` and
  `new P2PKBuilder().addLockPubkey('02…')` — see the library's
  docs-src/wallet_ops/p2pk_builder.md and usage/create_p2pk.md.
- testnut supports NUT-11 (P2PK): live `/v1/info` check 10 Nov 2026
  returned `"11":{"supported":true}` (also NUT-14). Mint: testnut.cashu.space.
- NutTip already fetches kind:0 profiles via NDK with an HTTP fallback;
  the same NDK pool can fetch kind:10019 and publish kind:9321 — but
  publishing needs a signing key (see gap 1).

## Gaps / risks (honest)
1. **No signing key.** NutTip is deliberately no-account: it has no Nostr
   keypair today, and its nostr module is read-only ("no keys, no signing,
   no publishing"). Publishing kind:9321 requires signing. Design choice
   needed: generate an ephemeral keypair in the browser per tip (sender
   anonymous, key discarded — simplest, fits "no account") vs. ask the
   tipper to paste an nsec (more identity, more friction, key-handling risk).
   Recommended: ephemeral keypair.
2. **Most creators have no kind:10019.** Whether jack
   (npub1sg6plzptd64u62a878hep2kev88swjh3tw00gjsfl8f237lmu63q0uf63m,
   hex 82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2,
   the demo creator) has one is UNVERIFIED — the nostr.band profile page
   failed to load on 10 Nov 2026 and Snort's profile page shows no
   nutzap info. Re-checked 10 Nov 2026 evening: nostr.band timed out
   repeatedly in a live browser (12:15–12:36 UTC, ERR_CONNECTION_TIMED_OUT,
   home page too — no content seen, so absence is NOT proven); njump.me
   returned only jack's kind:0 profile (lud16 jack@primal.net, no
   kind:10019); Snort again showed no nutzap info; Primal profile page
   had no extractable content; web search found no jack-specific
   kind:10019 record, only the NIP-61 spec. If kind:10019 is absent, the
   nut zap MUST fall back to the current token tip (show token + QR +
   link as today) — never mint to an unlisted mint.
   - **RESOLVED 11 Nov 2026 (~00:20 UTC): jack has NO kind:10019.**
     A direct NDK relay query from the NutTip codebase (relays:
     relay.damus.io, nos.lol, relay.nostr.band, relay.primal.net —
     the same four NutTip itself uses) connected and returned no
     kind:10019 event for jack's hex pubkey. nostr.band's profile page
     timed out again the same morning (live browser, ERR_CONNECTION_TIMED_OUT,
     initial load + reload), but the relay query is the stronger check:
     for NutTip's purposes jack publishes no trusted mints and no
     nutzap pubkey. Consequence: a nut zap can never be sent to jack
     through NutTip — the tip page must fall back to the token tip for
     him. A nut zap demo at the 17 Nov show-and-tell needs a different
     creator who does publish kind:10019, or the feature ships as
     "activates only where the creator opted in" with jack demoed via
     the token tip as filmed.
   - **Replacement-creator search attempted 11 Nov ~09:15 WIB — NOT verified.**
     Relay discovery (recent kind:10019 events, plus jack/fiatjaf
     controls) hung in this VM: relays connect but queries never
     return EOSE in 45s; web search names no specific nutzap-enabled
     creator, only the NIP-61 spec. No replacement demo creator is
     verified. Untested option: a throwaway test identity Eoet/Muse
     controls, publishing its own kind:10019 listing testnut, so the
     nut zap can be demoed and claimed end-to-end on test sats —
     needs a real browser to publish, not verifiable from this VM.
   - **RESOLVED 12 Nov 2026 (prepared, NOT published):** throwaway test
     identity generated by `node scripts/test-nutzap-identity.mjs` —
     npub `npub15j2l90pzsjc7cpvzr7w4s6m0fqp8kjcujuq0gq78fyg5h90czjms0znqja`,
     hex `a495f2bc2284b1ec05821f9d586b6f48027b4b1c9700f403c749114b95f814b7`,
     tip page https://nuttip.vercel.app/tip/npub15j2l90pzsjc7cpvzr7w4s6m0fqp8kjcujuq0gq78fyg5h90czjms0znqja.
     Its kind:10019 (testnut, sats, relays = NutTip's four) is written
     in `scripts/test-identity.json` (mode 600, gitignored — contains
     the nsec, NEVER commit or share). Publish from the VM failed as
     expected (relay websockets blocked, 12s timeout) — publish it
     from a real browser (instructions in the file) before demoing the
     one-tap flow end to end.
3. **Relay websockets are blocked in the VM**, so the build can only be
   verified end-to-end in a real browser (Eoet's or a headed browser),
   not in this VM. The existing HTTP fallback cannot publish events.
4. **Receiving side is out of scope for the tip page.** NutTip can send
   the kind:9321; actually claiming it needs the creator's own wallet
   client to watch kind:9321. The show-and-tell demo should therefore
   show the send + the published event, and claim via the existing
   token-tip claim box as the visible proof.
5. **P2PK lock + refund:** add a refund pubkey + lockUntil (the sender's
   ephemeral key, e.g. 7 days) so an unclaimed nut zap can be reclaimed —
   P2PKBuilder supports `.addRefundPubkey()` + `.lockUntil()`. Without
   this, an unclaimed zap is stuck.

## Build plan (smallest safe slice)
1. `fetchNutzapInfo(npub)`: NDK fetch kind:10019 → trusted mints +
   P2PK pubkey (+ relays). Returns null when absent → token-tip fallback.
2. `sendNutzap()`: mint/swap on a listed mint (testnut only), P2PK-lock
   to the recipient pubkey with refund to an ephemeral sender key,
   publish kind:9321 (ephemeral signer), show "Nut zap sent ⚡" + the
   event id. On ANY failure, fall back to the token tip — never fail the tip.
3. Test in a real browser: tip jack (or a test npub with a known
   kind:10019) on testnut, verify the kind:9321 event is visible on a
   relay explorer, then claim via the existing claim box.
4. Deploy via the normal path (GitHub → Vercel), verify live at
   https://nuttip.vercel.app only (never the stale Vercel-auth URL).

## Decision for Eoet
- Go with the ephemeral-key design above, token tip as fallback? Or
  hold the nut zap until after the 17 Nov show-and-tell and demo the
  token tip as-is? The token tip already works and is filmed in the
  demo video; the nut zap is polish, not a blocker.

## Build 12 Nov 2026 (Eoet: "Build the nut zap now") — DONE locally
Commit: the "Add one-tap Cashu tip (nut zap, NIP-61)" commit (see `git log`). Files changed/added:
- `src/lib/nutzap.ts` (new): `fetchNutzapInfo`, `parseNutzapInfoEvent`,
  `pickNutzapMint`, `createEphemeralSigner`, `buildNutzapLock`,
  `buildNutzapEvent`, `publishNutzapEvent`, `sendNutzap`,
  `save/list/removePendingNutzap` (+ `NutzapError` with a `locked` flag).
- `src/components/TipForm.tsx`: one-tap nut zap box + "⚡ Nut zap sent"
  result + locked-but-unpublished retry UI, next to the untouched
  token-tip flow. Pre-lock failure falls back to the token tip
  automatically; post-lock failure NEVER re-sends (retry publish or
  share the locked token instead).
- `src/components/TipPage.tsx`: fetches kind:10019 alongside the
  profile; null = token tip only, lookup failure is never an error.
- `src/lib/cashu.ts`: `splitForSendLocked()` (P2PK-locked split).
- `src/lib/nostr.ts`: `getNdk()` exported (shared read-only pool).
- `src/index.css`: `.nutzap-box` style.
- `scripts/test-nutzap.mjs` (new): full VM verification — see
  TEST_REPORT.md. `scripts/test-nutzap-identity.mjs` (new): throwaway
  test identity + kind:10019 publish attempt.
- `.gitignore`: `scripts/test-identity.json` (contains a private key)
  and the test bundle are never committed.

Verified 12 Nov 2026 (testnut, fake sats): `pnpm build` PASS;
Cashu mint→send→receive loop re-run PASS; P2PK-locked send PASS
(10 sats received with the lock key, wrong key rejected); kind:10019
parse/pick checks PASS; kind:9321 event tags PASS. Relay-dependent
steps (kind:10019 fetch, kind:9321 publish) did NOT verify from this
VM — websockets blocked; they need a real browser on the live site.

Still to do (parent agent): upload to GitHub as 0xbcw (Vercel
auto-deploys main), verify live at https://nuttip.vercel.app only,
publish the test identity's kind:10019 from a real browser, then tip
the test npub end to end in a real browser and confirm the ⚡ box
appears and the kind:9321 publishes. Jack's page must still show only
the token tip.
