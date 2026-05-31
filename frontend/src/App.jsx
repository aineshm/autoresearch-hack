import { useEffect, useState } from 'react';
import Landing from './components/Landing/Landing';
import Dashboard from './components/Dashboard/Dashboard';
import ProjectIntake from './components/Project/ProjectIntake';
import Chat from './components/Chat/Chat';
import AuthModal from './components/AuthModal/AuthModal';
import { api, getToken, setToken } from './api';

export default function App() {
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState(null); // 'login' | 'signup' | null
  const [project, setProject] = useState(null);
  const [mode, setMode] = useState('chat'); // for the open project: 'intake' | 'chat'

  // Opening a project: ones without data start in the file-drop intake; ready ones go to chat.
  function openProject(p) {
    setProject(p);
    setMode(p.hasData ? 'chat' : 'intake');
  }

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

  // Logged in → projects dashboard → (intake if no data) → per-project chat workspace.
  if (user) {
    if (!project) {
      return <Dashboard user={user} onOpen={openProject} onLogout={logout} />;
    }
    if (mode === 'intake') {
      return (
        <ProjectIntake
          project={project}
          onReady={(p) => { setProject(p); setMode('chat'); }}
          onSkip={() => setMode('chat')}
          onBack={() => setProject(null)}
        />
      );
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
