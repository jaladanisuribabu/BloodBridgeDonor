"use client";

import { FormEvent, useState } from "react";

export default function PasswordResetForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(false);
    setMessage("");
    try {
      const response = await fetch("/api/hospital/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = (await response.json()) as { message?: string; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not reset password.");
      setMessage(data.message ?? "Password updated. You can now sign in.");
      setPassword("");
    } catch (submitError) {
      setError(true);
      setMessage(
        submitError instanceof Error
          ? submitError.message
          : "Could not reset password.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="brand-mark">B</div>
        <p className="eyebrow">HOSPITAL OPERATIONS</p>
        <h1>Choose a new password</h1>
        <p className="muted">Use at least 12 characters. Reset links expire after 30 minutes.</p>
        {token ? (
          <form onSubmit={submit} className="stack-form">
            <label>
              New password
              <input
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={200}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {message && (
              <p className={`notice${error ? " error" : ""}`} role="status">
                {message}
              </p>
            )}
            <button disabled={busy} className="button primary">
              {busy ? "Updating..." : "Update password"}
            </button>
          </form>
        ) : (
          <p className="notice error">This reset link is missing. Request a new link from the sign-in page.</p>
        )}
        <p className="fine-print"><a href="/hospital">Return to hospital sign in</a></p>
      </section>
    </main>
  );
}
