import { useState } from 'react';
import './ResearchPanel.css';

function domain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

// Perplexity-style live trace: shows each research angle, its search status, and the
// sources found, while the planner runs. Collapses to a summary once done.
export default function ResearchPanel({ research }) {
  const { stage, angles = [], done } = research || {};
  const [open, setOpen] = useState(true);
  const totalSources = angles.reduce((n, a) => n + (a.sources?.length || 0), 0);

  return (
    <div className={`research${done ? ' research--done' : ''}`}>
      <button type="button" className="research-head" onClick={() => setOpen((o) => !o)}>
        <span className={`research-dot${done ? ' research-dot--done' : ''}`} />
        <span className="research-head-text">
          {done ? `Researched ${angles.length} angles · ${totalSources} sources` : (stage || 'Researching…')}
        </span>
        <span className="research-caret">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="research-body">
          {angles.length === 0 && <div className="research-stage">{stage || 'Planning research'}…</div>}
          {angles.map((a, i) => (
            <div className="research-row" key={i}>
              <span className={`research-status research-status--${a.status || 'pending'}`}>
                {a.status === 'done' ? '✓' : a.status === 'searching' ? <span className="mini-spin" /> : '·'}
              </span>
              <div className="research-row-main">
                <div className="research-angle">{a.angle}</div>
                <div className="research-query">{a.query}</div>
                {a.sources?.length > 0 && (
                  <div className="research-chips">
                    {a.sources.slice(0, 5).map((s, j) => (
                      <a className="research-chip" key={j} href={s.url} target="_blank" rel="noreferrer" title={s.title || s.url}>
                        {domain(s.url)}
                      </a>
                    ))}
                    {a.sources.length > 5 && <span className="research-chip research-chip--more">+{a.sources.length - 5}</span>}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
