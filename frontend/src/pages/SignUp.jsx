import { useState } from "react";
import { useAuth } from "../auth/AuthContext.jsx";
import Header from "../components/Header.jsx";
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
    <main className="screen auth-screen">
      <Header subtitle="Operator Enrollment" liveText="AUTH READY" />
      <section className="auth-card">
        <span>Sahasraksha Access</span>
        <h1>Create Account</h1>
        <p>Prepare an operator profile for the future authentication provider.</p>
        <form onSubmit={submit} noValidate>
          <label className="field">
            <small>Name</small>
            <input value={form.name} onChange={(event) => update("name", event.target.value)} autoComplete="name" placeholder="Operator name" />
          </label>
          <label className="field">
            <small>Email</small>
            <input value={form.email} onChange={(event) => update("email", event.target.value)} autoComplete="email" placeholder="operator@imd.gov.in" />
          </label>
          <label className="field">
            <small>Password</small>
            <input value={form.password} onChange={(event) => update("password", event.target.value)} autoComplete="new-password" type="password" placeholder="Minimum 8 characters" />
          </label>
          <label className="field">
            <small>Confirm Password</small>
            <input value={form.confirmPassword} onChange={(event) => update("confirmPassword", event.target.value)} autoComplete="new-password" type="password" placeholder="Confirm password" />
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          {message ? <p className="form-success">{message}</p> : null}
          <button className="primary-action" type="submit" disabled={submitting}>
            {submitting ? "Creating account..." : "Sign Up"}
          </button>
        </form>
        <p className="auth-switch">Already have access? <a href="/login">Login</a></p>
      </section>
    </main>
  );
}
