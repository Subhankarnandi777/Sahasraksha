import { useAuth } from "../auth/AuthContext.jsx";
import { useTheme } from "../services/theme.js";

const NAV_LINKS = [
  { href: "/dashboard", label: "Dashboard", icon: "grid" },
  { href: "/network", label: "Fleet Map", icon: "map" },
  { href: "/stations", label: "AWS Stations", icon: "radio" },
  { href: "/alerts", label: "Anomaly Alerts", icon: "bell", badge: true },
];

export default function Navbar({ active = "dashboard", alertCount = 0 }) {
  const { session, user, logout } = useAuth();
  const { theme, toggleTheme, isDark } = useTheme();

  async function handleLogout() {
    await logout();
    window.location.replace("/login");
  }

  const userEmail = user?.email || session?.user?.email || "sudipmanna6506@gmail.com";
  const initials = userEmail.slice(0, 2).toUpperCase();

  return (
    <header className="main-navbar">
      <div className="navbar-container">
        {/* Brand Lockup */}
        <a href="/dashboard" className="nav-brand" aria-label="Sahasraksha Home">
          <div className="brand-logo-symbol">
            <span className="radar-ping" />
            <span className="logo-text">SA</span>
          </div>
          <div className="brand-text-block">
            <div className="brand-title-row">
              <span className="brand-title">SAHASRAKSHA</span>
              <span className="brand-tag">IMD</span>
            </div>
            <span className="brand-sub">Atmospheric Sentinel • India Network</span>
          </div>
        </a>

        {/* Center Nav Links */}
        <nav className="nav-menu" aria-label="Main Navigation">
          {NAV_LINKS.map((link) => {
            const isActive = active === link.label.toLowerCase() || 
                             (link.href === "/dashboard" && active === "home") ||
                             (link.href === "/network" && active === "network") ||
                             (link.href === "/stations" && active === "stations") ||
                             (link.href === "/alerts" && active === "alerts");
            return (
              <a
                key={link.href}
                href={link.href}
                className={`nav-link ${isActive ? "active" : ""}`}
              >
                <span className={`nav-icon icon-${link.icon}`} />
                <span className="nav-label">{link.label}</span>
                {link.badge && alertCount > 0 ? (
                  <span className="nav-alert-badge">{alertCount.toLocaleString()}</span>
                ) : null}
              </a>
            );
          })}
        </nav>

        {/* Right Side Actions */}
        <div className="nav-actions">
          {/* Global System Dark / Light Theme Toggle */}
          <button
            type="button"
            className="nav-theme-toggle"
            onClick={toggleTheme}
            title={`Switch to ${isDark ? "Light Mode (Warm Solar)" : "Dark Mode (Command Center)"}`}
            aria-label="Toggle System Theme"
          >
            <span className="nav-theme-knob">
              {isDark ? "🌙" : "☀️"}
            </span>
            <span className="nav-theme-text">
              {isDark ? "Dark Mode" : "Light Mode"}
            </span>
          </button>

          {/* Live Sync Satellite Indicator */}
          <div className="nav-live-indicator" title="Live INSAT-3DR Atmospheric Stream Connected">
            <span className="live-radar-dot" />
            <span className="live-indicator-text">LIVE • INSAT-3DR</span>
          </div>

          {/* User Profile & Logout */}
          <div className="nav-user-cluster">
            <div className="user-avatar" title={userEmail}>
              {initials}
            </div>
            <div className="user-info-text">
              <span className="user-role-badge">OPERATOR</span>
              <span className="user-email-text">{userEmail}</span>
            </div>
            <button
              type="button"
              className="btn-logout"
              onClick={handleLogout}
              title="Sign out of console"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
