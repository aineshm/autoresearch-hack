import { useEffect, useRef, useState } from 'react';
import { RUN } from './runData';
import './AutoresearchRun.css';

const fmt = (n, d = 3) => (n == null ? '—' : Number(n).toFixed(d));

// Anomaly-score replay chart (SVG, no deps). Draws score(t) up to `idx`, with the
// false-alarm threshold and the fault-onset marker; turns red once detected.
function ReplayChart({ series, idx, threshold, onset, detected }) {
  const W = 620, H = 170, pad = 6;
  const tMax = series[series.length - 1][0];
  const sMax = 0.72;
  const x = (t) => pad + (t / tMax) * (W - 2 * pad);
  const y = (s) => H - pad - (Math.min(s, sMax) / sMax) * (H - 2 * pad);
  const pts = series.slice(0, idx + 1);
  const line = pts.map((p) => `${x(p[0]).toFixed(1)},${y(p[4]).toFixed(1)}`).join(' ');
  const area = pts.length ? `${x(pts[0][0]).toFixed(1)},${H - pad} ${line} ${x(pts[pts.length - 1][0]).toFixed(1)},${H - pad}` : '';
  const cur = pts[pts.length - 1];
  const thY = y(threshold);
  const isDet = detected;

  return (
    <svg className="ar-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <line className="ar-chart-thresh" x1={pad} y1={thY} x2={W - pad} y2={thY} />
      <text className="ar-chart-thresh-label" x={W - pad} y={thY - 5} textAnchor="end">alarm threshold {threshold}</text>
      <line className="ar-chart-onset" x1={x(onset)} y1={pad} x2={x(onset)} y2={H - pad} />
      <text className="ar-chart-onset-label" x={x(onset) + 4} y={pad + 12}>fault onset {onset}s</text>
      {area && <polygon className={`ar-chart-area${isDet ? ' ar-chart-area--det' : ''}`} points={area} />}
      {line && <polyline className={`ar-chart-line${isDet ? ' ar-chart-line--det' : ''}`} points={line} />}
      {cur && <circle className={`ar-chart-head${isDet ? ' ar-chart-head--det' : ''}`} cx={x(cur[0])} cy={y(cur[4])} r="4" />}
    </svg>
  );
}

