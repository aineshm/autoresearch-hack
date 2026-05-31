import { useRef, useState } from 'react';
import { api, getToken } from '../../api';
import './Upload.css';

// Upload a CSV to a project: reads the file as text and posts it; the backend profiles it
// into data_facts and returns the updated project.
export default function Upload({ projectId, onUploaded }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [drag, setDrag] = useState(false);
  const inputRef = useRef(null);

  async function handleFile(file) {
    if (!file) return;
    setError('');
    if (!/\.csv$/i.test(file.name) && file.type && !file.type.includes('csv') && !file.type.includes('text')) {
      setError('Please upload a .csv file.');
      return;
    }
    setBusy(true);
    try {
      const text = await file.text();
      const { project } = await api.projectUpload(projectId, file.name, text, getToken());
      onUploaded?.(project);
    } catch (e) {
      setError(e.message || 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`upload${drag ? ' upload--drag' : ''}${busy ? ' upload--busy' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files?.[0]); }}
      onClick={() => !busy && inputRef.current?.click()}
      role="button"
      tabIndex={0}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        hidden
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      <div className="upload-icon">
        {busy
          ? <span className="upload-spin" />
          : (
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <path d="M17 8l-5-5-5 5" /><path d="M12 3v12" />
            </svg>
          )}
      </div>
      <div className="upload-title">{busy ? 'Profiling your data…' : 'Upload your dataset (CSV)'}</div>
      <div className="upload-sub">
        {busy ? 'Reading columns, types, and likely targets' : 'Drag a CSV here or click to choose. We inspect it so the brief is grounded in your real data.'}
      </div>
      {error && <div className="upload-error">{error}</div>}
    </div>
  );
}
