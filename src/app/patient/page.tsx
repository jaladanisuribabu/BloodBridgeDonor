"use client";

import { FormEvent, useEffect, useState } from "react";

const groups = [
  "O_NEGATIVE",
  "O_POSITIVE",
  "A_NEGATIVE",
  "A_POSITIVE",
  "B_NEGATIVE",
  "B_POSITIVE",
  "AB_NEGATIVE",
  "AB_POSITIVE",
] as const;

type Patient = { name: string; email: string; city: string };
type Availability = { bloodGroup: (typeof groups)[number]; unitsAvailable: number };

function prettyGroup(group: string) {
  return group.replace("_NEGATIVE", "−").replace("_POSITIVE", "+");
}

export default function PatientPage() {
  const [patient, setPatient] = useState<Patient | null>(null);
  const [registerMode, setRegisterMode] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [city, setCity] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [searchCity, setSearchCity] = useState("");
  const [bloodGroup, setBloodGroup] = useState("");
  const [availability, setAvailability] = useState<Availability[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/patient/me", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        const data = (await response.json()) as { patient: Patient };
        if (!active) return;
        setPatient(data.patient);
        setCity(data.patient.city);
        setSearchCity(data.patient.city);
      })
      .catch(() => {
        if (active) {
          setError(true);
          setMessage("Unable to connect to the patient service.");
        }
      });
    return () => { active = false; };
  }, []);

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(false);
    setMessage("");
    if (registerMode && password !== confirmPassword) {
      setError(true);
      setMessage("Passwords do not match.");
      setBusy(false);
      return;
    }
    try {
      const response = await fetch(`/api/patient/${registerMode ? "register" : "login"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(registerMode
          ? { name, email, city, password, confirmPassword }
          : { email, password }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not sign in.");
      const session = await fetch("/api/patient/me", { cache: "no-store" });
      if (!session.ok) throw new Error("Your account is ready, but sign-in could not be completed.");
      const sessionData = (await session.json()) as { patient: Patient };
      setPatient(sessionData.patient);
      setSearchCity(sessionData.patient.city);
      setPassword("");
      setConfirmPassword("");
    } catch (reason) {
      setError(true);
      setMessage(reason instanceof Error ? reason.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }

  async function searchInventory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(false);
    setMessage("");
    try {
      const params = new URLSearchParams({ city: searchCity });
      if (bloodGroup) params.set("bloodGroup", bloodGroup);
      const response = await fetch(`/api/patient/inventory?${params}`, { cache: "no-store" });
      const data = (await response.json()) as {
        error?: string;
        availability?: Availability[];
      };
      if (!response.ok) throw new Error(data.error ?? "Availability search failed.");
      setAvailability(data.availability ?? []);
      if (!data.availability?.length) setMessage("No units are currently reported for this search area.");
    } catch (reason) {
      setError(true);
      setMessage(reason instanceof Error ? reason.message : "Availability search failed.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await fetch("/api/patient/logout", { method: "POST" });
    setPatient(null);
    setAvailability([]);
  }

  if (!patient) {
    return (
      <main className="login-shell">
        <section className="login-card">
          <a className="patient-back-link" href="/hospital">← Hospital sign in</a>
          <div className="brand-mark">B</div>
          <p className="eyebrow">PATIENT PORTAL</p>
          <h1>Blood availability</h1>
          <p className="muted">Create a patient account or sign in to check reported blood-unit totals in your area.</p>
          <div className="auth-switch" role="tablist" aria-label="Patient account">
            <button type="button" role="tab" aria-selected={!registerMode} onClick={() => { setRegisterMode(false); setMessage(""); }}>Sign in</button>
            <button type="button" role="tab" aria-selected={registerMode} onClick={() => { setRegisterMode(true); setMessage(""); }}>Register</button>
          </div>
          <form className="stack-form" onSubmit={(event) => void submitAuth(event)}>
            {registerMode && <>
              <label>Full name<input required minLength={2} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" /></label>
              <label>City or area<input required minLength={2} maxLength={120} value={city} onChange={(event) => setCity(event.target.value)} autoComplete="address-level2" /></label>
            </>}
            <label>Email<input type="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" /></label>
            <label>Password<input type="password" required minLength={registerMode ? 12 : 1} maxLength={200} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={registerMode ? "new-password" : "current-password"} /></label>
            {registerMode && <label>Confirm password<input type="password" required minLength={12} maxLength={200} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" /></label>}
            {message && <p className={`notice${error ? " error" : ""}`} role="status">{message}</p>}
            <button className="button primary" disabled={busy}>{busy ? "Please wait..." : registerMode ? "Create patient account" : "Sign in as patient"}</button>
          </form>
          <p className="fine-print">Patient accounts can see aggregate unit counts by city only. Donor identities, hospital names, patient records, contact details, and live locations are never shown.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="patient-shell">
      <header className="topbar patient-topbar">
        <a className="brand" href="/patient"><span className="brand-mark small">B</span> BloodBridge</a>
        <div className="account"><div><strong>{patient.name}</strong><span>Patient portal</span></div><button className="button subtle" onClick={() => void signOut()}>Sign out</button></div>
      </header>
      <section className="patient-content">
        <p className="eyebrow">LOCAL BLOOD AVAILABILITY</p>
        <h1>Check reported units</h1>
        <p className="muted">Search aggregated stock totals in a city. Results do not identify hospitals or donors. Contact your care team to confirm availability before traveling.</p>
        <form className="patient-search panel" onSubmit={(event) => void searchInventory(event)}>
          <label>City or area<input required minLength={2} maxLength={120} value={searchCity} onChange={(event) => setSearchCity(event.target.value)} /></label>
          <label>Blood group<select value={bloodGroup} onChange={(event) => setBloodGroup(event.target.value)}><option value="">All blood groups</option>{groups.map((group) => <option key={group} value={group}>{prettyGroup(group)}</option>)}</select></label>
          <button className="button primary" disabled={busy}>{busy ? "Searching..." : "Search availability"}</button>
        </form>
        {message && <p className={`notice${error ? " error" : ""}`} role="status">{message}</p>}
        {availability.length > 0 && <section className="patient-results panel">
          <div className="section-heading"><div><p className="eyebrow">AGGREGATED STOCK</p><h2>{searchCity}</h2></div><span className="demo-badge">Hospital locations hidden</span></div>
          <div className="availability-grid">{availability.map((item) => <article key={item.bloodGroup}><span>{prettyGroup(item.bloodGroup)}</span><strong>{item.unitsAvailable}</strong><small>units reported</small></article>)}</div>
          <p className="fine-print">Availability is reported by participating hospitals and may change. It is not a reservation or clinical confirmation.</p>
        </section>}
      </section>
    </main>
  );
}
