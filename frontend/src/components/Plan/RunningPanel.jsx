import { useEffect, useState } from 'react';
import './RunningPanel.css';

// Shown when the user clicks "Run autoresearch": a launch moment + a looping animation
// that keeps iterating to convey the swarm working. (The live orchestration engine is the
// next teammate's tier; this is the visual hand-off.)
const STATUS = [
  'Spinning up the swarm',
  'Dispatching candidate experiments',
  'Training on held-out flights',
  'Scoring against the answer contract',
  'Pruning weak variables',
  'Synthesizing what mattered',
];

export default function RunningPanel() {
  const [round, setRound] = useState(1);
  const [si, setSi] = useState(0);

  useEffect(() => {
    const t = setInterval(() => {
      setSi((s) => {
        const next = (s + 1) % STATUS.length;
        if (next === 0) setRound((r) => r + 1);
        return next;
      });
    }, 2200);
    return () => clearInterval(t);
  }, []);

  const cells = Array.from({ length: 28 });

  return (
    <div className="running">
      <div className="running-head">
        <span className="running-core">
          <span className="running-core-ring" />
          <span className="running-core-dot" />
        </span>
        <div className="running-head-text">
          <div className="running-title">Autoresearch running</div>
          <div className="running-sub">
            <span className="running-round">Round {round}</span>
            <span className="running-status">{STATUS[si]}<span className="running-dots" /></span>
          </div>
        </div>
      </div>

      <div className="running-grid">
        {cells.map((_, i) => (
          <span
            className="running-cell"
            key={i}
            style={{ animationDelay: `${((i % 7) * 0.11 + Math.floor(i / 7) * 0.06).toFixed(2)}s` }}
          />
        ))}
      </div>

      <div className="running-foot">
        the orchestration swarm iterates here; live engine wiring is the next tier
      </div>
    </div>
  );
}