export default function AutoresearchRun() {
  const [revealed, setRevealed] = useState(0);     // rounds shown
  const [showReport, setShowReport] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [idx, setIdx] = useState(0);               // replay playhead
  const endRef = useRef(null);

  // Reveal rounds one by one, then the report.
  useEffect(() => {
    let n = 0; const timers = [];
    const tick = () => {
      n += 1; setRevealed(n);
      if (n < RUN.rounds.length) timers.push(setTimeout(tick, 2400));
      else timers.push(setTimeout(() => setShowReport(true), 1600));
    };
    timers.push(setTimeout(tick, 600));
    return () => timers.forEach(clearTimeout);
  }, []);

  // After the report, start the flight replay.
  useEffect(() => {
    if (!showReport) return;
    const t = setTimeout(() => setPlaying(true), 2000);
    return () => clearTimeout(t);
  }, [showReport]);

  // Advance the replay playhead.
  useEffect(() => {
    if (!playing) return;
    let i = 0; setIdx(0);
    const iv = setInterval(() => {
      i += 1; setIdx(i);
      if (i >= RUN.replay.series.length - 1) clearInterval(iv);
    }, 120);
    return () => clearInterval(iv);
  }, [playing]);

  // keep the growing edge in view
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [revealed, showReport, idx]);

  const rounds = RUN.rounds.slice(0, revealed);
  const ranExps = rounds.flatMap((r) => r.experiments);
  const passed = ranExps.filter((e) => e.gate === 'PASS').length;
  const bestF1 = ranExps.reduce((m, e) => Math.max(m, e.f1), 0);
  const done = revealed >= RUN.rounds.length;

  const detIdx = RUN.replay.series.findIndex((p) => p[0] >= RUN.replay.detected.time);
  const detected = playing && idx >= detIdx;
  const cur = RUN.replay.series[Math.min(idx, RUN.replay.series.length - 1)];

  return (
    <div className="ar">
      {/* header / live counters */}
      <div className="ar-head">
        <span className="ar-core" />
        <div className="ar-head-text">
          <div className="ar-title">Autoresearch swarm {done ? 'complete' : 'running'}</div>
          <div className="ar-sub">on {RUN.dataset.flights} real ALFA flights · {RUN.spec.gate}</div>
        </div>
        <div className="ar-stats">
          <div className="ar-stat"><b>{ranExps.length}</b><span>/ {RUN.spec.budget} experiments</span></div>
          <div className="ar-stat"><b>{passed}</b><span>passed gate</span></div>
          <div className="ar-stat ar-stat--best"><b>{fmt(bestF1, 3)}</b><span>best F1</span></div>
        </div>
      </div>

      {/* rounds */}
      <div className="ar-rounds">
        {rounds.map((r) => {
          const rb = r.experiments.reduce((m, e) => Math.max(m, e.f1), 0);
          return (
            <div className="ar-round" key={r.n}>
              <div className="ar-round-head">
                <span className="ar-round-n">Round {r.n}</span>
                <span className={`ar-decision ar-decision--${r.decision.toLowerCase()}`}>{r.decision}</span>
                <span className="ar-round-best">best {fmt(rb, 3)}</span>
              </div>
              <div className="ar-insight">{r.insight}</div>
              <div className="ar-exps">
                {r.experiments.map((e, i) => (
                  <div className={`ar-exp${e.best ? ' ar-exp--best' : ''}${e.gate === 'FAIL' ? ' ar-exp--fail' : ''}`} key={e.id} style={{ animationDelay: `${i * 70}ms` }}>
                    <span className="ar-exp-id">{e.id}</span>
                    <span className="ar-exp-bar"><span className="ar-exp-bar-fill" style={{ width: `${e.f1 * 100}%` }} /></span>
                    <span className="ar-exp-f1">{fmt(e.f1, 3)}</span>
                    <span className={`ar-exp-gate ar-exp-gate--${e.gate.toLowerCase()}`}>{e.gate === 'PASS' ? `${e.lat}ms` : `FAR ${e.far}`}</span>
                    <span className="ar-exp-cfg">w{e.window} · {e.feat.replace('residuals', 'res')}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* final report */}
      {showReport && (
        <div className="ar-report">
          <div className="ar-report-tag">Research complete</div>
          <div className="ar-jump">
            <div className="ar-jump-from"><span>baseline</span><b>{fmt(RUN.final.baseline.f1, 3)}</b><i>never fired</i></div>
            <div className="ar-jump-arrow">→</div>
            <div className="ar-jump-to"><span>best found</span><b>{fmt(RUN.final.best.f1, 3)}</b><i>F1</i></div>
            <div className="ar-jump-meta">{RUN.final.best.latency}ms latency · {RUN.final.best.far}/hr false alarms · {RUN.final.passed}/{RUN.final.experiments} passed</div>
          </div>
          <div className="ar-best-cfg">
            {Object.entries({ window_length: RUN.final.best.window_length, feature_set: RUN.final.best.feature_set, model_type: RUN.final.best.model_type, normalization: RUN.final.best.normalization, threshold_method: RUN.final.best.threshold_method }).map(([k, v]) => (
              <span className="ar-cfg-pill" key={k}><i>{k.replace(/_/g, ' ')}</i> {v}</span>
            ))}
          </div>
          <div className="ar-learned">
            <div className="ar-sec-label">What the agent learned</div>
            <ul>{RUN.final.learned.map((l, i) => <li key={i}>{l}</li>)}</ul>
          </div>
          <div className="ar-limits">
            <div className="ar-sec-label">Honest limits</div>
            <ul>{RUN.final.limits.map((l, i) => <li key={i}>{l}</li>)}</ul>
          </div>
        </div>
      )}

      {/* ground-truth flight replay */}
      {playing && (
        <div className={`ar-replay${detected ? ' ar-replay--det' : ''}`}>
          <div className="ar-sec-label">Ground-truth replay · held-out flight</div>
          <div className="ar-replay-flight">{RUN.replay.flight} <span>· {RUN.replay.faultType} · onset {RUN.replay.onset}s</span></div>
          <ReplayChart series={RUN.replay.series} idx={idx} threshold={RUN.replay.threshold} onset={RUN.replay.onset} detected={detected} />
          <div className="ar-telemetry">
            <span>t <b>{fmt(cur[0], 1)}s</b></span>
            <span>speed <b>{fmt(cur[1], 1)}</b> m/s</span>
            <span>throttle <b>{fmt(cur[2], 2)}</b></span>
            <span>Δalt <b>{fmt(cur[3], 1)}</b> m</span>
            <span>score <b>{fmt(cur[4], 3)}</b></span>
          </div>
          {detected && (
            <div className="ar-detected">
              <div className="ar-detected-row"><span className="ar-detected-flash" /> FAULT DETECTED</div>
              <div className="ar-detected-meta">caught {RUN.replay.detected.latency}ms after onset · score {RUN.replay.detected.score} &gt; {RUN.replay.threshold} · throttle dropped to 0</div>
              <div className="ar-detected-note">No human tuned this detector. The research agent found this configuration.</div>
            </div>
          )}
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}
