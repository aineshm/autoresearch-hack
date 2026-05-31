import { useState } from 'react';
import './PlanCard.css';

const asList = (v) => (Array.isArray(v) ? v : v ? [v] : []);

const ZapIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);
const PulseIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
  </svg>
);

export default function PlanCard({ plan, launched, onRun }) {
  const [open, setOpen] = useState(false);
  const cats = asList(plan.variable_categories);
  const sources = asList(plan.research_sources);

  return (
    <div className="plan">
      <div className="plan-tag">The plan: what the research swarm should hunt for</div>
      {plan.summary && <div className="plan-summary">{plan.summary}</div>}

      <div className="plan-sec-label">Variable categories to explore</div>
      <div className="plan-cats">
        {cats.map((c, i) => (
          <div className="plan-cat" key={i}>
            <div className="plan-cat-head">
              <span className={`plan-pri plan-pri--${(c.priority || 'medium').toLowerCase()}`}>{c.priority || 'medium'}</span>
              <span className="plan-cat-name">{c.category}</span>
            </div>
            {c.rationale && <div className="plan-cat-why">{c.rationale}</div>}
            {asList(c.example_kinds).length > 0 && (
              <div className="plan-cat-kinds">{asList(c.example_kinds).join(' · ')}</div>
            )}
          </div>
        ))}
      </div>

      {asList(plan.start_here).length > 0 && (
        <div className="plan-block">
          <div className="plan-sec-label">Start here</div>
          <ul className="plan-list">{asList(plan.start_here).map((s, i) => <li key={i}>{s}</li>)}</ul>
        </div>
      )}

      {plan.what_useful_output_looks_like && (
        <div className="plan-block">
          <div className="plan-sec-label">What a useful result looks like</div>
          <div className="plan-useful">{plan.what_useful_output_looks_like}</div>
        </div>
      )}

      <button type="button" className="plan-toggle" onClick={() => setOpen((o) => !o)}>
        {open ? '▾ Hide research & more' : '▸ Research, dead-ends & sources'}
      </button>
      {open && (
        <div className="plan-detail">
          {asList(plan.likely_dead_ends).length > 0 && (
            <div className="plan-block">
              <div className="plan-sec-label">Likely low-value (deprioritize, not forbidden)</div>
              <ul className="plan-list">{asList(plan.likely_dead_ends).map((s, i) => <li key={i}>{s}</li>)}</ul>
            </div>
          )}
          {asList(plan.open_directions).length > 0 && (
            <div className="plan-block">
              <div className="plan-sec-label">Worth a small exploration budget</div>
              <ul className="plan-list">{asList(plan.open_directions).map((s, i) => <li key={i}>{s}</li>)}</ul>
            </div>
          )}
          {sources.length > 0 && (
            <div className="plan-block">
              <div className="plan-sec-label">Research sources ({sources.length})</div>
              <ul className="plan-sources">
                {sources.map((s, i) => (
                  <li key={i}><a href={s.url} target="_blank" rel="noreferrer">{s.title || s.url}</a></li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {launched ? (
        <div className="plan-launched"><PulseIcon /> Launched. Handed to the autoresearch swarm</div>
      ) : (
        <div className="plan-actions">
          <button type="button" className="plan-run" onClick={onRun}><ZapIcon /> Run autoresearch</button>
          <span className="plan-run-hint">the orchestration agent takes it from here</span>
        </div>
      )}
    </div>
  );
}
