import { useAuth } from "../auth/AuthContext.jsx";
import { useTheme } from "../services/theme.js";
import { isSilent, networkReferenceTime } from "../services/api.js";

const NAV_LINKS = [
  { href: "/dashboard", label: "Dashboard", icon: "grid" },
  { href: "/network", label: "Fleet Map", icon: "map" },
  { href: "/stations", label: "AWS Stations", icon: "radio" },
  { href: "/alerts", label: "Anomaly Alerts", icon: "bell", badge: true },
];

export default function Navbar({ active = "dashboard", alertCount = 0, stations = [], error, loading }) {
  const { session, user, logout } = useAuth();
  const { theme, toggleTheme, isDark } = useTheme();

  async function handleLogout() {
    await logout();
    window.location.replace("/login");
  }

  const userEmail = user?.email || session?.user?.email || "";
  const initials = userEmail ? userEmail.slice(0, 2).toUpperCase() : "OP";

  // This dot used to say "LIVE" unconditionally on every page, animated
  // green dot included, whether or not the API call behind the page had
  // actually succeeded. A Render cold-start or a real backend error still
  // showed "LIVE" the whole time. Same threshold Dashboard/Network already
  // use for their own pipeline pills: an active fetch error means the feed
  // is down; half or more of the fleet gone silent means it's degraded.
  const referenceTime = networkReferenceTime(stations);
  const silentCount = stations.filter((s) => isSilent(s, referenceTime)).length;
  const feedDown = Boolean(error);
  const feedDegraded = !feedDown && stations.length > 0 && silentCount >= Math.ceil(stations.length / 2);
  const feedStatusClass = feedDown ? "is-down" : feedDegraded ? "is-degraded" : "";
  const feedLabel = loading
    ? "Connecting"
    : feedDown
    ? "Offline"
    : feedDegraded
    ? "Degraded"
    : "Live";

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
              <span className="brand-prototype-tag" title="Student-built submission for Smart India Hackathon 2026 (PS SIH26073) -- not an operational IMD system">
                SIH 2026 Prototype
              </span>
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

          {/* Live Station Network Indicator -- real IMD/NOAA-ISD station feed,
              not a satellite integration we don't actually have. Reflects
              this session's actual fetch state instead of a fixed "LIVE"
              string. */}
          <div
            className={`nav-live-indicator ${feedStatusClass}`}
            title={
              feedDown
                ? "Station network feed unreachable"
                : feedDegraded
                ? `${silentCount} of ${stations.length} stations have gone silent`
                : "Live automatic weather station network feed connected"
            }
          >
            <span className={`live-radar-dot ${feedStatusClass}`} />
            <span className="live-indicator-text">{feedLabel.toUpperCase()} • Station Network</span>
          </div>

          {/* User Profile & Logout */}
          <div className="nav-user-cluster">
            <div className="user-avatar" title={userEmail || "Session loading"}>
              {initials}
            </div>
            <div className="user-info-text">
              <span className="user-role-badge">OPERATOR</span>
              {/* Was falling back to a specific hardcoded email
                  (sudipmanna6506@gmail.com) whenever the auth session
                  hadn't resolved yet -- asserting a named real person is
                  signed in when nobody's session had actually loaded. */}
              <span className="user-email-text">{userEmail || "Loading session..."}</span>
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
