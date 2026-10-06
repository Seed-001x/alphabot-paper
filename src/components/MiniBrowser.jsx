// MiniBrowser — "the agent actually reading" (v2.5).
// A browser-chrome window showing REAL fetched page text (plain text only,
// never HTML) with a theatrical keyword-reading sweep: a robot cursor moves
// keyword to keyword as the agent "reads", with annotation callouts.
// Purely observational: subscribes to the research event bus, changes nothing.
import { useEffect, useMemo, useRef, useState } from 'react';
import { subscribeResearch } from '../lib/research.js';
import { subscribeFloor } from '../lib/floorBus.js';

const SWEEP_MS = 60; // theatrical pacing per keyword

function buildRanges(text, hits) {
  // All match ranges across hits, in document order, overlaps dropped.
  const ranges = [];
  hits.forEach((h, hitIdx) => {
    let re;
    try {
      re = new RegExp(`\\b${h.kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    } catch { return; }
    let m;
    let guard = 0;
    while ((m = re.exec(text)) && guard++ < 500) {
      ranges.push({ start: m.index, end: m.index + m[0].length, hitIdx, kind: h.kind, kw: h.kw, count: h.count });
    }
  });
  ranges.sort((a, b) => a.start - b.start);
  const out = [];
  let lastEnd = -1;
  for (const r of ranges) {
    if (r.start >= lastEnd) { out.push(r); lastEnd = r.end; }
  }
  return out;
}

function shortMint(a) {
  return a && a.length > 8 ? `${a.slice(0, 4)}…${a.slice(-4)}` : (a || '?');
}

export default function MiniBrowser() {
  const [reads, setReads] = useState([]);
  const [activeMint, setActiveMint] = useState(null);
  const [revealed, setRevealed] = useState(0);
  const [cursor, setCursor] = useState(null);
  const [callout, setCallout] = useState(null);
  const [judgments, setJudgments] = useState({});
  const contentRef = useRef(null);
  const spanRefs = useRef({});

  useEffect(() => {
    const unsub = subscribeResearch((evt) => {
      if (evt.type === 'bread-start') {
        const rec = { mint: evt.mint, symbol: evt.symbol, url: evt.url, domain: evt.domain, status: 'loading', ts: Date.now() };
        setReads((prev) => [...prev.filter(r => r.mint !== evt.mint), rec].slice(-6));
        setActiveMint(evt.mint);
        setRevealed(0); setCursor(null); setCallout(null);
      } else if (evt.type === 'bread-done') {
        const rec = { mint: evt.mint, symbol: evt.symbol, url: evt.url, domain: evt.domain, status: 'done', text: evt.text, hits: evt.hits || [], delta: evt.delta, verdict: evt.verdict, ts: Date.now() };
        setReads((prev) => [...prev.filter(r => r.mint !== evt.mint), rec].slice(-6));
        setActiveMint(evt.mint);
        setRevealed(0); setCursor(null); setCallout(null);
      } else if (evt.type === 'bread-fail') {
        const rec = { mint: evt.mint, symbol: evt.symbol, url: evt.url, domain: evt.domain, status: 'failed', reason: evt.reason, ts: Date.now() };
        setReads((prev) => [...prev.filter(r => r.mint !== evt.mint), rec].slice(-6));
        setActiveMint(evt.mint);
        setCursor(null); setCallout(null);
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = subscribeFloor((ev) => {
      if (ev && ev.type === 'judge.done' && ev.mint) {
        setJudgments(prev => ({ ...prev, [ev.mint]: ev }));
      }
    });
    return unsub;
  }, []);

  const active = reads.find(r => r.mint === activeMint) || reads[reads.length - 1] || null;

  const ranges = useMemo(() => {
    if (!active || active.status !== 'done' || !active.text) return [];
    return buildRanges(active.text, active.hits || []);
  }, [active && active.mint, active && active.status]);

  // Theatrical sweep: reveal one keyword per SWEEP_MS.
  useEffect(() => {
    if (!active || active.status !== 'done') return;
    const total = (active.hits || []).length;
    if (revealed >= total) return;
    const id = setTimeout(() => setRevealed(r => r + 1), SWEEP_MS);
    return () => clearTimeout(id);
  }, [active && active.mint, active && active.status, revealed]);

  // Move the robot cursor to the latest revealed keyword.
  useEffect(() => {
    if (!active || revealed === 0) return;
    const el = spanRefs.current['h' + (revealed - 1)];
    const box = contentRef.current;
    if (el && box) {
      const r = el.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      setCursor({ x: r.left - b.left + box.scrollLeft + r.width + 6, y: r.top - b.top + box.scrollTop - 10 });
      try { el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch { /* nicety */ }
      const hit = (active.hits || [])[revealed - 1];
      if (hit) {
        const label = hit.kind === 'trust' ? 'TRUST' : 'RISK';
        setCallout(`${label} · '${hit.kw}'${hit.count > 1 ? ` ×${hit.count}` : ''}`);
        const cid = setTimeout(() => setCallout(null), 1400);
        return () => clearTimeout(cid);
      }
    }
  }, [revealed]);

  const renderText = () => {
    if (!active || !active.text) return null;
    const segs = [];
    let pos = 0;
    let key = 0;
    for (const r of ranges) {
      if (r.start > pos) segs.push(<span key={key++}>{active.text.slice(pos, r.start)}</span>);
      if (r.hitIdx < revealed) {
        const idx = r.hitIdx;
        const isFirst = !ranges.slice(0, ranges.indexOf(r)).some(q => q.hitIdx === idx);
        segs.push(
          <span
            key={key++}
            ref={isFirst ? (el) => { spanRefs.current['h' + idx] = el; } : undefined}
            className={'mb-hl ' + r.kind}
          >{active.text.slice(r.start, r.end)}</span>
        );
      } else {
        segs.push(<span key={key++}>{active.text.slice(r.start, r.end)}</span>);
      }
      pos = r.end;
    }
    if (pos < active.text.length) segs.push(<span key={key++}>{active.text.slice(pos)}</span>);
    return segs;
  };

  const sweepDone = active && active.status === 'done' && revealed >= (active.hits || []).length;
  const judge = active && judgments[active.mint] ? judgments[active.mint] : null;

  return (
    <div className="mb-wrap">
      {/* browser chrome */}
      <div className="mb-chrome">
        <div className="mb-dots"><i className="r" /><i className="y" /><i className="g" /></div>
        <div className="mb-tab">{active ? active.domain : 'new tab'}</div>
        <div className="mb-url" title={active ? active.url : ''}>
          {active ? active.url : '—'}
        </div>
      </div>
      {/* recent reads */}
      {reads.length > 1 && (
        <div className="mb-recent">
          {reads.map(r => (
            <button
              key={r.mint}
              className={'mb-chip' + (r.mint === (active && active.mint) ? ' on' : '')}
              onClick={() => { setActiveMint(r.mint); setRevealed(0); setCursor(null); setCallout(null); }}
            >
              <i className={'dot ' + (r.status === 'done' ? 'grn' : r.status === 'failed' ? 'red' : 'amb')} />
              {r.symbol || shortMint(r.mint)}
            </button>
          ))}
        </div>
      )}
      {/* content */}
      <div className="mb-body" ref={contentRef}>
        {!active && (
          <div className="mb-empty">— no pages read yet · research opens candidate websites here —</div>
        )}
        {active && active.status === 'loading' && (
          <div className="mb-loading">
            <div className="mb-shimmer" /><div className="mb-shimmer" style={{ width: '82%' }} /><div className="mb-shimmer" style={{ width: '64%' }} />
            <div className="mb-status">⟳ fetching via reader proxy…</div>
          </div>
        )}
        {active && active.status === 'failed' && (
          <div className="mb-failed">⚠ page unreadable — no data · modifier +0 <span className="dim">({active.reason || 'fetch failed'})</span></div>
        )}
        {active && active.status === 'done' && (
          <div className="mb-text">{renderText()}</div>
        )}
        {/* robot cursor overlay */}
        {cursor && active && active.status === 'done' && !sweepDone && (
          <div className="mb-cursor" style={{ transform: `translate(${cursor.x}px, ${cursor.y}px)` }}>
            <span className="mb-bot">🤖</span>
            {callout && <span className="mb-callout">{callout}</span>}
          </div>
        )}
      </div>
      {/* status line */}
      <div className="mb-statusbar">
        {active && active.status === 'done' && !sweepDone && (
          <span>◉ reading {active.domain} · {revealed}/{(active.hits || []).length} keywords<span className="mb-blink">▊</span></span>
        )}
        {active && sweepDone && (
          <span>✓ {active.domain} · {active.hits.length} keywords · <b className={active.delta > 0 ? 'grn' : active.delta < 0 ? 'red' : ''}>◈ verdict: {active.verdict}</b></span>
        )}
        {judge && (
          <span style={{ marginLeft: 10 }}>⚖ <b>JUDGE {judge.legitimacy}/10</b>
            {judge.one_liner ? <span className="dim"> · “{judge.one_liner}”</span> : null}
            {judge.risk_flags && judge.risk_flags.length ? <span className="red"> · ⚠ {judge.risk_flags.join(', ')}</span> : null}
          </span>
        )}
        {active && active.status === 'loading' && <span className="dim">connecting…</span>}
        {active && active.status === 'failed' && <span className="dim">skipped · fail-open</span>}
        {!active && <span className="dim">idle</span>}
      </div>
    </div>
  );
}
