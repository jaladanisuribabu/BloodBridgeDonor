"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

const bloodGroups = [
  "O_NEGATIVE",
  "O_POSITIVE",
  "A_NEGATIVE",
  "A_POSITIVE",
  "B_NEGATIVE",
  "B_POSITIVE",
  "AB_NEGATIVE",
  "AB_POSITIVE",
] as const;

type BloodGroup = (typeof bloodGroups)[number];
type Hospital = {
  id: string;
  name: string;
  email: string;
  latitude: number;
  longitude: number;
};
type Donor = {
  id: string;
  name: string;
  bloodGroup: BloodGroup;
  status: string;
  location: {
    latitude: number;
    longitude: number;
    recordedAt: string;
    accuracyMeters: number | null;
    etaMinutes: number;
  } | null;
};
type EmergencyRequest = {
  id: string;
  bloodGroup: BloodGroup;
  unitsRequired: number;
  unitsConfirmed: number;
  state: string;
  createdAt: string;
  donors: Donor[];
};
type Forecast = {
  bloodGroup: BloodGroup;
  unitsAvailable: number;
  historicalUnits90Days: number;
  projectedSevenDayDemand: number;
  projectedShortage: number;
  confidence: "low" | "moderate";
};

export default function Dashboard() {
  const [hospital, setHospital] = useState<Hospital | null>(null);
  const [requests, setRequests] = useState<EmergencyRequest[]>([]);
  const [forecasts, setForecasts] = useState<Forecast[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [recoveryMode, setRecoveryMode] = useState<"password" | "email" | null>(
    null,
  );
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const [recoveryError, setRecoveryError] = useState(false);
  const [bloodGroup, setBloodGroup] = useState<BloodGroup>("O_NEGATIVE");
  const [unitsRequired, setUnitsRequired] = useState(1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    const [requestResponse, inventoryResponse] = await Promise.all([
      fetch("/api/hospital/requests", { cache: "no-store" }),
      fetch("/api/hospital/inventory", { cache: "no-store" }),
    ]);
    if (requestResponse.status === 401) {
      setHospital(null);
      return;
    }
    if (!requestResponse.ok || !inventoryResponse.ok) {
      throw new Error("Unable to refresh hospital data.");
    }
    const requestData = (await requestResponse.json()) as {
      requests: EmergencyRequest[];
    };
    const inventoryData = (await inventoryResponse.json()) as {
      forecasts: Forecast[];
    };
    setRequests(requestData.requests);
    setForecasts(inventoryData.forecasts);
  }, []);

  useEffect(() => {
    let active = true;
    async function loadSession() {
      try {
        const response = await fetch("/api/hospital/me", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as { hospital: Hospital };
        if (active) {
          setHospital(data.hospital);
          await refresh();
        }
      } catch {
        if (active) setMessage("Unable to connect to the hospital service.");
      }
    }
    void loadSession();
    return () => {
      active = false;
    };
  }, [refresh]);

  useEffect(() => {
    if (!hospital) return;
    const timer = window.setInterval(() => {
      void refresh().catch(() => setMessage("Live data refresh failed."));
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [hospital, refresh]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/hospital/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? "Sign-in failed.");
      }
      const session = await fetch("/api/hospital/me", { cache: "no-store" });
      const data = (await session.json()) as { hospital: Hospital };
      setHospital(data.hospital);
      setPassword("");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  async function requestPasswordReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setRecoveryError(false);
    setRecoveryMessage("");
    try {
      const response = await fetch("/api/hospital/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: recoveryEmail }),
      });
      const data = (await response.json()) as { message?: string; error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Could not request a password reset.");
      }
      setRecoveryMessage(data.message ?? "If an account exists, reset instructions will be sent.");
    } catch (error) {
      setRecoveryError(true);
      setRecoveryMessage(
        error instanceof Error
          ? error.message
          : "Could not request a password reset.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function createRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/hospital/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bloodGroup, unitsRequired }),
      });
      const data = (await response.json()) as { error?: string; warning?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not create request.");
      setMessage(
        data.warning ??
          "Emergency request saved. Donor calls are being dispatched.",
      );
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create request.");
    } finally {
      setBusy(false);
    }
  }

  async function updateInventory(group: BloodGroup, units: number) {
    setMessage("");
    try {
      const response = await fetch("/api/hospital/inventory", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bloodGroup: group, unitsAvailable: units }),
      });
      if (!response.ok) throw new Error("Could not save inventory.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save inventory.");
    }
  }

  async function signOut() {
    await fetch("/api/hospital/logout", { method: "POST" });
    setHospital(null);
    setRequests([]);
    setForecasts([]);
  }

  const activeRequests = requests.filter((request) => request.state === "OPEN");
  const trackedDonors = useMemo(
    () =>
      requests.flatMap((request) =>
        request.donors
          .filter((donor) => donor.status === "ACCEPTED" && donor.location)
          .map((donor) => ({ ...donor, request })),
      ),
    [requests],
  );

  if (!hospital) {
    return (
      <main className="login-shell">
        <section className="login-card">
          <div className="brand-mark">B</div>
          <p className="eyebrow">HOSPITAL OPERATIONS</p>
          <h1>BloodBridge</h1>
          <p className="muted">Securely coordinate urgent blood donor responses.</p>
          <form onSubmit={signIn} className="stack-form">
            <label>
              Hospital email
              <input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {message && <p className="notice error">{message}</p>}
            <button disabled={busy} className="button primary">
              {busy ? "Signing in..." : "Sign in"}
            </button>
          </form>
          <div className="recovery-links">
            <button
              type="button"
              onClick={() => {
                setRecoveryMode(recoveryMode === "password" ? null : "password");
                setRecoveryEmail(email);
                setRecoveryMessage("");
              }}
            >
              Forgot password?
            </button>
            <button
              type="button"
              onClick={() => {
                setRecoveryMode(recoveryMode === "email" ? null : "email");
                setRecoveryMessage("");
              }}
            >
              Forgot email?
            </button>
          </div>
          {recoveryMode === "password" && (
            <form
              onSubmit={requestPasswordReset}
              className="recovery-panel stack-form"
            >
              <p className="helper-text">
                Enter your hospital account email. If an account exists, we’ll
                send a one-time reset link.
              </p>
              <label>
                Hospital email
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={recoveryEmail}
                  onChange={(event) => setRecoveryEmail(event.target.value)}
                />
              </label>
              {recoveryMessage && (
                <p
                  className={`notice${recoveryError ? " error" : ""}`}
                  role="status"
                >
                  {recoveryMessage}
                </p>
              )}
              <button disabled={busy} className="button primary">
                {busy ? "Sending..." : "Send reset link"}
              </button>
            </form>
          )}
          {recoveryMode === "email" && (
            <div className="recovery-panel" role="status">
              <strong>Can’t remember your hospital email?</strong>
              <p className="helper-text">
                For privacy, BloodBridge can’t look up or display account emails
                here. Contact your hospital’s administrator or IT team through
                its official channel to verify your identity and recover or
                update the account email.
              </p>
            </div>
          )}
          <p className="fine-print">Hospital accounts only. Donor tracking is never shown to public users.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/hospital">
          <span className="brand-mark small">B</span> BloodBridge
        </a>
        <div className="account">
          <div>
            <strong>{hospital.name}</strong>
            <span>{hospital.email}</span>
          </div>
          <button className="button subtle" onClick={signOut}>Sign out</button>
        </div>
      </header>

      <div className="page-content">
        <section className="welcome-row">
          <div>
            <p className="eyebrow">EMERGENCY COORDINATION</p>
            <h1>Hospital dashboard</h1>
            <p className="muted">Manage urgent requests, inventory outlook, and donor arrivals.</p>
          </div>
          <div className="live-indicator"><span /> Live updates · every 10 sec</div>
        </section>
        {message && <p className="notice">{message}</p>}

        <section className="dashboard-grid">
          <article className="panel request-panel">
            <div className="section-heading">
              <div><p className="eyebrow">NEW MATCH</p><h2>Request blood units</h2></div>
              <span className="icon-bubble">+</span>
            </div>
            <form onSubmit={createRequest} className="request-form">
              <label>
                Blood group
                <select
                  value={bloodGroup}
                  onChange={(event) => setBloodGroup(event.target.value as BloodGroup)}
                >
                  {bloodGroups.map((group) => (
                    <option key={group} value={group}>{formatGroup(group)}</option>
                  ))}
                </select>
              </label>
              <label>
                Units needed
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={unitsRequired}
                  onChange={(event) => setUnitsRequired(Number(event.target.value))}
                />
              </label>
              <button disabled={busy} className="button primary">
                {busy ? "Submitting..." : "Find nearby donors"}
              </button>
            </form>
            <p className="helper-text">Eligible, consenting donors are called in groups of up to five within 5 km.</p>
          </article>

          <article className="panel stat-panel">
            <p className="eyebrow">ACTIVE EMERGENCIES</p>
            <div className="stat-number">{activeRequests.length}</div>
            <p className="muted">Requests still seeking confirmed units</p>
            <div className="stat-divider" />
            <p className="eyebrow">DONORS TRACKED</p>
            <div className="stat-number">{trackedDonors.length}</div>
            <p className="muted">Accepted donors sharing their location</p>
          </article>
        </section>

        <section className="panel">
          <div className="section-heading">
            <div><p className="eyebrow">ARRIVAL MONITOR</p><h2>Live donor tracking</h2></div>
            <span className="live-indicator"><span /> Restricted hospital view</span>
          </div>
          {trackedDonors.length ? (
            <div className="tracking-grid">
              <div className="map-card" aria-label="Illustrative map of hospital and donor locations">
                <div className="map-grid" />
                <div className="radius-ring" />
                <div className="hospital-pin" style={mapPosition(hospital.latitude, hospital.longitude, hospital)}>H</div>
                {trackedDonors.map((item, index) => (
                  <div
                    key={`${item.request.id}-${item.id}`}
                    className="donor-pin"
                    style={mapPosition(item.location!.latitude, item.location!.longitude, hospital, index)}
                    title={`${item.name}: ETA ${item.location!.etaMinutes} minutes`}
                  >{index + 1}</div>
                ))}
                <div className="map-legend"><span className="legend-hospital" /> Hospital <span className="legend-donor" /> Donor</div>
              </div>
              <div className="donor-list">
                {trackedDonors.map((item) => (
                  <article className="donor-card" key={`${item.request.id}-${item.id}`}>
                    <div className="donor-avatar">{item.name.slice(0, 1).toUpperCase()}</div>
                    <div className="donor-details">
                      <strong>{item.name}</strong>
                      <span>{formatGroup(item.bloodGroup)} · Request {item.request.id.slice(-6)}</span>
                      <span className="coordinates">
                        {item.location!.latitude.toFixed(5)}, {item.location!.longitude.toFixed(5)}
                        {item.location!.accuracyMeters !== null && ` · ±${Math.round(item.location!.accuracyMeters)} m`}
                      </span>
                      <span>
                        GPS update {new Date(item.location!.recordedAt).toLocaleTimeString()}
                        {Date.now() - new Date(item.location!.recordedAt).getTime() > 60_000
                          ? " · location may be stale"
                          : ""}
                      </span>
                    </div>
                    <div className="eta"><strong>{item.location!.etaMinutes} min</strong><span>estimated ETA</span></div>
                  </article>
                ))}
                <p className="fine-print">ETA is a straight-line estimate at 25 km/h plus 5 minutes; it is not route guidance.</p>
              </div>
            </div>
          ) : (
            <div className="empty-state"><span className="empty-icon">⌖</span><strong>No active donor locations</strong><span>Location appears only after a donor accepts and shares GPS with consent.</span></div>
          )}
        </section>

        <section className="panel">
          <div className="section-heading">
            <div><p className="eyebrow">SHORTAGE OUTLOOK</p><h2>Seven-day blood forecast</h2></div>
            <span className="helper-text">Based on the previous 90 days of requests</span>
          </div>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Blood group</th><th>On hand</th><th>7-day demand</th><th>Projection</th><th>History</th><th>Update stock</th></tr></thead>
              <tbody>
                {forecasts.map((forecast) => (
                  <InventoryRow
                    key={forecast.bloodGroup}
                    forecast={forecast}
                    onSave={updateInventory}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <p className="fine-print">Planning estimate only—not a clinical prediction. Low-confidence estimates have fewer than 10 historical units.</p>
        </section>

        <section className="panel">
          <div className="section-heading"><div><p className="eyebrow">CALL QUEUE</p><h2>Recent emergency requests</h2></div></div>
          {requests.length ? (
            <div className="request-list">
              {requests.map((request) => (
                <article className="request-card" key={request.id}>
                  <div className="blood-badge">{formatGroup(request.bloodGroup)}</div>
                  <div className="request-info">
                    <strong>{request.unitsConfirmed} / {request.unitsRequired} units confirmed</strong>
                    <span>{new Date(request.createdAt).toLocaleString()} · {request.donors.length} donors contacted</span>
                  </div>
                  <span className={`status-pill ${request.state.toLowerCase()}`}>{request.state}</span>
                  <div className="call-states">
                    {request.donors.map((donor) => (
                      <span key={donor.id} title={donor.name}>{donor.name}: {formatStatus(donor.status)}</span>
                    ))}
                    {!request.donors.length && <span>Searching for eligible donors</span>}
                  </div>
                </article>
              ))}
            </div>
          ) : <div className="empty-state compact">No requests yet. Submit an emergency request to start a donor search.</div>}
        </section>
      </div>
      <footer>BloodBridge · Emergency coordination prototype · Protect donor data and use only with donor consent.</footer>
    </main>
  );
}

function InventoryRow({
  forecast,
  onSave,
}: {
  forecast: Forecast;
  onSave: (group: BloodGroup, units: number) => Promise<void>;
}) {
  const [draft, setDraft] = useState(String(forecast.unitsAvailable));
  useEffect(() => setDraft(String(forecast.unitsAvailable)), [forecast.unitsAvailable]);
  return (
    <tr>
      <td><strong>{formatGroup(forecast.bloodGroup)}</strong></td>
      <td>{forecast.unitsAvailable}</td>
      <td>{forecast.projectedSevenDayDemand}</td>
      <td>
        {forecast.projectedShortage > 0
          ? <span className="shortage">{forecast.projectedShortage} short</span>
          : <span className="covered">Covered</span>}
      </td>
      <td><span className={`confidence ${forecast.confidence}`}>{forecast.confidence}</span></td>
      <td>
        <div className="stock-edit">
          <input
            aria-label={`Current ${formatGroup(forecast.bloodGroup)} units`}
            type="number"
            min={0}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button className="button small-button" onClick={() => void onSave(forecast.bloodGroup, Number(draft))}>Save</button>
        </div>
      </td>
    </tr>
  );
}

function mapPosition(
  latitude: number,
  longitude: number,
  hospital: Hospital,
  index = -1,
) {
  const latOffsetKm = (latitude - hospital.latitude) * 110.574;
  const lonOffsetKm =
    (longitude - hospital.longitude) *
    111.32 *
    Math.cos((hospital.latitude * Math.PI) / 180);
  const jitter = index >= 0 ? (index % 2 === 0 ? 2 : -2) : 0;
  return {
    left: `${Math.min(90, Math.max(10, 50 + lonOffsetKm * 7 + jitter))}%`,
    top: `${Math.min(88, Math.max(12, 50 - latOffsetKm * 7 + jitter))}%`,
  };
}

function formatGroup(group: BloodGroup) {
  return group.replace("_NEGATIVE", "−").replace("_POSITIVE", "+");
}

function formatStatus(status: string) {
  return status.replaceAll("_", " ").toLowerCase();
}
