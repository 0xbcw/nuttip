// Test the fixed fetchCreatorProfile() for real npubs (jack, fiatjaf).
// Transpiles src/lib/nostr.ts with the project's TypeScript (no new
// dependencies) and runs it in Node.
//
// NOTE: in this sandbox VM relay websockets are blocked and the nostr.band
// API is unreachable, so this script is expected to exercise the graceful
// degradation path here (bare profile, no hang, no throw) rather than a
// live profile fetch. On a normal network / in the deployed browser the
// relay path (or the HTTP fallback) should return name + picture.
// Re-run after redeploy and check the live site in a browser.
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import ts from 'typescript';
import { nip19 } from 'nostr-tools';

const src = readFileSync(
  new URL('../src/lib/nostr.ts', import.meta.url),
  'utf8',
);
const { outputText } = ts.transpileModule(src, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
  },
});
const tmpPath = new URL('./.tmp-nostr-test.mjs', import.meta.url);
writeFileSync(tmpPath, outputText);
const { fetchCreatorProfile } = await import(tmpPath.href);
unlinkSync(tmpPath);

const cases = [
  ['jack', 'npub1sg6plzptd64u62a878hep2kev88swjh3tw00gjsfl8f237lmu63q0uf63m'],
  ['fiatjaf', 'npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6'],
];

for (const [label, npub] of cases) {
  const t0 = Date.now();
  try {
    const p = await fetchCreatorProfile(npub);
    const ms = Date.now() - t0;
    const hexOk = p.hexpubkey === nip19.decode(npub).data;
    console.log(
      `${label}: ${ms}ms hex-ok=${hexOk} name=${p.displayName ?? p.name ?? '-'} picture=${p.picture ? 'yes' : 'no'} about=${p.about ? p.about.slice(0, 60) : '-'}`,
    );
  } catch (e) {
    console.log(`${label}: THREW after ${Date.now() - t0}ms: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// Invalid input must still throw (TipPage shows the error for a bad npub).
try {
  await fetchCreatorProfile('not-an-npub');
  console.log('invalid input: NO THROW (unexpected)');
} catch (e) {
  console.log(`invalid input: threw as expected (${e instanceof Error ? e.message : String(e)})`);
}
console.log('done — no hang, no unhandled rejection');
process.exit(0);
