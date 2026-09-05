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

  if (current.name === "network") return <Network {...commonProps} />;
  if (current.name === "stations") return <Stations {...commonProps} />;
  if (current.name === "station") return <StationDetail {...commonProps} />;
  if (current.name === "pressure") return <PressureHeartbeat {...commonProps} />;
  if (current.name === "alerts") return <Alerts {...commonProps} />;

  return <Dashboard {...commonProps} />;
}

function RedirectToLogin() {
  useEffect(() => {
    window.location.replace("/login");
  }, []);

  return (
    <main className="screen auth-screen">
      <section className="auth-card">
        <span>Sahasraksha Access</span>
        <h1>Login Required</h1>
        <p>Redirecting to secure access.</p>
      </section>
    </main>
  );
}

export default function App() {
  const current = route();
  const { loading, session } = useAuth();

  if (current.name === "login") {
    return <div className="phone-shell"><Login /></div>;
  }

  if (current.name === "signup") {
    return <div className="phone-shell"><SignUp /></div>;
  }

  if (loading) {
    return (
      <div className="phone-shell">
        <main className="screen auth-screen">
          <section className="auth-card">
            <span>SkyGuard AI</span>
            <h1>Loading Session</h1>
            <p>Checking secure access.</p>
          </section>
        </main>
      </div>
    );
  }

  if (!session) {
    return <div className="phone-shell"><RedirectToLogin /></div>;
  }

  return <div className="phone-shell"><DataRoute current={current} /></div>;
}
