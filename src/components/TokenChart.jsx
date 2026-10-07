import { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, LineStyle, CandlestickSeries } from 'lightweight-charts';

const fmtUsd = (n) => {
  if (n == null || isNaN(n)) return '—';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + n.toFixed(2);
};

/**
 * TokenChart — price chart with entry/exit markers.
 * Props: mint, symbol, entryMc, entryTs, exitMc (optional), exitTs (optional), onClose
 */
const TIMEFRAMES = [
  { id: '1m', label: '1m', tf: 'minute', agg: 1 },
  { id: '5m', label: '5m', tf: 'minute', agg: 5 },
  { id: '15m', label: '15m', tf: 'minute', agg: 15 },
  { id: '30m', label: '30m', tf: 'minute', agg: 30 },
  { id: '1h', label: '1H', tf: 'hour', agg: 1 },
  { id: '4h', label: '4H', tf: 'hour', agg: 4 },
  { id: '1d', label: '1D', tf: 'day', agg: 1 },
];

export default function TokenChart({ mint, symbol, entryMc, entryTs, exitMc, exitTs, onClose }) {
  const chartRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [timeframe, setTimeframe] = useState('1m');
  const [copied, setCopied] = useState(false);

  const copyCA = async () => {
    try {
      await navigator.clipboard.writeText(mint);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  };

  useEffect(() => {
    if (!chartRef.current || !mint) return;
    let chart = null;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        // GeckoTerminal OHLC — free, no key. Pool address = pair address on Solana.
        // Try to find the pool via DexScreener first (gives us the pair address).
        const dsRes = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${mint}`);
        const dsData = await dsRes.json();
        const pairAddr = dsData?.[0]?.pairAddress;
        if (!pairAddr) throw new Error('pair not found');

        const tfCfg = TIMEFRAMES.find(t => t.id === timeframe) || TIMEFRAMES[0];
        const url = `https://api.geckoterminal.com/api/v2/networks/solana/pools/${pairAddr}/ohlcv/${tfCfg.tf}?aggregate=${tfCfg.agg}&limit=1000`;
        const res = await fetch(url);
        const data = await res.json();
        const ohlcv = data?.data?.attributes?.ohlcv_list || [];
        if (!ohlcv.length) throw new Error('no chart data');

        if (cancelled) return;

        // Convert to lightweight-charts format: [timestamp, open, high, low, close, volume]
        const candles = ohlcv.map(c => ({
          time: c[0],
          open: c[1], high: c[2], low: c[3], close: c[4],
        })).sort((a, b) => a.time - b.time);

        chart = createChart(chartRef.current, {
          layout: {
            background: { type: ColorType.Solid, color: '#0B0E13' },
            textColor: '#8B8FA3',
            fontSize: 11,
          },
          grid: {
            vertLines: { color: 'rgba(139,143,163,0.08)' },
            horzLines: { color: 'rgba(139,143,163,0.08)' },
          },
          width: chartRef.current.clientWidth,
          height: 360,
          timeScale: { timeVisible: true, secondsVisible: false },
        });

        const series = chart.addSeries(CandlestickSeries, {
          upColor: '#2DD4BF',
          downColor: '#F6465D',
          wickUpColor: '#2DD4BF',
          wickDownColor: '#F6465D',
          borderVisible: false,
        });
        series.setData(candles);

        // Entry marker — green line at entry MC converted to price
        // We work in price space; entryMc → entry price via ratio
        const firstClose = candles[0]?.close;
        const lastClose = candles[candles.length - 1]?.close;
        if (entryMc && firstClose && lastClose) {
          // Estimate entry price: we know entryMc, and current mc/price ratio
          // Use the candle closest to entryTs
          const entryTime = Math.floor(entryTs / 1000);
          let entryCandle = candles[0];
          for (const c of candles) {
            if (c.time <= entryTime) entryCandle = c;
            else break;
          }
          series.createPriceLine({
            price: entryCandle.close,
            color: '#2DD4BF',
            lineWidth: 2,
            lineStyle: LineStyle.Solid,
            axisLabelVisible: true,
            title: `ENTRY ${fmtUsd(entryMc)} MC`,
          });
        }

        // Exit marker — red line
        if (exitMc && exitTs) {
          const exitTime = Math.floor(exitTs / 1000);
          let exitCandle = candles[candles.length - 1];
          for (const c of candles) {
            if (c.time <= exitTime) exitCandle = c;
            else break;
          }
          series.createPriceLine({
            price: exitCandle.close,
            color: '#F6465D',
            lineWidth: 2,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: `EXIT ${fmtUsd(exitMc)} MC`,
          });
        }

        chart.timeScale().fitContent();
        setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError(e.message || 'failed to load chart');
          setLoading(false);
        }
      }
    }

    load();
    const handleResize = () => {
      if (chart && chartRef.current) {
        chart.applyOptions({ width: chartRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);
    return () => {
      cancelled = true;
      window.removeEventListener('resize', handleResize);
      if (chart) chart.remove();
    };
  }, [mint, timeframe]);

  const mult = exitMc && entryMc ? exitMc / entryMc : null;

  return (
    <div className="chart-modal-overlay" onClick={onClose}>
      <div className="chart-modal" onClick={e => e.stopPropagation()}>
        <div className="chart-header">
          <div>
            <span className="chart-symbol">{symbol || 'TOKEN'}</span>
            {mult && (
              <span className={'chart-mult ' + (mult >= 1 ? 'up' : 'dn')}>
                {mult.toFixed(2)}x
              </span>
            )}
          </div>
          <button className="chart-close" onClick={onClose}>✕</button>
        </div>
        <div className="chart-ca-row" onClick={copyCA} title="tap to copy">
          <span className="chart-ca">{mint ? `${mint.slice(0, 6)}…${mint.slice(-6)}` : '—'}</span>
          <span className="chart-copy">{copied ? '✓ copied' : '⧉ copy'}</span>
        </div>
        <div className="chart-toolbar">
          <div className="chart-tf">
            {TIMEFRAMES.map(tf => (
              <button
                key={tf.id}
                className={timeframe === tf.id ? 'active' : ''}
                onClick={() => setTimeframe(tf.id)}
              >
                {tf.label}
              </button>
            ))}
          </div>
        </div>
        <div className="chart-stats">
          <span>entry <b>{fmtUsd(entryMc)}</b></span>
          {exitMc && <span>exit <b>{fmtUsd(exitMc)}</b></span>}
          {entryTs && <span>held <b>{exitTs ? Math.round((exitTs - entryTs) / 60000) + 'm' : 'open'}</b></span>}
        </div>
        <div ref={chartRef} className="chart-container" />
        {loading && <div className="chart-loading">loading chart…</div>}
        {error && <div className="chart-error">{error}</div>}
        <div className="chart-legend">
          <span><i className="dot entry" /> entry</span>
          {exitMc && <span><i className="dot exit" /> exit</span>}
        </div>
      </div>
    </div>
  );
}
