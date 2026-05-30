import { useEffect, useState } from 'react';
import Landing from './components/Landing/Landing';
import Chat from './components/Chat/Chat';
import AuthModal from './components/AuthModal/AuthModal';
import { api, getToken, setToken } from './api';

export default function App() {
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState(null); // 'login' | 'signup' | null

  // restore session on load
  useEffect(() => {
    const token = getToken();
    if (!token) return;
    api.me(token)
      .then(({ user }) => setUser(user))
      .catch(() => setToken(null));
  }, []);

  function handleAuthed(u) {
    setUser(u);
    setAuthMode(null);
  }
  function logout() {
    setToken(null);
    setUser(null);
  }

  // Logged in → chat interface (landing nav is not rendered here)
  if (user) {
    return <Chat user={user} onLogout={logout} />;
  }

  // Logged out → landing page + auth modal
  return (
    <>
      <Landing
        onLogin={() => setAuthMode('login')}
        onSignup={() => setAuthMode('signup')}
      />
      {authMode && (
        <AuthModal
          mode={authMode}
          onClose={() => setAuthMode(null)}
          onAuthed={handleAuthed}
        />
      )}
    </>
  );
}
