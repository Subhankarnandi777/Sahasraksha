import { useAuth } from "../auth/AuthContext.jsx";
import { useTheme } from "../services/theme.js";
import { isSilent, networkReferenceTime } from "../services/api.js";
import { AUTH_REQUIRED } from "../config.js";

// Small stroke icons, drawn inline so they need no icon font or CSS sprite.
// (The old nav rendered empty <span class="icon-*"> tags with no CSS behind
// them, which only added a gap in front of each label.)
const ICONS = {
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  map: (
    <>
      <path d="M9 4 3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5z" />
      <path d="M9 4v13.5M15 6.5V20" />
    </>
  ),
  station: (
    <>
      <path d="M12 21V11" />
      <circle cx="12" cy="8" r="2.2" />
      <path d="M7.5 3.8a6.5 6.5 0 0 0 0 8.4M16.5 3.8a6.5 6.5 0 0 1 0 8.4" />
      <path d="M8.5 21h7" />
    </>
  ),
  bell: (
    <>
      <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z" />
      <path d="M10 20.5a2 2 0 0 0 4 0" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
  logout: (
    <>
      <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
      <path d="M10 16l-4-4 4-4M6 12h10" />
    </>
  ),
};

function Icon({ name, size = 16 }) {
  return (
    <svg
      className="nav-svg-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  );
}

const NAV_LINKS = [
  { href: "/dashboard", label: "Dashboard", icon: "grid", match: ["dashboard", "home"] },
  { href: "/network", label: "Network Map", icon: "map", match: ["network"] },
  { href: "/stations", label: "Stations", icon: "station", match: ["stations", "station", "pressure"] },
  { href: "/alerts", label: "Alerts", icon: "bell", match: ["alerts"], badge: true },
];

export default function Navbar({ active = "dashboard", alertCount = 0, stations = [], error, loading }) {
  const { session, user, logout } = useAuth();
  const { toggleTheme, isDark } = useTheme();

  async function handleLogout() {
    await logout();
    window.location.replace("/login");
  }

  // Account controls only make sense when there is a login. With the gate
  // off (the judges' build) there is never a session, which used to leave
  // "OPERATOR / Loading session..." and a Sign Out button that dumped the
  // visitor on the login page.
  const userEmail = user?.email || session?.user?.email || "";
  const showAccount = AUTH_REQUIRED && Boolean(userEmail);
  const initials = userEmail ? userEmail.slice(0, 2).toUpperCase() : "";

  // Feed status reflects this session's real fetch state (never a fixed
  // "LIVE"): an active fetch error means the feed is down; half or more of
  // the fleet gone silent means it's degraded.
  const referenceTime = networkReferenceTime(stations);
  const silentCount = stations.filter((s) => isSilent(s, referenceTime)).length;
  const feedDown = Boolean(error);
  const feedDegraded = !feedDown && stations.length > 0 && silentCount >= Math.ceil(stations.length / 2);
  const feedStatusClass = loading ? "is-connecting" : feedDown ? "is-down" : feedDegraded ? "is-degraded" : "";
  const feedLabel = loading
    ? "Connecting…"
    : feedDown
    ? "Feed offline"
    : feedDegraded
    ? "Feed degraded"
    : stations.length
    ? `Live · ${stations.length} stations`
    : "Live";
  const feedTitle = loading
    ? "Connecting to the station network"
    : feedDown
    ? "Station network feed unreachable"
    : feedDegraded
    ? `${silentCount} of ${stations.length} stations have gone silent`
    : `Station feed connected${silentCount ? ` · ${silentCount} silent` : ""}`;

  const badgeText = alertCount > 99 ? "99+" : String(alertCount);

  return (
    <header className="main-navbar">
      <div className="navbar-container">
        {/* Brand */}
        <a href="/dashboard" className="nav-brand" aria-label="Sahasraksha home">
          <div className="brand-logo-symbol">
            <span className="logo-text">SA</span>
          </div>
          <div className="brand-text-block">
            <div className="brand-title-row">
              <span className="brand-title">SAHASRAKSHA</span>
              {/* Honest, single label: a student prototype for SIH 2026, not
                  an IMD system. (An "IMD" chip used to sit here and read as
                  an official affiliation.) */}
              <span
                className="brand-prototype-tag"
                title="Student-built prototype for Smart India Hackathon 2026, problem statement SIH26073. Not an operational IMD system."
              >
                SIH26073 · Prototype
              </span>
            </div>
            <span className="brand-sub">AI anomaly detection for weather stations</span>
          </div>
        </a>

        {/* Primary navigation */}
        <nav className="nav-menu" aria-label="Main navigation">
          {NAV_LINKS.map((link) => {
            const isActive = link.match.includes(active);
            return (
              <a
                key={link.href}
                href={link.href}
                className={`nav-link ${isActive ? "active" : ""}`}
                aria-current={isActive ? "page" : undefined}
              >
                <Icon name={link.icon} />
                <span className="nav-label">{link.label}</span>
                {link.badge && alertCount > 0 ? (
                  <span className="nav-alert-badge" aria-label={`${alertCount} open alerts`}>
                    {badgeText}
                  </span>
                ) : null}
              </a>
            );
          })}
        </nav>

        {/* Right side: feed status, theme, account (only with a login) */}
        <div className="nav-actions">
          <div className={`nav-live-indicator ${feedStatusClass}`} title={feedTitle} role="status">
            <span className={`live-radar-dot ${feedStatusClass}`} />
            <span className="live-indicator-text">{feedLabel}</span>
          </div>

          <button
            type="button"
            className="nav-icon-btn nav-theme-toggle"
            onClick={toggleTheme}
            title={isDark ? "Switch to light theme" : "Switch to dark theme"}
            aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
          >
            <Icon name={isDark ? "sun" : "moon"} size={17} />
          </button>

          {showAccount ? (
            <div className="nav-user-cluster">
              <div className="user-avatar" title={userEmail}>
                {initials}
              </div>
              <button
                type="button"
                className="nav-icon-btn btn-logout"
                onClick={handleLogout}
                title="Sign out"
                aria-label="Sign out"
              >
                <Icon name="logout" size={16} />
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
