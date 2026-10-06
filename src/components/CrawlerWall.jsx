// CrawlerWall — crawlnet-style grid of live worker windows (v2.7).
// Every window renders REAL pipeline data via floorBus/research subscriptions.
// An idle window shows "awaiting task" — content is never faked, only the
// reveal pacing is theatrical. Subscribe-only: the pipeline is untouched.
import { useEffect, useRef, useState } from 'react';
import { subscribeFloor } from '../lib/floorBus.js';
import { subscribeResearch } from '../lib/research.js';
import MiniBrowser from './MiniBrowser.jsx';

const ACTIVE_MS = 25000;

function useWallFeed() {
  const [dossier, setDossier] = useState(null);
  const [tape, setTape] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [flows, setFlows] = useState([]);
  const [lastSeen, setLastSeen] = useState({});
  const [, bump] = useState(0);

  useEffect(() => {
    const touch = (k) => setLastSeen(p => ({ ...p, [k]: Date.now() }));
    const unsub = subscribeFloor((ev) => {
      const now = Date.now();
      if (ev.type === 'dossier.ready') {
        setDossier({ ...ev, ts: now, revealed: 0 });
        touch('dossier');
      } else if (ev.type === 'vet.scored') {
        setTape(prev => [...prev, {
          id: now + ev.mint, symbol: ev.symbol || '???',
          buys: ev.buys24h, sells: ev.sells24h, vol: ev.vol24h, ts: now,
        }].slice(-8));
        touch('tape');
      } else if (ev.type === 'ledger.check') {
        setLedger(prev => [...prev, {
          id: now + ev.mint, symbol: ev.symbol || '???',
          tag: ev.tag, launches: ev.launches, verdict: ev.verdict, ts: now,
        }].slice(-8));
        touch('scribe');
      } else if (ev.type === 'scan.token' && ev.flow) {
        setFlows(prev => [...prev, { id: now + ev.mint, symbol: ev.symbol || '???', ts: now }].slice(-6));
        touch('flow');
      }
    });
    const unsub2 = subscribeResearch((ev) => {
      if (ev.type === 'bread-start' || ev.type === 'bread-done' || ev.type === 'bread-fail') touch('reader');
    });
    // re-render clock so status dots decay honestly
    const t = setInterval(() => bump(b => b + 1), 5000);
    return () => { unsub(); unsub2(); clearInterval(t); };
  }, []);

  return { dossier, tape, ledger, flows, lastSeen };
}

function Window({ name, agent, k, lastSeen, children, wide }) {
  const active = lastSeen[k] && Date.now() - lastSeen[k] < ACTIVE_MS;
  return (
    <div className={'cw-win' + (wide ? ' wide' : '')}>
      <div className="cw-head">
        <span className={'cw-dot' + (active ? ' on' : '')} />
        <span className="cw-name">{name}</span>
        <span className="cw-agent">{agent}</span>
      </div>
      <div className="cw-body">{children}</div>
    </div>
  );
}

const fmtPct1 = (v) => (v == null ? '?' : v.toFixed(1) + '%');
const fmtK = (v) => {
  if (v == null) return '?';
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return String(v);
};

function DossierBody({ d }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(0);
    const id = setInterval(() => setN(v => (v >= 6 ? v : v + 1)), 320);
    return () => clearInterval(id);
  }, [d && d.ts]);
  if (!d) return <div className="cw-idle">— awaiting task —</div>;
  const rows = [
    { k: 'DEV HOLD', v: fmtPct1(d.devPct), bad: d.devPct != null && d.devPct > 25 },
    { k: 'TOP HOLDER', v: fmtPct1(d.topPct), bad: d.topPct != null && d.topPct > 35 },
    { k: 'TOP-10', v: fmtPct1(d.top10Pct), bad: d.top10Pct != null && d.top10Pct > 70 },
    { k: 'HOLDERS', v: d.holderCount != null ? fmtK(d.holderCount) : '?', bad: false },
    { k: 'RUGGED', v: d.rugged ? 'YES' : 'no', bad: !!d.rugged },
    { k: 'FLAGS', v: (d.risks && d.risks.length ? d.risks.join(', ') : 'none'), bad: d.risks && d.risks.length > 0 },
  ];
  return (
    <div>
      <div className="cw-sub">{d.symbol || '???'} · holder dossier</div>
      {rows.slice(0, n).map((r, i) => (
        <div key={i} className={'cw-row' + (r.bad ? ' bad' : '')}>
          <span>{r.k}</span><b>{r.v}</b>
          {r.bad && <span className="cw-flag">⚠</span>}
        </div>
      ))}
    </div>
  );
}

