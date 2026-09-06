import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext.jsx";
import Header from "../components/Header.jsx";
import { validateEmail } from "../services/auth.js";

export default function Login() {
  const [form, setForm] = useState({ email: "", password: "" });
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
    <main className="screen auth-screen">
      <Header subtitle="Secure Network Access" liveText="AUTH READY" />
      <section className="auth-card">
        <span>SAHASRAKSHA</span>
        <h1>Welcome Back</h1>
        <p>Sign in to continue to the SAHASRAKSHA station network.</p>
        <form onSubmit={submit} noValidate>
          <label className="field">
            <small>Email</small>
            <input
              value={form.email}
              onChange={(event) => update("email", event.target.value)}
              autoComplete="username"
              placeholder="operator@imd.gov.in"
            />
          </label>
          <label className="field">
            <small>Password</small>
            <input
              value={form.password}
              onChange={(event) => update("password", event.target.value)}
              autoComplete="current-password"
              type="password"
              placeholder="Enter password"
            />
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          <button className="primary-action" type="submit" disabled={submitting}>
            {submitting ? "Logging in..." : "Login"}
          </button>
        </form>
        <p className="auth-switch">New to SAHASRAKSHA? <a href="/signup">Sign Up</a></p>
      </section>
    </main>
  );
}
