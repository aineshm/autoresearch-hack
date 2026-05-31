import { useEffect, useRef, useState } from 'react';
import './SwarmMonitor.css';

const POLL_INTERVAL = 2000;

// ── helpers ──────────────────────────────────────────────────────────────────

function toArr(v) {
  return Array.isArray(v) ? v : [];
}

function fmtValue(value, status) {
  if (status === 'crash' || value === null || value === undefined) return '—';
  if (typeof value !== 'number') return String(value);
  // Metrics in [0,1] (F1, accuracy) read best at 3 decimals; larger values keep more.
  return Math.abs(value) < 10 ? value.toFixed(3) : value.toFixed(2);
}

function fmtBest(value) {
  if (value === null || value === undefined || typeof value !== 'number') return null;
  return Math.abs(value) < 10 ? value.toFixed(3) : value.toFixed(2);
}

function shortCommit(hash) {
  return hash ? String(hash).slice(0, 7) : '';
}

/**
 * Compute the best-so-far per generation (for the sparkline).
 * Returns an array of numbers (nulls excluded → the line starts when data appears).
 */
function computeBestSoFar(experiments, lowerIsBetter) {
  const points = [];
  let running = null;
  for (const e of experiments) {
    if (e.value !== null && e.value !== undefined) {
      if (running === null) {
        running = e.value;
      } else {
        running = lowerIsBetter ? Math.min(running, e.value) : Math.max(running, e.value);
      }
    }
    points.push(running);
  }
  return points;
}

// ── Sparkline SVG ─────────────────────────────────────────────────────────────

