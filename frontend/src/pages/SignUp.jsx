import { useState } from "react";
import { useAuth } from "../auth/AuthContext.jsx";
import { validateEmail } from "../services/auth.js";

export default function SignUp() {
  const [form, setForm] = useState({ name: "", email: "", password: "", confirmPassword: "" });
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { signup } = useAuth();

  function update(field, value) {
    setError("");
    setMessage("");
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event) {
    event.preventDefault();

    if (!form.name.trim()) {
      setError("Name is required.");
      return;
    }
    if (!validateEmail(form.email)) {
      setError("Enter a valid email address.");
      return;
    }
    if (form.password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const data = await signup(form.email.trim(), form.password, { name: form.name.trim() });
      if (data.session) {
        window.location.replace("/dashboard");
      } else {
        setMessage("Check your email to confirm your account before logging in.");
      }
    } catch (err) {
      setError(err.message || "Unable to create account.");
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
            <span className="auth-status-badge">OPERATOR ONBOARDING</span>
          </div>
          <h1 className="auth-welcome-title">Create Console Account</h1>
          <p className="auth-welcome-desc">
            Register your meteorological operator profile for authorized access to the national AWS network.
          </p>

          <form onSubmit={submit} noValidate className="auth-form-cluster">
            <label className="auth-field">
              <span className="field-label">Full Name</span>
              <input
                type="text"
                value={form.name}
                onChange={(event) => update("name", event.target.value)}
                autoComplete="name"
                placeholder="Dr. Rajesh Sharma"
                required
              />
            </label>

            <label className="auth-field">
              <span className="field-label">Official Email</span>
              <input
                type="email"
                value={form.email}
                onChange={(event) => update("email", event.target.value)}
                autoComplete="email"
                placeholder="operator@imd.gov.in"
                required
              />
            </label>

            <label className="auth-field">
              <span className="field-label">Password</span>
              <input
                type="password"
                value={form.password}
                onChange={(event) => update("password", event.target.value)}
                autoComplete="new-password"
                placeholder="Minimum 8 characters"
                required
              />
            </label>

            <label className="auth-field">
              <span className="field-label">Confirm Password</span>
              <input
                type="password"
                value={form.confirmPassword}
                onChange={(event) => update("confirmPassword", event.target.value)}
                autoComplete="new-password"
                placeholder="Re-enter password"
                required
              />
            </label>

            {error ? <div className="auth-error-alert">{error}</div> : null}
            {message ? <div className="auth-success-alert">{message}</div> : null}

            <button className="auth-submit-btn" type="submit" disabled={submitting}>
              {submitting ? "Enrolling Operator..." : "Complete Registration →"}
            </button>
          </form>

          <div className="auth-footer-help">
            <p className="auth-switch-link">Already have an operator account? <a href="/login">Login</a></p>
          </div>
        </div>
      </div>
    </main>
  );
}
