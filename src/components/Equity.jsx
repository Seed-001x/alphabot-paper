// Neon SVG equity curve.
import { useMemo } from 'react';

export default function Equity({ points, bankroll0 }) {
  const geo = useMemo(() => {
    const W = 600, H = 150, PAD = 8;
    const pts = (points || []).slice(-120);
    if (pts.length < 2) return null;
    const vals = pts.map(p => p.v);
    let mn = Math.min(...vals, bankroll0), mx = Math.max(...vals, bankroll0);
    if (mx - mn < 1) { mx += 0.5; mn -= 0.5; }
    const X = i => PAD + (i / (pts.length - 1)) * (W - PAD * 2);
    const Y = v => H - PAD - ((v - mn) / (mx - mn)) * (H - PAD * 2);
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ');
    const a = `${d} L${X(pts.length - 1).toFixed(1)},${H - PAD} L${PAD},${H - PAD} Z`;
    return { w: W, h: H, path: d, area: a, baseY: Y(bankroll0), last: pts[pts.length - 1].v };
  }, [points, bankroll0]);

  if (!geo) return <div className="empty">equity curve builds as the desk trades</div>;

  const up = geo.last >= bankroll0;
  const stroke = up ? '#3dff8f' : '#ff2e63';
  return (
    <svg className="eq-svg" viewBox={`0 0 ${geo.w} ${geo.h}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="eqfill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
        <filter id="eqglow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2.5" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <line x1="0" y1={geo.baseY} x2={geo.w} y2={geo.baseY} stroke="#ff2bd6" strokeWidth="1" strokeDasharray="5 4" opacity="0.5" vectorEffect="non-scaling-stroke" />
      <path d={geo.area} fill="url(#eqfill)" />
      <path d={geo.path} fill="none" stroke={stroke} strokeWidth="2" filter="url(#eqglow)" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
