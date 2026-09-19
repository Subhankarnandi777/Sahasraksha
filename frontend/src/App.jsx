import { useEffect } from "react";
import { useAuth } from "./auth/AuthContext.jsx";
import useSahasrakshaData from "./services/useSahasrakshaData.js";
import Dashboard from "./pages/Dashboard.jsx";
import Network from "./pages/Network.jsx";
import Stations from "./pages/Stations.jsx";
import StationDetail from "./pages/StationDetail.jsx";
import PressureHeartbeat from "./pages/PressureHeartbeat.jsx";
import Alerts from "./pages/Alerts.jsx";
import Login from "./pages/Login.jsx";
import SignUp from "./pages/SignUp.jsx";

import Navbar from "./components/Navbar.jsx";

function route() {
  const path = window.location.pathname.replace(/\/$/, "") || "/dashboard";
  const parts = path.split("/").filter(Boolean);

  if (path === "/" || path === "/dashboard") return { name: "dashboard" };
  if (path === "/login") return { name: "login" };
  if (path === "/signup") return { name: "signup" };
  if (path === "/network") return { name: "network" };
  if (path === "/alerts") return { name: "alerts" };
  if (path === "/stations") return { name: "stations" };
  if (parts[0] === "stations" && parts[1] && parts[2] === "pressure") {
    return { name: "pressure", stationId: decodeURIComponent(parts[1]) };
  }
  if (parts[0] === "stations" && parts[1]) {
    return { name: "station", stationId: decodeURIComponent(parts[1]) };
  }

  return { name: "dashboard" };
}

function DataRoute({ current }) {
  const data = useSahasrakshaData(current.stationId);
  const commonProps = { ...data };

  return (
    <div className="app-layout">
      <Navbar active={current.name} alertCount={data.openAlerts?.length || 0} />
      <div className="main-content-viewport">
        {current.name === "network" ? <Network {...commonProps} /> : null}
        {current.name === "stations" ? <Stations {...commonProps} /> : null}
        {current.name === "station" ? <StationDetail {...commonProps} /> : null}
        {current.name === "pressure" ? <PressureHeartbeat {...commonProps} /> : null}
        {current.name === "alerts" ? <Alerts {...commonProps} /> : null}
        {current.name === "dashboard" ? <Dashboard {...commonProps} /> : null}
      </div>
    </div>
  );
}

function RedirectToLogin() {
  useEffect(() => {
    window.location.replace("/login");
  }, []);

  return (
    <main className="screen auth-screen">
      <section className="auth-card">
        <span>SAHASRAKSHA Access</span>
        <h1>Login Required</h1>
        <p>Redirecting to secure access console...</p>
      </section>
    </main>
  );
}

export default function App() {
  const current = route();
  const { loading, session } = useAuth();

  if (current.name === "login") {
    return <div className="auth-shell"><Login /></div>;
  }

  if (current.name === "signup") {
    return <div className="auth-shell"><SignUp /></div>;
  }

  if (loading) {
    return (
      <div className="auth-shell">
        <main className="screen auth-screen">
          <section className="auth-card">
            <span className="auth-brand-eyebrow">SAHASRAKSHA</span>
            <h1>Loading Session</h1>
            <p>Checking secure telemetry access...</p>
          </section>
        </main>
      </div>
    );
  }

  if (!session) {
    return <div className="auth-shell"><RedirectToLogin /></div>;
  }

  return <DataRoute current={current} />;
}

