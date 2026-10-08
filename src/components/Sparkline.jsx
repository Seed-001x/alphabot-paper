// Mini SVG sparkline. Takes an array of numbers, renders a smooth line.
export default function Sparkline({ data, width = 90, height = 32, positive }) {
  if (!data || data.length < 2) return <div style={{ width, height }} />;
  const w = width, h = height, pad = 3;
  const min = Math.min(...data), max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => [
    pad + (i / (data.length - 1)) * (w - pad * 2),
    pad + (1 - (v - min) / span) * (h - pad * 2),
  ]);
  // smooth path via simple midpoint quadratic
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    const mx = (x0 + x1) / 2;
    d += ` Q ${x0.toFixed(1)} ${y0.toFixed(1)} ${mx.toFixed(1)} ${((y0 + y1) / 2).toFixed(1)}`;
    d += ` Q ${mx.toFixed(1)} ${((y0 + y1) / 2).toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  }
  const up = positive != null ? positive : data[data.length - 1] >= data[0];
  const color = up ? '#34d399' : '#f43f5e';
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <path d={d} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" opacity="0.9" />
    </svg>
  );
}