function Sparkline({ experiments, lowerIsBetter }) {
  const pts = computeBestSoFar(experiments, lowerIsBetter).filter((v) => v !== null);
  if (pts.length < 2) return null;

  const W = 300;
  const H = 36;
  const pad = 3;
  const minV = Math.min(...pts);
  const maxV = Math.max(...pts);
  const range = maxV - minV || 1;

  const xs = pts.map((_, i) => pad + (i / (pts.length - 1)) * (W - pad * 2));
  const ys = pts.map((v) => H - pad - ((v - minV) / range) * (H - pad * 2));

  const linePath = xs.map((x, i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${ys[i].toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L ${xs[xs.length - 1].toFixed(1)} ${H} L ${xs[0].toFixed(1)} ${H} Z`;

  return (
    <div className="sm-sparkline">
      <div className="sm-sparkline-label">Best so far</div>
      <svg className="sm-sparkline-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="sm-spark-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#34d399" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path className="sm-sparkline-area" d={areaPath} />
        <path className="sm-sparkline-line" d={linePath} />
      </svg>
    </div>
  );
}

// ── Card A: Run header ────────────────────────────────────────────────────────

function RunHeaderCard({ data }) {
  const { runId, metric, lowerIsBetter, best, generations, counts, experiments, status } = data;
  const bestLabel = fmtBest(best);
  const done = status === 'done';

  return (
    <div className="sm-card">
      <div className="sm-header">
        <div className={`sm-orb${done ? ' sm-orb--done' : ''}`} aria-hidden="true">
          <span className="sm-orb-ring" />
          <span className="sm-orb-dot" />
        </div>
        <div className="sm-header-body">
          <div className="sm-title">{runId}</div>
          <div className="sm-subtitle">
            {done ? 'Research complete · ' : 'Optimising '}{metric}{lowerIsBetter ? ' ↓' : ' ↑'}
          </div>
          <div className="sm-stats">
            <span className="sm-pill sm-pill--gen">{generations} {generations === 1 ? 'experiment' : 'experiments'}</span>
            {bestLabel !== null
              ? <span className="sm-pill sm-pill--best">best {bestLabel}</span>
              : <span className="sm-pill sm-pill--best-none">no result yet</span>
            }
            {(counts.keep || 0) > 0 && <span className="sm-pill sm-pill--keep">✓ {counts.keep} kept</span>}
            {(counts.discard || 0) > 0 && <span className="sm-pill sm-pill--discard">~ {counts.discard} discarded</span>}
            {(counts.crash || 0) > 0 && <span className="sm-pill sm-pill--crash">✕ {counts.crash} crashed</span>}
          </div>
        </div>
      </div>
      {toArr(experiments).length >= 2 && (
        <Sparkline experiments={experiments} lowerIsBetter={!!lowerIsBetter} />
      )}
    </div>
  );
}

// ── Card B: Research Judge ────────────────────────────────────────────────────

function verdictClass(verdict) {
  const known = ['PIVOT', 'CONTINUE', 'COMMIT', 'ESCALATE', 'RETRY'];
  return known.includes(verdict) ? `sm-verdict--${verdict}` : 'sm-verdict--unknown';
}

function ResearchJudgeCard({ directive }) {
  if (!directive) return null;
  const checks = toArr(directive.checks);
  const hypotheses = toArr(directive.nextHypotheses);

  return (
    <div className="sm-card">
      <div className="sm-judge-head">
        <span className="sm-judge-title">Research Judge</span>
        <span className="sm-badge">Introspection</span>
        {directive.verdict && (
          <span className={`sm-verdict ${verdictClass(directive.verdict)}`}>{directive.verdict}</span>
        )}
      </div>

      {directive.rationale && (
        <div className="sm-rationale">{directive.rationale}</div>
      )}

      {checks.length > 0 && (
        <div className="sm-checks">
          {checks.map((c, i) => (
            <div className="sm-check" key={i}>
              <span className={`sm-check-icon ${c.ok ? 'sm-check-icon--ok' : 'sm-check-icon--fail'}`} aria-hidden="true">
                {c.ok ? '✓' : '!'}
              </span>
              <span>
                <span className="sm-check-name">{c.name}</span>
                {c.evidence && <span className="sm-check-evidence">{c.evidence}</span>}
              </span>
            </div>
          ))}
        </div>
      )}

      {hypotheses.length > 0 && (
        <>
          <div className="sm-section-label">Next hypotheses</div>
          <div className="sm-hypotheses">
            {hypotheses.map((h, i) => (
              <div className="sm-hypothesis" key={i}>{h}</div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Card C: Experiment ledger ─────────────────────────────────────────────────

function ExperimentLedger({ experiments, metric }) {
  const rows = [...toArr(experiments)].reverse(); // newest first
  return (
    <div className="sm-card">
      <div className="sm-ledger-head">
        <span className="sm-ledger-title">Experiments</span>
        {rows.length > 0 && (
          <span className="sm-ledger-count">{rows.length} total · {metric}</span>
        )}
      </div>
      {rows.length === 0 ? (
        <div style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.35)' }}>
          Waiting for the swarm to run its first experiment…
        </div>
      ) : (
        <div className="sm-rows">
          {rows.map((e, i) => (
            <div className="sm-row" key={i} style={{ animationDelay: `${(i * 0.03).toFixed(2)}s` }}>
              <span className="sm-row-gen">#{e.generation}</span>
              <span className="sm-row-desc" title={e.description}>{e.description || '(no description)'}</span>
              {shortCommit(e.commit) && (
                <span className="sm-row-commit">{shortCommit(e.commit)}</span>
              )}
              <span className={`sm-row-value sm-row-value--${e.status}`}>
                {fmtValue(e.value, e.status)}
              </span>
              <span className={`sm-row-status sm-row-status--${e.status}`}>{e.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Card: Completion summary (shown when the run is done) ─────────────────────

function CompletionCard({ summary, metric }) {
  if (!summary) return null;
  const best = summary.best || {};
  const cfg = best.config || {};
  const learned = toArr(summary.learned);
  const replay = summary.replay || null;

  return (
    <div className="sm-card sm-complete">
      <div className="sm-complete-head">
        <span className="sm-complete-check" aria-hidden="true">✓</span>
        <span className="sm-complete-title">Research complete</span>
        {summary.verdict && (
          <span className={`sm-verdict ${verdictClass(summary.verdict)}`}>{summary.verdict}</span>
        )}
      </div>

      {summary.headline && <div className="sm-complete-headline">{summary.headline}</div>}

      <div className="sm-complete-metrics">
        {best[metric] !== undefined && (
          <div className="sm-metric-box">
            <div className="sm-metric-label">{metric}</div>
            <div className="sm-metric-val">{fmtBest(best[metric])}</div>
            {summary.baseline?.[metric] !== undefined && (
              <div className="sm-metric-delta">from {fmtBest(summary.baseline[metric])} baseline</div>
            )}
          </div>
        )}
        {best.false_alarm_rate_per_hr !== undefined && (
          <div className="sm-metric-box">
            <div className="sm-metric-label">false alarms</div>
            <div className="sm-metric-val">{best.false_alarm_rate_per_hr.toFixed(2)}<span className="sm-metric-unit">/hr</span></div>
          </div>
        )}
        {best.detection_latency_ms !== undefined && (
          <div className="sm-metric-box">
            <div className="sm-metric-label">latency</div>
            <div className="sm-metric-val">{best.detection_latency_ms}<span className="sm-metric-unit">ms</span></div>
          </div>
        )}
        {summary.experiments_run !== undefined && (
          <div className="sm-metric-box">
            <div className="sm-metric-label">experiments</div>
            <div className="sm-metric-val">{summary.experiments_run}</div>
            {summary.passed_gate !== undefined && (
              <div className="sm-metric-delta">{summary.passed_gate} passed the gate</div>
            )}
          </div>
        )}
      </div>

      {Object.keys(cfg).length > 0 && (
        <>
          <div className="sm-section-label">Winning configuration</div>
          <div className="sm-config">
            {Object.entries(cfg).map(([k, v]) => (
              <span className="sm-config-item" key={k}>
                <span className="sm-config-key">{k}</span>
                <span className="sm-config-val">{String(v)}</span>
              </span>
            ))}
          </div>
        </>
      )}

      {learned.length > 0 && (
        <>
          <div className="sm-section-label">What the research agent learned</div>
          <ul className="sm-learned">
            {learned.map((l, i) => <li key={i}>{l}</li>)}
          </ul>
        </>
      )}

      {summary.honest_limit && (
        <div className="sm-limit">
          <span className="sm-limit-tag">Honest limit</span> {summary.honest_limit}
        </div>
      )}

      {replay && (
        <div className="sm-replay">
          <div className="sm-section-label">Held-out flight replay</div>
          <div className="sm-replay-headline">
            Caught <strong>{replay.fault_type?.replace(/_/g, ' ')}</strong> in{' '}
            <strong>{replay.latency_ms}ms</strong> after onset
          </div>
          <div className="sm-replay-detail">
            {replay.flight} · onset {replay.fault_onset_s}s → detected {replay.detected_at_s}s
            {replay.anomaly_score !== undefined && ` · score ${replay.anomaly_score} > ${replay.threshold}`}
          </div>
          {replay.note && <div className="sm-replay-note">{replay.note}</div>}
        </div>
      )}
    </div>
  );
}

// ── Root component ────────────────────────────────────────────────────────────

export default function SwarmMonitor({ runId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const doneRef = useRef(false);

  useEffect(() => {
    if (!runId) return;

    let cancelled = false;
    doneRef.current = false;

    async function fetchStatus() {
      try {
        const res = await fetch(`/api/monitor/${encodeURIComponent(runId)}/status`);
        const json = await res.json().catch(() => ({}));
        if (!cancelled) {
          if (!res.ok) {
            setError(json.error || 'Failed to fetch status.');
          } else {
            if (json.status === 'done') doneRef.current = true;
            setData(json);
            setError(null);
          }
        }
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Network error.');
      }
    }

    fetchStatus();
    const interval = setInterval(() => {
      // Stop polling once the run is done — the report is final.
      if (doneRef.current) {
        clearInterval(interval);
        return;
      }
      fetchStatus();
    }, POLL_INTERVAL);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [runId]);

  if (error) {
    return (
      <div className="sm-pending">
        <span className="sm-pending-orb" />
        Error: {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="sm-pending">
        <span className="sm-pending-orb" />
        Connecting to the swarm…
      </div>
    );
  }

  const hasExperiments = toArr(data.experiments).length > 0;

  if (!hasExperiments && !data.latestDirective) {
    return (
      <div className="sm-pending">
        <span className="sm-pending-orb" />
        Waiting for the swarm to start…
      </div>
    );
  }

  const done = data.status === 'done';

  return (
    <div className="sm-root">
      <RunHeaderCard data={data} />
      {done && data.summary
        ? <CompletionCard summary={data.summary} metric={data.metric} />
        : <ResearchJudgeCard directive={data.latestDirective || null} />}
      <ExperimentLedger experiments={data.experiments} metric={data.metric} />
    </div>
  );
}
