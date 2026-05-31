import { useEffect, useState } from 'react';
import Background from '../Background/Background';
import { api, getToken } from '../../api';
import './Dashboard.css';

function initials(user) {
  const name = (user?.name || '').trim();
  if (name) {
    const p = name.split(/\s+/);
    return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase();
  }
  return (user?.email?.[0] || 'U').toUpperCase();
}

const PlaneIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.8 19.2 16 11l3.5-3.5a2.1 2.1 0 0 0-3-3L13 8 4.8 6.2a.5.5 0 0 0-.5.8L9 11l-2 3-2.5.5a.5.5 0 0 0-.3.8L7 18l2 2.5a.5.5 0 0 0 .8-.3L10 18l3-2 3.2 4.5a.5.5 0 0 0 .8-.1Z" />
  </svg>
);
const LayersIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2 2 7l10 5 10-5-10-5Z" /><path d="m2 17 10 5 10-5" /><path d="m2 12 10 5 10-5" />
  </svg>
);

export default function Dashboard({ user, onOpen, onLogout }) {
  const [projects, setProjects] = useState(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    api.projectsList(getToken()).then((d) => setProjects(d.projects)).catch(() => setProjects([]));
  }, []);

  async function create() {
    const n = name.trim();
    if (!n) return;
    setErr('');
    try {
      const { project } = await api.projectCreate(n, getToken());
      setProjects((p) => [...(p || []), project]);
      setName(''); setCreating(false);
      onOpen(project);
    } catch (e) {
      setErr(e.message || 'Could not create project.');
    }
  }

  function status(p) {
    if (p.kind === 'demo') return 'Demo · ALFA UAV flight logs (ready)';
    if (p.hasData) return `Ready · ${p.datasetName || 'data uploaded'}`;
    return 'No data yet · upload a CSV to start';
  }

  return (
    <div className="dash">
      <Background dim />
      <header className="dash-top">
        <div className="dash-brand"><img src="/autolab-logo.svg" className="dash-logo" alt="" /><span>AutoLab</span></div>
        <button className="dash-avatar" onClick={onLogout} title="Log out">{initials(user)}</button>
      </header>

      <main className="dash-main">
        <h1 className="dash-title">Your projects</h1>
        <p className="dash-sub">Each project has its own data and chats. Open one to take a problem from prompt to plan.</p>

        <div className="dash-grid">
          {(projects || []).map((p) => (
            <button className={`proj-card${p.kind === 'demo' ? ' proj-card--demo' : ''}`} key={p.id} onClick={() => onOpen(p)}>
              <span className="proj-icon">{p.kind === 'demo' ? <PlaneIcon /> : <LayersIcon />}</span>
              <span className="proj-name">{p.name}</span>
              <span className={`proj-status${p.hasData ? ' proj-status--ready' : ''}`}>{status(p)}</span>
            </button>
          ))}

          {creating ? (
            <div className="proj-card proj-card--new">
              <input
                autoFocus value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') create(); if (e.key === 'Escape') { setCreating(false); setName(''); } }}
                placeholder="Project name…" className="proj-new-input"
              />
              <div className="proj-new-actions">
                <button onClick={create} className="proj-new-create" disabled={!name.trim()}>Create</button>
                <button onClick={() => { setCreating(false); setName(''); }} className="proj-new-cancel">Cancel</button>
              </div>
              {err && <div className="proj-new-err">{err}</div>}
            </div>
          ) : (
            <button className="proj-card proj-card--add" onClick={() => setCreating(true)}>
              <span className="proj-add-plus">＋</span>
              <span className="proj-name">New project</span>
              <span className="proj-status">Bring your own data</span>
            </button>
          )}
        </div>

        {projects === null && <div className="dash-loading">Loading projects…</div>}
      </main>
    </div>
  );
}