function TapeBody({ tape }) {
  if (!tape.length) return <div className="cw-idle">— awaiting task —</div>;
  return (
    <div>
      {[...tape].reverse().map(t => (
        <div key={t.id} className="cw-row">
          <span className="cw-sym">{t.symbol}</span>
          <span>buys <b className="grn">{t.buys != null ? fmtK(t.buys) : '?'}</b></span>
          <span>sells <b className="red">{t.sells != null ? fmtK(t.sells) : '?'}</b></span>
          <span className="dim">vol {t.vol != null ? '$' + fmtK(t.vol) : '?'}</span>
        </div>
      ))}
    </div>
  );
}

function LedgerBody({ ledger }) {
  if (!ledger.length) return <div className="cw-idle">— awaiting task —</div>;
  return (
    <div>
      {[...ledger].reverse().map(l => (
        <div key={l.id} className={'cw-row' + (l.verdict === 'serial' ? ' bad' : '')}>
          <span>{l.tag}</span>
          <span className="dim">{l.launches} launch{l.launches === 1 ? '' : 'es'}</span>
          <b className={l.verdict === 'serial' ? 'red' : l.verdict === 'clean' ? 'grn' : 'dim'}>
            {l.verdict === 'serial' ? 'SERIAL −4' : l.verdict === 'clean' ? 'clean +2' : 'first seen'}
          </b>
        </div>
      ))}
    </div>
  );
}

function FlowBody({ flows }) {
  if (!flows.length) return <div className="cw-idle">— awaiting task —</div>;
  return (
    <div>
      {[...flows].reverse().map(f => (
        <div key={f.id} className="cw-row">
          <span className="gold">◈ smart flow</span>
          <span>→</span>
          <b>{f.symbol}</b>
          <span className="dim">entered DD</span>
        </div>
      ))}
    </div>
  );
}

export default function CrawlerWall() {
  const [collapsed, setCollapsed] = useState(false);
  const { dossier, tape, ledger, flows, lastSeen } = useWallFeed();
  return (
    <div className="panel">
      <h2 className="panel-title" onClick={() => setCollapsed(c => !c)} style={{ cursor: 'pointer' }}>
        ◈ Crawler wall · live workers <span className="dim">{collapsed ? '[+]' : '[–]'}</span>
      </h2>
      {!collapsed && (
        <div className="cw-grid">
          <Window name="READER" agent="PAGES" k="reader" lastSeen={lastSeen} wide>
            <MiniBrowser />
          </Window>
          <Window name="DOSSIER" agent="VAULT" k="dossier" lastSeen={lastSeen}>
            <DossierBody d={dossier} />
          </Window>
          <Window name="TAPE" agent="TICKER" k="tape" lastSeen={lastSeen}>
            <TapeBody tape={tape} />
          </Window>
          <Window name="LEDGER" agent="SCRIBE" k="scribe" lastSeen={lastSeen}>
            <LedgerBody ledger={ledger} />
          </Window>
          <Window name="FLOW" agent="CURRENT" k="flow" lastSeen={lastSeen}>
            <FlowBody flows={flows} />
          </Window>
        </div>
      )}
    </div>
  );
}
