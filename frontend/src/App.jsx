import { Suspense, lazy, useEffect } from "react";
import { useAuth } from "./auth/AuthContext.jsx";
import useSahasrakshaData from "./services/useSahasrakshaData.js";

// Every page is lazy-loaded so the initial bundle only ships the app shell
// and auth logic, not all eight pages at once. This matters most for
// Network, which pulls in Leaflet (a large mapping library) -- previously
// every visitor downloaded that even if they never opened the map.
const Dashboard = lazy(() => import("./pages/Dashboard.jsx"));
const Network = lazy(() => import("./pages/Network.jsx"));
const Stations = lazy(() => import("./pages/Stations.jsx"));
const StationDetail = lazy(() => import("./pages/StationDetail.jsx"));
const PressureHeartbeat = lazy(() => import("./pages/PressureHeartbeat.jsx"));
const Alerts = lazy(() => import("./pages/Alerts.jsx"));
const Login = lazy(() => import("./pages/Login.jsx"));
const SignUp = lazy(() => import("./pages/SignUp.jsx"));

function RouteLoading() {
  return (
    <main className="screen auth-screen">
      <section className="auth-card">
        <span>SAHASRAKSHA</span>
        <h1>Loading</h1>
        <p>Fetching this page.</p>
      </section>
    </main>
  );
}

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
        <span>SAHASRAKSHA Access</span>
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
    return (
      <div className="phone-shell">
        <Suspense fallback={<RouteLoading />}>
          <Login />
        </Suspense>
      </div>
    );
  }

  if (current.name === "signup") {
    return (
      <div className="phone-shell">
        <Suspense fallback={<RouteLoading />}>
          <SignUp />
        </Suspense>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="phone-shell">
        <main className="screen auth-screen">
          <section className="auth-card">
            <span>SAHASRAKSHA</span>
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

  return (
    <div className="phone-shell">
      <Suspense fallback={<RouteLoading />}>
        <DataRoute current={current} />
      </Suspense>
    </div>
  );
}
