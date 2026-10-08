// Equity curve: SVG area chart with gradient, 1D/1W/1M/ALL selector.
import { useMemo, useState } from 'react';
import { fmtUsdSigned } from '../lib/api.js';

const RANGES = [
  { k: '1D', ms: 24 * 3600 * 1000 },
  { k: '1W', ms: 7 * 24 * 3600 * 1000 },
  { k: '1M', ms: 30 * 24 * 3600 * 1000 },
  { k: 'ALL', ms: Infinity },
];

export default function EquityChart({ curve, startUsd }) {
  const [range, setRange] = useState('ALL');

  const pts = useMemo(() => {
    const all = (curve || []).filter(p => p && p.ts != null && p.v != null);
    if (!all.length) return [];
    const r = RANGES.find(x => x.k === range);
    const cutoff = Date.now() - r.ms;
    let f = all.filter(p => p.ts >= cutoff);
    if (f.length < 2) f = all.slice(-2); // always show something
    return f;
  }, [curve, range]);

  const W = 720, H = 220, padL = 8, padR = 8, padT = 14, padB = 22;
  let path = '', area = '', first = null, last = null, lo = null, hi = null;
  if (pts.length >= 2) {
    const vs = pts.map(p => p.v);
    lo = Math.min(...vs); hi = Math.max(...vs);
    const span = hi - lo || 1;
    const t0 = pts[0].ts, t1 = pts[pts.length - 1].ts, tspan = t1 - t0 || 1;
    const X = (ts) => padL + ((ts - t0) / tspan) * (W - padL - padR);
    const Y = (v) => padT + (1 - (v - lo) / span) * (H - padT - padB);
    const coords = pts.map(p => [X(p.ts), Y(p.v)]);
    path = 'M ' + coords.map(c => c[0].toFixed(1) + ' ' + c[1].toFixed(1)).join(' L ');
    area = path + ` L ${coords[coords.length - 1][0].toFixed(1)} ${(H - padB).toFixed(1)} L ${coords[0][0].toFixed(1)} ${(H - padB).toFixed(1)} Z`;
    first = pts[0]; last = pts[pts.length - 1];
  }

  const gid = 'eqgrad';
  const up = last && first ? last.v >= first.v : true;
  const stroke = up ? '#8B7CF6' : '#f43f5e';

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <span className="eq-big">{last ? '$' + last.v.toFixed(2) : '—'}</span>
          {first && last && startUsd != null && (
            <span className="eq-sub" style={{ color: last.v >= startUsd ? '#34d399' : '#f43f5e' }}>
              {fmtUsdSigned(last.v - startUsd)}
            </span>
          )}
        </div>
        <div className="tf-row">
          {RANGES.map(r => (
            <button key={r.k} className={'tf' + (range === r.k ? ' on' : '')} onClick={() => setRange(r.k)}>
              {r.k}
            </button>
          ))}
        </div>
      </div>
      <div className="chart-wrap">
        {pts.length >= 2 ? (
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height: 220 }}>
            <defs>
              <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
                <stop offset="100%" stopColor={stroke} stopOpacity="0.02" />
              </linearGradient>
            </defs>
            {[0.25, 0.5, 0.75].map(f => (
              <line key={f} x1={padL} x2={W - padR} y1={padT + f * (H - padT - padB)} y2={padT + f * (H - padT - padB)}
                stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
            ))}
            <path d={area} fill={`url(#${gid})`} />
            <path d={path} fill="none" stroke={stroke} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            <circle
              cx={(padL + (W - padL - padR)).toFixed(1)} cy={(padT + (1 - (last.v - lo) / (hi - lo || 1)) * (H - padT - padB)).toFixed(1)}
              r="4" fill={stroke} stroke="#0B0E13" strokeWidth="2"
            />
            <text x={padL} y={H - 6} fill="#5d6579" fontSize="10">
              {new Date(first.ts).toLocaleDateString([], { month: 'short', day: 'numeric' })}
            </text>
            <text x={W - padR} y={H - 6} fill="#5d6579" fontSize="10" textAnchor="end">
              {new Date(last.ts).toLocaleDateString([], { month: 'short', day: 'numeric' })}
            </text>
          </svg>
        ) : (
          <div className="empty">no equity history yet</div>
        )}
      </div>
    </div>
  );
}
