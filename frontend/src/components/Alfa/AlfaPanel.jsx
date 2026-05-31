import { useEffect, useRef, useState } from 'react';
import { getToken } from '../../api';
import './AlfaPanel.css';

// Shown when "Run" is clicked on the ALFA demo project.
// Streams the Python research loop live via SSE and builds an experiment table in real time.
export default function AlfaPanel() {
  const [phase, setPhase]       = useState('idle');   // idle | running | best | replay | done | error
  const [logs, setLogs]         = useState([]);
  const [experiments, setExps]  = useState([]);
  const [decision, setDecision] = useState(null);
  const [insight, setInsight]   = useState(null);
  const [alarmMs, setAlarmMs]   = useState(null);
  const logRef  = useRef(null);
  const abortRef = useRef(null);

  // Auto-scroll logs
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [logs]);

  // Kill stream on unmount
  useEffect(() => () => abortRef.current?.abort(), []);

  function addLog(line) {
    setLogs((l) => [...l, line]);
  }

  async function start() {
    if (phase === 'running') return;
    setPhase('running');
    setLogs([]);
    setExps([]);
    setDecision(null);
    setInsight(null);
    setAlarmMs(null);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch('/api/alfa/run/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ max_rounds: 3, max_experiments: 12 }),
        signal: ctrl.signal,
      });

      if (!res.ok) { setPhase('error'); return; }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });

        let sep;
        while ((sep = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, sep);
          buf = buf.slice(sep + 2);

          let event = 'message', data = '';
          for (const ln of block.split('\n')) {
            if (ln.startsWith('event: ')) event = ln.slice(7).trim();
            if (ln.startsWith('data: '))  data  = ln.slice(6);
          }

          try {
            const d = JSON.parse(data);
            if (event === 'log')        addLog(d.line);
            if (event === 'experiment') setExps((e) => [...e, d]);
            if (event === 'decision')   setDecision(d.decision);
            if (event === 'insight')    setInsight(d.text);
            if (event === 'phase')      setPhase(d.name);
            if (event === 'alarm')      { setPhase('replay'); addLog(d.line); }
            if (event === 'latency')    setAlarmMs(d.ms);
            if (event === 'done')       setPhase((p) => p === 'replay' ? 'done' : 'done');
            if (event === 'error')      { addLog('[error] ' + d.message); setPhase('error'); }
          } catch {}
        }
      }
      setPhase((p) => p === 'idle' ? 'done' : p === 'running' ? 'done' : p);
    } catch (e) {
      if (e.name !== 'AbortError') setPhase('error');
    }
  }

  const passing = experiments.filter((e) => e.gate === 'PASS');
  const best    = passing.sort((a, b) => b.f1 - a.f1)[0] || null;
  const rounds  = experiments.length ? Math.max(...experiments.map((e) => e.round)) : 0;

  return (
    <div className="alfa">
      {phase === 'idle' && (
        <div className="alfa-launch">
          <div className="alfa-launch-plane">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17.8 19.2 16 11l3.5-3.5a2.1 2.1 0 0 0-3-3L13 8 4.8 6.2a.5.5 0 0 0-.5.8L9 11l-2 3-2.5.5a.5.5 0 0 0-.3.8L7 18l2 2.5a.5.5 0 0 0 .8-.3L10 18l3-2 3.2 4.5a.5.5 0 0 0 .8-.1Z" />
            </svg>
          </div>
          <div className="alfa-launch-title">ALFA UAV Research Loop</div>
          <div className="alfa-launch-sub">
            Fans out 12 experiments in parallel on Modal.<br />
            No human tuning — the agent finds the best fault detector.
          </div>
          <button className="alfa-launch-btn" onClick={start}>
            Run autoresearch on ALFA data
          </button>
          <div className="alfa-launch-stats">
            47 real flights &middot; engine failure + control-surface faults &middot; event-level F1
          </div>
        </div>
      )}

      {phase !== 'idle' && (
        <>
          <div className="alfa-statusbar">
            <div className="alfa-statusbar-left">
              {phase === 'running' || phase === 'best' ? (
                <><span className="alfa-pulse" /><span>Researching…</span></>
              ) : phase === 'replay' ? (
                <><span className="alfa-alarm-dot" /><span>Fault detected in replay</span></>
              ) : phase === 'done' ? (
                <><span className="alfa-done-dot" /><span>Research complete</span></>
              ) : (
                <><span className="alfa-err-dot" /><span>Error — see log</span></>
              )}
              {decision && (
                <span className={`alfa-badge alfa-badge--${decision.toLowerCase()}`}>{decision}</span>
              )}
              {rounds > 0 && <span className="alfa-rounds">round {rounds}</span>}
            </div>
            <span className="alfa-exp-count">{experiments.length} experiments</span>
          </div>

          {experiments.length > 0 && (
            <div className="alfa-table-wrap">
              <table className="alfa-table">
                <thead>
                  <tr>
                    <th>ID</th><th>Rnd</th><th>F1</th><th>FAR/hr</th>
                    <th>Lat ms</th><th>Gate</th><th>Win</th><th>Features</th>
                  </tr>
                </thead>
                <tbody>
                  {[...experiments].reverse().map((e, i) => (
                    <tr
                      key={i}
                      className={
                        e === best          ? 'alfa-row--best' :
                        e.gate === 'PASS'   ? 'alfa-row--pass' : 'alfa-row--fail'
                      }
                    >
                      <td className="alfa-mono">{e.id}</td>
                      <td>{e.round}</td>
                      <td className="alfa-f1">{e.f1.toFixed(3)}</td>
                      <td>{e.far.toFixed(2)}</td>
                      <td>{e.latency}</td>
                      <td>
                        <span className={`alfa-gate alfa-gate--${e.gate.toLowerCase()}`}>
                          {e.gate}
                        </span>
                      </td>
                      <td>{e.window}</td>
                      <td className="alfa-mono alfa-feat">{e.features}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {best && (phase === 'done' || phase === 'replay') && (
            <div className="alfa-best">
              <div className="alfa-best-label">Best detector — no human tuning</div>
              <div className="alfa-best-metrics">
                <span className="alfa-metric">
                  <span className="alfa-metric-k">F1</span>
                  <span className="alfa-metric-v">{best.f1.toFixed(3)}</span>
                </span>
                <span className="alfa-metric">
                  <span className="alfa-metric-k">FAR</span>
                  <span className="alfa-metric-v">{best.far.toFixed(2)}/hr</span>
                </span>
                <span className="alfa-metric">
                  <span className="alfa-metric-k">Window</span>
                  <span className="alfa-metric-v">{best.window}s</span>
                </span>
                {alarmMs != null && (
                  <span className="alfa-metric alfa-metric--alarm">
                    <span className="alfa-metric-k">Detection</span>
                    <span className="alfa-metric-v">{alarmMs}ms</span>
                  </span>
                )}
              </div>
              {insight && <div className="alfa-insight">{insight}</div>}
            </div>
          )}

          <details className="alfa-log-details" open={phase === 'running'}>
            <summary className="alfa-log-summary">
              Live log ({logs.length} lines)
            </summary>
            <div className="alfa-log" ref={logRef}>
              {logs.map((l, i) => (
                <div
                  key={i}
                  className={`alfa-log-line${
                    l.includes('FAULT DETECTED') ? ' alfa-log-line--alarm' :
                    l.includes('BEST CONFIG')    ? ' alfa-log-line--best'  : ''
                  }`}
                >
                  {l}
                </div>
              ))}
            </div>
          </details>
        </>
      )}
    </div>
  );
}
