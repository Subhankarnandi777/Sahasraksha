const items = [
  { href: "/dashboard", label: "Home", icon: "home" },
  { href: "/network", label: "Map", icon: "map" },
  { href: "/alerts", label: "Alerts", icon: "bell" },
  { href: "/stations", label: "Stations", icon: "radio" }
];

function Icon({ name }) {
  return (
    <span className={`nav-icon nav-icon-${name}`} aria-hidden="true" />
  );
}

export default function BottomNav({ active, alertCount = 0 }) {
  return (
    <nav className="bottom-nav" aria-label="Primary">
      {items.map((item) => (
        <a key={item.href} href={item.href} className={active === item.label.toLowerCase() ? "active" : ""}>
          <Icon name={item.icon} />
          <span>{item.label}</span>
          {item.label === "Alerts" && alertCount > 0 ? <b>{alertCount}</b> : null}
        </a>
      ))}
    </nav>
  );
}
