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
  if (loading) {
    return (
      <main className="screen alerts-screen">
        <div className="loading-state-card">
          <div className="loading-spinner" />
          <p>Scoring live station telemetry against fitted baselines...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="screen alerts-screen">
      {/* Page Header */}
      <div className="page-header-strip">
        <div>
          <span className="section-eyebrow">INTELLIGENT ANOMALY SURVEILLANCE</span>
          <h1 className="page-main-heading">Telemetry Anomaly Center</h1>
          <p className="page-sub-heading">
            {loading
              ? "Scoring live station telemetry against fitted baselines..."
              : `${openAlerts.length} explainable anomalies detected via 4-layer physics & ML verification`}
          </p>
          {/* Most faults on the live demo feed are injected on purpose
              (keepalive_service.py) into replayed real station data. The
              page never said so, so each card read as a real fault at a
              real IMD station. */}
          <p className="page-sub-heading">
            Most faults on this demo feed are injected periodically into replayed real station data;
            each card is the live detector's own verdict on one.
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
          <small className="alert-kpi-hint">Severity 80% and above</small>
        </div>

        <div
          className={`alert-kpi-card tone-monitor ${filter === "monitoring" ? "active" : ""}`}
          onClick={() => setFilter("monitoring")}
          role="button"
          tabIndex={0}
        >
          <span className="alert-kpi-label">Elevated Priority</span>
          <strong className="alert-kpi-val text-amber">{counts.monitoring.toLocaleString()}</strong>
          <small className="alert-kpi-hint">Severity 50-79%</small>
        </div>

        <div
          className={`alert-kpi-card tone-nodata ${filter === "nodata" ? "active" : ""}`}
          onClick={() => setFilter("nodata")}
          role="button"
          tabIndex={0}
        >
          <span className="alert-kpi-label">Low Priority</span>
          <strong className="alert-kpi-val text-cyan">{counts.nodata.toLocaleString()}</strong>
          <small className="alert-kpi-hint">Severity below 50%</small>
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
            { value: "monitoring", label: `Elevated Priority (${counts.monitoring})` },
            { value: "nodata", label: `Low Priority (${counts.nodata})` }
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
