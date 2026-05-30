import './Nav.css';

export default function Nav({ user, onLogin, onSignup, onLogout }) {
  return (
    <header className="nav">
      <div className="nav-inner glass">
        <a className="brand" href="/" aria-label="AutoLab home">
          <img src="/autolab-logo.svg" alt="" className="brand-logo" />
          <span className="brand-name">AutoLab</span>
        </a>
        <nav className="nav-links">
          {user ? (
            <div className="user-menu">
              <span className="user-email" title={user.email}>
                {user.name || user.email}
              </span>
              <button className="nav-link" onClick={onLogout}>Log out</button>
            </div>
          ) : (
            <>
              <button className="nav-link ghost" onClick={onLogin}>Log in</button>
              <button className="nav-link solid" onClick={onSignup}>Sign up</button>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
