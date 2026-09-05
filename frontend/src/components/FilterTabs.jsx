export default function FilterTabs({ tabs, value, onChange }) {
  return (
    <div className="filter-tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          className={value === tab.value ? "active" : ""}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
