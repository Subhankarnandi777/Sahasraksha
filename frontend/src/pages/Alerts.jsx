import { useMemo, useState } from "react";
import AlertCard from "../components/AlertCard.jsx";
import FilterTabs from "../components/FilterTabs.jsx";
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
      {/* Page Header */}
      <div className="page-header-strip">
        <div>
          <span className="section-eyebrow">INTELLIGENT ANOMALY SURVEILLANCE</span>
          <h1 className="page-main-heading">Telemetry Anomaly Center</h1>
          <p className="page-sub-heading">
            {loading
              ? "Running conformal inference across station stream..."
              : `${openAlerts.length} explainable anomalies detected via 4-layer physics & ML verification`}
          </p>
        </div>
      </div>

      {error ? <p className="state error">{error}</p> : null}

      {/* Triage KPI Strip */}
      <div className="alert-kpi-row">
        <div
          className={`alert-kpi-card ${filter === "all" ? "active" : ""}`}
          onClick={() => setFilter("all")}
          role="button"
          tabIndex={0}
        >
          <span className="alert-kpi-label">Total Flagged</span>
          <strong className="alert-kpi-val text-white">{openAlerts.length.toLocaleString()}</strong>
          <small className="alert-kpi-hint">All detection levels</small>
        </div>

        <div
          className={`alert-kpi-card tone-critical ${filter === "critical" ? "active" : ""}`}
          onClick={() => setFilter("critical")}
          role="button"
          tabIndex={0}
        >
          <span className="alert-kpi-label">Critical Priority</span>
          <strong className="alert-kpi-val text-rose">{counts.critical.toLocaleString()}</strong>
          <small className="alert-kpi-hint">Urgent field service</small>
        </div>

        <div
          className={`alert-kpi-card tone-monitor ${filter === "monitoring" ? "active" : ""}`}
          onClick={() => setFilter("monitoring")}
          role="button"
          tabIndex={0}
        >
          <span className="alert-kpi-label">Drift Monitoring</span>
          <strong className="alert-kpi-val text-amber">{counts.monitoring.toLocaleString()}</strong>
          <small className="alert-kpi-hint">CUSUM / Tide decay</small>
        </div>

        <div
          className={`alert-kpi-card tone-nodata ${filter === "nodata" ? "active" : ""}`}
          onClick={() => setFilter("nodata")}
          role="button"
          tabIndex={0}
        >
          <span className="alert-kpi-label">Sensor Advisory</span>
          <strong className="alert-kpi-val text-cyan">{counts.nodata.toLocaleString()}</strong>
          <small className="alert-kpi-hint">Minor variance / transient</small>
        </div>
      </div>

      {/* Filter Tabs Bar */}
      <div className="alert-filter-bar">
        <FilterTabs
          value={filter}
          onChange={setFilter}
          tabs={[
            { value: "all", label: `All Alerts (${openAlerts.length})` },
            { value: "critical", label: `Critical Priority (${counts.critical})` },
            { value: "monitoring", label: `Drift Monitoring (${counts.monitoring})` },
            { value: "nodata", label: `Advisory (${counts.nodata})` }
          ]}
        />
        <span className="alert-filter-count">
          Showing <b>{filteredAlerts.length}</b> notifications
        </span>
      </div>

      {/* Alerts Grid */}
      <section className="alert-grid-container">
        {filteredAlerts.length ? (
          filteredAlerts.map((alert) => (
            <AlertCard
              key={alert.id || `${alert.station_id}-${alert.created_at}`}
              alert={alert}
            />
          ))
        ) : (
          <div className="empty-state-card">
            <span className="empty-icon">✅</span>
            <h3>No anomalies in this category</h3>
            <p>All monitored station channels meet nominal physical bounds.</p>
          </div>
        )}
      </section>
    </main>
  );
}
