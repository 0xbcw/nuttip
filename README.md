# NutTip 🌰

**A no-account Cashu tip jar for Nostr creators — built for Nut November 2026.**

Paste a Nostr creator's npub, type an amount in sats and a short message,
and pay with Cashu ecash. The creator gets a shareable tip link and a QR
code they can claim in any Cashu wallet. No account, no login to tip.

- **Value4Value:** tip creators directly in sats, no middleman. This is
  NutTip's entry for the Nut November Value4Value track, and for the
  first-time contributor prize (this is our first Cashu project).
- **Built:** 8–27 November 2026, for [Nut November](https://nutnovember.org/).
  Submissions close 27 Nov 2026, 23:59 UTC; winners 30 Nov.
- **Stack:** TypeScript, Vite + React, `@cashu/cashu-ts` v4.13,
  `@nostr-dev-kit/ndk` for Nostr profile lookup. No backend — static site.

## ⚠️ Test mint only

NutTip currently uses **testnut** (`https://testnut.cashu.space`),
a test mint with **fake, unbacked ecash**. Do not send real money here.
Cashu is experimental software — funds can be lost to bugs. Any future
real-mint support will be clearly labelled and opt-in, with tiny amounts only.

Your tipper proofs live in **localStorage, on your own device only**.
Clearing browser data loses them. Nothing is sent to a server.

## How it works

1. Open the app, paste a creator's npub (or open `/tip/<npub>` directly).
2. NutTip fetches their Nostr kind-0 profile (name, picture, about) from
   public relays.
3. Type an amount in sats + an optional message, hit "Send tip".
4. NutTip mints test ecash on testnut if your local balance is short,
   splits out the tip amount, and encodes it as a Cashu token
   (`cashuA…`) with a `cashu:` URI and QR code.
5. Share the tip link (`/tip/<npub>?token=…`) — the creator opens it and
   clicks "Claim this tip" to receive the proofs into their own browser
   wallet.

Nut zap (NIP-61) is a stretch goal, time-boxed to 13–14 Nov — the token/QR
path is the core, and it works in any Cashu wallet today.

## Run it

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm build      # type-check + production build
pnpm test:cashu # Cashu loop test against nofee.testnut (fake sats)
```

## Project layout

```
src/
  lib/
    cashu.ts    # wallet load, mint, send, receive, token encode/decode
    nostr.ts    # npub parsing + Nostr profile lookup via NDK
    storage.ts  # localStorage proof storage
  components/
    TipForm.tsx  # amount + message + mint + send, shows token/QR/link
    TipPage.tsx  # public /tip/<npub> page + claim box
    TokenQR.tsx  # QR code for a Cashu token
  app/
    page.tsx     # home page / route handling
  App.tsx main.tsx index.css
scripts/
  test-cashu-loop.mjs  # mint -> send -> receive on nofee.testnut
```

## License

MIT — see [LICENSE](LICENSE).
