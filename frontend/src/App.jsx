import { useEffect, useState } from 'react';
import Landing from './components/Landing/Landing';
import Dashboard from './components/Dashboard/Dashboard';
import Chat from './components/Chat/Chat';
import AuthModal from './components/AuthModal/AuthModal';
import { api, getToken, setToken } from './api';

export default function App() {
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState(null); // 'login' | 'signup' | null
  const [project, setProject] = useState(null);

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
    setProject(null);
  }

  // Logged in → projects dashboard, then a per-project chat workspace.
  if (user) {
    if (!project) {
      return <Dashboard user={user} onOpen={setProject} onLogout={logout} />;
    }
    return (
      <Chat
        key={project.id}
        user={user}
        project={project}
        onUpdateProject={setProject}
        onBack={() => setProject(null)}
        onLogout={logout}
      />
    );
  }

  // Logged out → landing page + auth modal
  return (
    <>
      <Landing onLogin={() => setAuthMode('login')} onSignup={() => setAuthMode('signup')} />
      {authMode && (
        <AuthModal mode={authMode} onClose={() => setAuthMode(null)} onAuthed={handleAuthed} />
      )}
    </>
  );
}
