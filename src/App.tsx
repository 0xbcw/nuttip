import Page from './app/page';

export default function App() {
  return (
    <main className="app">
      <header>
        <h1>🌰 NutTip</h1>
        <p className="tagline">
          A no-account Cashu tip jar for Nostr creators — built for Nut
          November 2026.
        </p>
      </header>
      <Page />
      <footer>
        <p>
          Value4Value: tip creators directly in sats, no middleman. Test mint
          only (testnut, fake sats).{' '}
          <a href="https://nutnovember.org/">Nut November</a> ·{' '}
          <a href="https://cashu.space/">Cashu</a>
        </p>
      </footer>
    </main>
  );
}
