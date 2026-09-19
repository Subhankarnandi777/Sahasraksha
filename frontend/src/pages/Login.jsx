import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext.jsx";
import { validateEmail } from "../services/auth.js";

export default function Login() {
  const [form, setForm] = useState({ email: "sudipmanna6506@gmail.com", password: "" });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { login, session } = useAuth();

  useEffect(() => {
    if (session) {
      window.location.replace("/dashboard");
    }
  }, [session]);

  function update(field, value) {
    setError("");
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event) {
    event.preventDefault();

    if (!form.email.trim()) {
      setError("Email is required.");
      return;
    }
    if (!validateEmail(form.email)) {
      setError("Enter a valid email address.");
      return;
    }
    if (!form.password) {
      setError("Password is required.");
      return;
    }

    setSubmitting(true);
    try {
      await login(form.email.trim(), form.password);
      window.location.replace("/dashboard");
    } catch (err) {
      setError(err.message || "Unable to log in.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-viewport">
      <div className="auth-glass-container">
        {/* Brand Lockup */}
        <div className="auth-brand-head">
          <div className="brand-logo-symbol large">
            <span className="radar-ping" />
            <span className="logo-text">SA</span>
          </div>
          <div className="auth-brand-text">
            <h2>SAHASRAKSHA</h2>
            <span>IMD Atmospheric Anomaly Detection System</span>
          </div>
        </div>

        <div className="auth-card-body">
          <div className="auth-badge-row">
            <span className="auth-status-badge">SECURE TELEMETRY CONSOLE</span>
          </div>
          <h1 className="auth-welcome-title">Operator Login</h1>
          <p className="auth-welcome-desc">
            Sign in to access real-time synoptic telemetry and autonomous ML diagnostics across 60 Indian AWS stations.
          </p>

          <form onSubmit={submit} noValidate className="auth-form-cluster">
            <label className="auth-field">
              <span className="field-label">Official Operator Email</span>
              <input
                type="email"
                value={form.email}
                onChange={(event) => update("email", event.target.value)}
                autoComplete="username"
                placeholder="sudipmanna6506@gmail.com"
                required
              />
            </label>

            <label className="auth-field">
              <span className="field-label">Console Password</span>
              <input
                type="password"
                value={form.password}
                onChange={(event) => update("password", event.target.value)}
                autoComplete="current-password"
                placeholder="••••••••••••"
                required
              />
            </label>

            {error ? <div className="auth-error-alert">{error}</div> : null}

            <button className="auth-submit-btn" type="submit" disabled={submitting}>
              {submitting ? "Authenticating Operator..." : "Enter Command Console →"}
            </button>
          </form>

          <div className="auth-footer-help">
            <span>Pre-authorized credentials: <b>sudipmanna6506@gmail.com</b></span>
            <p className="auth-switch-link">Need a new console account? <a href="/signup">Sign Up</a></p>
          </div>
        </div>
      </div>
    </main>
  );
}
