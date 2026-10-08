// RESEARCH seat terminal — crawlnet-style live view.
// ~/alphabot ❯ research --live — streaming activity log + live counters.
// Purely observational: subscribes to the research event bus, changes nothing.
import { useEffect, useRef, useState } from 'react';
import { subscribeResearch, getResearchStats } from '../lib/research.js';
import MiniBrowser from './MiniBrowser.jsx';

export default function ResearchTerminal() {
  const [lines, setLines] = useState([]);
  const [stats, setStats] = useState(getResearchStats());
  const [tab, setTab] = useState('log');
  const logRef = useRef(null);

  useEffect(() => {
    const unsub = subscribeResearch((evt) => {
      if (evt.type === 'line') {
        setLines((prev) => [...prev.slice(-90), evt]);
      } else if (evt.type === 'stats') {
        setStats({ ...evt.stats });
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div className="panel rterm">
      <h2 className="panel-title">
        <span className="rt-prompt">~/alphabot</span> <span className="rt-chev">❯</span> research --live
        <span className="rt-blink">▊</span>
        <span className="rt-tabs">
          <button className={tab === 'log' ? 'on' : ''} onClick={() => setTab('log')}>LOG</button>
          <button className={tab === 'browser' ? 'on' : ''} onClick={() => setTab('browser')}>BROWSER</button>
        </span>
      </h2>
      {tab === 'log' && (<>
      <div className="rt-counters">
        <span>dossiers <b>{stats.dossiers}</b></span>
        <span>checks <b>{stats.checks}</b></span>
        <span>links <b>{stats.links}</b></span>
        <span>creators flagged <b className={stats.creatorsFlagged ? 'v red' : ''}>{stats.creatorsFlagged}</b></span>
      </div>
      <div className="rt-log" ref={logRef}>
        {lines.length === 0 && (
          <div className="rl-line dim">— crawlers idle · research runs on kill-chain survivors —</div>
        )}
        {lines.map((l, i) => (
          <div key={i} className={'rl-line ' + (l.tone || '')}>{l.text}</div>
        ))}
      </div>
      </>)}
      {tab === 'browser' && <MiniBrowser />}
    </div>
  );
}
