import { useEffect, useState } from 'react';
import { api, setToken } from '../../api';
import './AuthModal.css';

export default function AuthModal({ mode, onClose, onAuthed }) {
  const [tab, setTab] = useState(mode === 'signup' ? 'signup' : 'login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // close on Escape
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isSignup = tab === 'signup';

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const payload = isSignup ? { name, email, password } : { email, password };
      const data = isSignup ? await api.signup(payload) : await api.login(payload);
      setToken(data.token);
      onAuthed(data.user);
    } catch (err) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        className="modal glass"
        role="dialog"
        aria-modal="true"
        aria-label={isSignup ? 'Sign up' : 'Log in'}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>

        <div className="modal-head">
          <img src="/autolab-logo.svg" alt="" className="modal-logo" />
          <h2 className="modal-title">{isSignup ? 'Create your account' : 'Welcome back'}</h2>
          <p className="modal-sub">
            {isSignup ? 'Start building with AutoLab.' : 'Log in to continue.'}
          </p>
        </div>

        <div className="modal-tabs">
          <button
            className={!isSignup ? 'tab active' : 'tab'}
            onClick={() => { setTab('login'); setError(''); }}
            type="button"
          >
            Log in
          </button>
          <button
            className={isSignup ? 'tab active' : 'tab'}
            onClick={() => { setTab('signup'); setError(''); }}
            type="button"
          >
            Sign up
          </button>
        </div>

        <form className="modal-form" onSubmit={handleSubmit}>
          {isSignup && (
            <label className="field">
              <span>Name</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ada Lovelace"
                autoComplete="name"
              />
            </label>
          )}
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@autolab.io"
              autoComplete="email"
              required
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isSignup ? 'At least 6 characters' : '••••••••'}
              autoComplete={isSignup ? 'new-password' : 'current-password'}
              required
            />
          </label>

          {error && <p className="form-error">{error}</p>}

          <button className="submit-btn" type="submit" disabled={loading}>
            {loading ? 'Please wait…' : isSignup ? 'Create account' : 'Log in'}
          </button>
        </form>
      </div>
    </div>
  );
}
