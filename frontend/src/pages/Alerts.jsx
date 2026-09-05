import { useMemo, useState } from "react";
import AlertCard from "../components/AlertCard.jsx";
import BottomNav from "../components/BottomNav.jsx";
import FilterTabs from "../components/FilterTabs.jsx";
import Header from "../components/Header.jsx";
import MetricCard from "../components/MetricCard.jsx";
import { severityLevel } from "../services/api.js";

export default function Alerts({ openAlerts, loading, error }) {
  const [filter, setFilter] = useState("all");

  const counts = useMemo(() => ({
    critical: openAlerts.filter((alert) => severityLevel(alert.severity) === "critical").length,
    monitoring: openAlerts.filter((alert) => severityLevel(alert.severity) === "monitoring").length,
    nodata: openAlerts.filter((alert) => severityLevel(alert.severity) === "nodata").length
  }), [openAlerts]);

  const filteredAlerts = useMemo(() => {
    if (filter === "all") return openAlerts;
    return openAlerts.filter((alert) => severityLevel(alert.severity) === filter);
  }, [filter, openAlerts]);

  return (
    <main className="screen alerts-screen">
      <Header subtitle="IMD Automated Diagnostics" liveText="LIVE - INSAT-3DR" />
      <section className="intro-card">
        <div>
          <span>National Fleet Telemetry</span>
          <h1>Alerts Center</h1>
          <p>
            {loading
              ? "Loading active anomaly detections"
              : `${openAlerts.length} Active Anomalies Detected Across National Network`}
          </p>
        </div>
      </section>
      {error ? <p className="state error">{error}</p> : null}
      <div className="metric-grid three">
        <MetricCard tone="critical" label="Critical" value={counts.critical} subtext="Service req." />
        <MetricCard tone="monitor" label="Monitoring" value={counts.monitoring} subtext="Early drift" />
        <MetricCard tone="nodata" label="No Data" value={counts.nodata} subtext="Silent pod" />
      </div>
      <FilterTabs
        value={filter}
        onChange={setFilter}
        tabs={[
          { value: "all", label: `All (${openAlerts.length})` },
          { value: "critical", label: `Critical (${counts.critical})` },
          { value: "monitoring", label: `Monitoring (${counts.monitoring})` },
          { value: "nodata", label: `No Data (${counts.nodata})` }
        ]}
      />
      <section className="alert-section">
        <div className="section-title">
          <h2>Service Required</h2>
          <span>Immediate Priority</span>
        </div>
        {filteredAlerts.length ? (
          <div className="alert-list">
            {filteredAlerts.map((alert) => (
              <AlertCard key={alert.id || `${alert.station_id}-${alert.created_at}`} alert={alert} />
            ))}
          </div>
        ) : (
          <p className="state">No alerts match this view.</p>
        )}
      </section>
      <BottomNav active="alerts" alertCount={openAlerts.length} />
    </main>
  );
}
