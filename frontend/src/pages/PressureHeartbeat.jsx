import { useState } from "react";
import BottomNav from "../components/BottomNav.jsx";
import FilterTabs from "../components/FilterTabs.jsx";
import Header from "../components/Header.jsx";
import Sparkline from "../components/Sparkline.jsx";
import { evidenceText, percent } from "../services/api.js";

function heartbeatLoss(verdicts, alerts) {
  const candidates = [...alerts, ...verdicts];
  for (const item of candidates) {
    const pair = (item.evidence || []).find(([key]) => key === "tide_loss");
    if (pair) return Number(pair[1]);
  }
  return Number(candidates[0]?.degradation || 0);
}

export default function PressureHeartbeat({ selectedStation, timeseries, verdicts, openAlerts, loading, error }) {
  const [mode, setMode] = useState("heartbeat");
  const stationAlerts = selectedStation ? openAlerts.filter((alert) => alert.station_id === selectedStation.station_id) : [];
  const loss = heartbeatLoss(verdicts, stationAlerts);
  const pressureValues = timeseries.map((row) => row.P).filter((value) => value !== null);
  const evidence = stationAlerts[0]?.evidence || verdicts[verdicts.length - 1]?.evidence || [];

  return (
    <main className="screen pressure-screen">
      <Header subtitle="Atmospheric Sentinel" liveText="LIVE - S2 Harmonic QC" />
      <div className="center-title">
        <a href={selectedStation ? `/stations/${encodeURIComponent(selectedStation.station_id)}` : "/stations"}>Back</a>
        <div>
          <h1>Pressure Heartbeat</h1>
          <p>{selectedStation?.station_id || "Station"} - {selectedStation?.name || "Loading"}</p>
        </div>
      </div>
      {error ? <p className="state error">{error}</p> : null}
      <section className="loss-card">
        <h2>-{Math.round(loss * 100)}%</h2>
        <span>Heartbeat Strength Loss</span>
        <p>Detect degradation before the readings look wrong.</p>
        <FilterTabs
          value={mode}
          onChange={setMode}
          tabs={[
            { value: "actual", label: "Actual" },
            { value: "heartbeat", label: "Heartbeat" },
            { value: "combined", label: "Combined" }
          ]}
        />
      </section>
      <section className="card pressure-chart">
        <div className="chart-head">
          <span>Raw Pressure Trend</span>
          <b>IMD Range QC: Pass</b>
        </div>
        <h2>Standard Hydrostatic Envelope</h2>
        {pressureValues.length ? <Sparkline values={pressureValues.slice(-21)} tone="blue" height={110} /> : <p className="state">No pressure telemetry available.</p>}
        <p>Surface barometrics oscillate within operational bounds while harmonic loss can still indicate sensor degradation.</p>
      </section>
      <section className="card resonance-card">
        <div className="chart-head">
          <span>S2 Solar-Tide Resonance</span>
          <b className={loss > 0.1 ? "danger-pill" : "ok-pill"}>{loss > 0.1 ? "Anomaly Active" : "Normal"}</b>
        </div>
        <h2>12h Harmonic Amplitude Response</h2>
        <div className="resonance-visual">
          <Sparkline values={pressureValues.slice(-48)} tone="red" height={120} />
          <mark>Alert threshold</mark>
        </div>
        {evidence.length ? evidence.slice(0, 3).map((pair) => <p className="state" key={`${pair[0]}-${pair[1]}`}>{evidenceText(pair)}</p>) : null}
      </section>
      <BottomNav active="alerts" alertCount={openAlerts.length} />
    </main>
  );
}
