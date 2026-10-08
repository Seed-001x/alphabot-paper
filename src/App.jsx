// ALPHABOT — real-only dashboard. The bot does everything server-side;
// this UI just shows what's happening. Three tabs: Dashboard, Research, Settings.
import { useCallback, useEffect, useState } from 'react';
import { getBackendUrl, fetchRealBook, fmtUsd } from './lib/api.js';
import Dashboard from './components/Dashboard.jsx';
import ResearchCenter from './components/ResearchCenter.jsx';
import SettingsPage from './components/SettingsPage.jsx';

const TABS = [
  { k: 'dash', label: 'Dashboard' },
  { k: 'research', label: 'Research Center' },
  { k: 'settings', label: 'Settings' },
];

export default function App() {
  const [tab, setTab] = useState(() => {
    try { return localStorage.getItem('ab_tab') || 'dash'; } catch { return 'dash'; }
  });
  const [book, setBook] = useState(null);
  const [apiBase, setApiBase] = useState(getBackendUrl);
  const [err, setErr] = useState('');

  const poll = useCallback(async () => {
    const base = getBackendUrl();
    if (!base) { setErr('offline — set a backend URL in Settings'); return; }
    try {
      const b = await fetchRealBook(base);
      setBook(b);
      setErr('');
    } catch (e) {
      setErr('cannot reach backend — retrying');
    }
  }, []);

  useEffect(() => {
    poll();
    const t = setInterval(poll, 10000);
    return () => clearInterval(t);
  }, [poll, apiBase]);

  const switchTab = (k) => {
    setTab(k);
    try { localStorage.setItem('ab_tab', k); } catch {}
  };

  const live = book && book.ok && !err;
  const equity = book && book.equity != null ? fmtUsd(book.equity) : '—';

  return (
    <>
      <header className="topnav">
        <div className="brand"><span className="mark">⌁</span>ALPHABOT</div>
        <nav className="tabs">
          {TABS.map(t => (
            <button key={t.k} className={'tab' + (tab === t.k ? ' on' : '')} onClick={() => switchTab(t.k)}>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="nav-right">
          <div className="status-pill" title={err || 'live'}>
            <span className={'dot' + (live ? '' : ' off')} />
            {live ? equity : 'OFFLINE'}
          </div>
        </div>
      </header>

      <main className="page">
        {err && !book && <div className="loading">{err}</div>}
        {(!err || book) && (
          <>
            {tab === 'dash' && <Dashboard book={book} apiBase={apiBase} onChanged={poll} />}
            {tab === 'research' && <ResearchCenter apiBase={apiBase} />}
            {tab === 'settings' && <SettingsPage book={book} onBackendChange={() => { setApiBase(getBackendUrl()); poll(); }} />}
          </>
        )}
      </main>

      <footer className="foot">
        ALPHABOT · real funds · on-chain fills — not financial advice
      </footer>
    </>
  );
}
