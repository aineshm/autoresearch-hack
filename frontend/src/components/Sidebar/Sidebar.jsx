import { useEffect, useRef, useState } from 'react';
import './Sidebar.css';

function initials(user) {
  const name = (user?.name || '').trim();
  if (name) {
    const parts = name.split(/\s+/);
    return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase();
  }
  return (user?.email?.[0] || 'U').toUpperCase();
}

/* --- inline icons --- */
const IconSidebar = (p) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8"
       strokeLinecap="round" strokeLinejoin="round" {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16" />
  </svg>
);
const IconNewChat = (p) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8"
       strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
const IconBubble = (p) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7"
       strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7A8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z" />
  </svg>
);
const IconLogout = (p) => (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8"
       strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="M16 17l5-5-5-5M21 12H9" />
  </svg>
);

export default function Sidebar({
  user, collapsed, onToggle, conversations, activeId, onSelect, onNewChat, onLogout,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const footerRef = useRef(null);

  // close profile menu on outside click / Escape
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e) => { if (!footerRef.current?.contains(e.target)) setMenuOpen(false); };
    const onKey = (e) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  return (
    <aside className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}`}>
      <div className="sidebar-top">
        <a className="sidebar-brand" href="/" aria-label="AutoLab home">
          <img src="/autolab-logo.svg" alt="" className="sidebar-logo" />
          <span className="sidebar-brand-name">AutoLab</span>
        </a>
        <button className="icon-btn sidebar-toggle" onClick={onToggle}
                aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          <IconSidebar />
        </button>
      </div>

      <button className="new-chat" onClick={onNewChat} title="New chat">
        <IconNewChat />
        <span className="new-chat-label">New chat</span>
      </button>

      <div className="sidebar-list">
        <div className="sidebar-list-label">Chats</div>
        {conversations.map((c) => (
          <button
            key={c.id}
            className={`conv${c.id === activeId ? ' conv--active' : ''}`}
            onClick={() => onSelect(c.id)}
            title={c.title}
          >
            <IconBubble className="conv-icon" />
            <span className="conv-title">{c.title || 'New chat'}</span>
          </button>
        ))}
      </div>

      <div className="sidebar-footer" ref={footerRef}>
        {menuOpen && (
          <div className="profile-menu glass">
            <div className="profile-menu-head">
              <span className="profile-menu-name">{user?.name || 'Account'}</span>
              <span className="profile-menu-email">{user?.email}</span>
            </div>
            <button className="profile-menu-item" onClick={onLogout}>
              <IconLogout />
              <span>Log out</span>
            </button>
          </div>
        )}
        <button
          className="profile-btn"
          onClick={() => setMenuOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title={user?.name || user?.email}
        >
          <span className="avatar">{initials(user)}</span>
          <span className="profile-name">{user?.name || user?.email}</span>
        </button>
      </div>
    </aside>
  );
}
