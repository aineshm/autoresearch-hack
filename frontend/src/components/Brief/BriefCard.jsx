import { useState } from 'react';
import './BriefCard.css';

// Renders any value (string | array | object) recursively, so the card stays
// robust to the brief's nested shape (intent{}, answer_contract{}, data_facts{}…).
function Val({ v }) {
  if (v == null || v === '') return null;
  if (Array.isArray(v)) {
    return (
      <ul className="bcard-list">
        {v.map((x, i) => <li key={i}><Val v={x} /></li>)}
      </ul>
    );
  }
  if (typeof v === 'object') {
    return (
      <div className="bcard-kv">
        {Object.entries(v).map(([k, val]) => (
          <div className="bcard-kv-row" key={k}>
            <span className="bcard-kv-k">{k.replace(/_/g, ' ')}</span>
            <span className="bcard-kv-v"><Val v={val} /></span>
          </div>
        ))}
      </div>
    );
  }
  return <span>{String(v)}</span>;
}

// Progressive disclosure: enriched question up front, the rest on expand.
const SECTIONS = [
  ['answer_contract', 'What a real answer must contain'],
  ['claims_to_test', 'What you told us (we’ll verify)'],
  ['data_facts', 'What we found in your data'],
  ['assumptions', 'Assumptions we made'],
];

export default function BriefCard({ brief, confirmed, onConfirm }) {
  const [open, setOpen] = useState(false);
  const intent = brief.intent || {};
  const expertise = intent.expertise_level;
  const conf = typeof brief.confidence === 'number' ? Math.round(brief.confidence * 100) : null;

  return (
    <div className="bcard">
      <div className="bcard-tag">Your brief: confirm this is what you mean</div>
      <div className="bcard-q">{brief.enriched_question}</div>
      {intent.what_they_want && <div className="bcard-intent">{intent.what_they_want}</div>}

      <div className="bcard-badges">
        {conf != null && <span className="bcard-badge">confidence {conf}%</span>}
        {expertise && <span className="bcard-badge">{String(expertise).replace(/_/g, ' ')}</span>}
      </div>

      <button type="button" className="bcard-toggle" onClick={() => setOpen((o) => !o)}>
        {open ? '▾ Hide details' : '▸ Show details'}
      </button>

      {open && (
        <div className="bcard-detail">
          {SECTIONS.map(([key, label]) => {
            const v = brief[key];
            if (v == null || (Array.isArray(v) && !v.length)) return null;
            return (
              <div className="bcard-sec" key={key}>
                <div className="bcard-sec-label">{label}</div>
                <div className="bcard-sec-val"><Val v={v} /></div>
              </div>
            );
          })}
        </div>
      )}

      {confirmed ? (
        <div className="bcard-confirmed">✓ Locked. Handing to the planner</div>
      ) : (
        <div className="bcard-actions">
          <button type="button" className="bcard-yes" onClick={onConfirm}>✓ Yes, this is what I mean</button>
          <span className="bcard-refine-hint">…or type a tweak below to refine</span>
        </div>
      )}
    </div>
  );
}
