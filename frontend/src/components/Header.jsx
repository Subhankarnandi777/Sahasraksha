import { useAuth } from "../auth/AuthContext.jsx";

export default function Header({ eyebrow = "SAHASRAKSHA", subtitle = "National Network", liveText = "LIVE" }) {
  const { session, logout } = useAuth();

  async function handleLogout() {
    await logout();
    window.location.replace("/login");
  }

  return (
    <header className="app-header">
      <a href="/dashboard" className="brand-lockup" aria-label="Sahasraksha dashboard">
        <span className="brand-mark">SA</span>
        <span>
          <strong>{eyebrow} <em>IMD</em></strong>
          <small>{subtitle}</small>
        </span>
      </a>
      {session ? (
        <button className="live-pill" type="button" onClick={handleLogout}><i />Logout</button>
      ) : (
        <span className="live-pill"><i />{liveText}</span>
      )}
    </header>
  );
}
