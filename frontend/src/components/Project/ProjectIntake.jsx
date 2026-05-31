import { useState } from 'react';
import Background from '../Background/Background';
import Upload from './Upload';
import './ProjectIntake.css';

// First screen for a project without data: a drop-files intake. After a CSV is uploaded we show
// what was detected, then continue into the chat. Users can also start without data.
export default function ProjectIntake({ project, onReady, onSkip, onBack }) {
  const [uploaded, setUploaded] = useState(null);
  const facts = uploaded?.dataFacts;

  return (
    <div className="intake">
      <Background dim />
      <header className="intake-top">
        <button className="intake-back" onClick={onBack}>← Projects</button>
        <span className="intake-name">{project.name}</span>
        <span className="intake-top-spacer" />
      </header>

      <main className="intake-main">
        {!uploaded ? (
          <>
            <h1 className="intake-title">Set up {project.name}</h1>
            <p className="intake-sub">
              Drop your dataset here to get started. We inspect it (columns, types, likely target) so the
              brief and plan are grounded in your real data.
            </p>
            <Upload projectId={project.id} onUploaded={(p) => setUploaded(p)} />
            <button className="intake-skip" onClick={onSkip}>or start without data →</button>
          </>
        ) : (
          <>
            <div className="intake-done-tag"><span className="intake-done-dot" /> {uploaded.datasetName}</div>
            <h1 className="intake-title">Here’s what we found</h1>
            <div className="intake-facts">
              <div className="intake-facts-top">{facts.n_rows} rows × {facts.n_columns} columns</div>
              <div className="intake-cols">
                {facts.columns.slice(0, 12).map((c) => (
                  <span className="intake-col" key={c.name}><b>{c.name}</b><i>{c.dtype}</i></span>
                ))}
                {facts.columns.length > 12 && <span className="intake-col intake-col--more">+{facts.columns.length - 12} more</span>}
              </div>
              {facts.target_candidates?.length > 0 && (
                <div className="intake-hint">Likely target: {facts.target_candidates.join(', ')}</div>
              )}
              {facts.group_candidates?.length > 0 && (
                <div className="intake-hint">Entity / id columns (split by these): {facts.group_candidates.join(', ')}</div>
              )}
            </div>
            <button className="intake-continue" onClick={() => onReady(uploaded)}>Open chat →</button>
          </>
        )}
      </main>
    </div>
  );
}
