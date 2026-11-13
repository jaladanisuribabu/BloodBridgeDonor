"use client";

import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { DonorImportRow, parseDonorCsv } from "@/lib/donor-csv";

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
  address: string | null;
  latitude: number | null;
  longitude: number | null;
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
type DonorNetwork = {
  total: number;
  callable: number;
  groups: { bloodGroup: BloodGroup; count: number }[];
};

const demoMembers = Array.from({ length: 150 }, (_, index) => ({
  id: index + 1,
  name: `Demo Member ${String(index + 1).padStart(3, "0")}`,
  bloodGroup: bloodGroups[(index * 5 + Math.floor(index / 8)) % bloodGroups.length],
}));

const demoGroupCounts = bloodGroups.map((group) => ({
  bloodGroup: group,
  count: demoMembers.filter((member) => member.bloodGroup === group).length,
}));

async function responseError(response: Response, fallback: string): Promise<string> {
  const data = (await response.json().catch(() => null)) as
    | { error?: unknown }
    | null;
  if (typeof data?.error === "string") return data.error;
  return response.status >= 500
    ? `${fallback} The server could not complete the request. Please try again later.`
    : fallback;
}

function requestError(error: unknown, fallback: string): string {
  if (error instanceof TypeError && /fetch/i.test(error.message)) {
    return "Could not connect to BloodBridge. Check your internet connection or make sure the local server is running.";
  }
  return error instanceof Error ? error.message : fallback;
}

export default function Dashboard() {
  const [hospital, setHospital] = useState<Hospital | null>(null);
  const [requests, setRequests] = useState<EmergencyRequest[]>([]);
  const [forecasts, setForecasts] = useState<Forecast[]>([]);
  const [donorNetwork, setDonorNetwork] = useState<DonorNetwork | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [registrationMode, setRegistrationMode] = useState(false);
  const [hospitalName, setHospitalName] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [hospitalAddress, setHospitalAddress] = useState("");
  const [hospitalLatitude, setHospitalLatitude] = useState("");
  const [hospitalLongitude, setHospitalLongitude] = useState("");
  const [googleStatus, setGoogleStatus] = useState<
    "checking" | "ready" | "not_configured" | "unavailable"
  >("checking");
  const [isLocalApp, setIsLocalApp] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState<"password" | "email" | null>(
    null,
  );
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const [recoveryError, setRecoveryError] = useState(false);
  const [bloodGroup, setBloodGroup] = useState<BloodGroup>("O_NEGATIVE");
  const [unitsRequired, setUnitsRequired] = useState(1);
  const [donorImportRows, setDonorImportRows] = useState<DonorImportRow[]>([]);
  const [donorImportFilename, setDonorImportFilename] = useState("");
  const [donorImportConsent, setDonorImportConsent] = useState(false);
  const [donorImportBusy, setDonorImportBusy] = useState(false);
  const [donorImportMessage, setDonorImportMessage] = useState("");
  const [donorImportError, setDonorImportError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    const [requestResponse, inventoryResponse, membersResponse] = await Promise.all([
      fetch("/api/hospital/requests", { cache: "no-store" }),
      fetch("/api/hospital/inventory", { cache: "no-store" }),
      fetch("/api/hospital/members", { cache: "no-store" }),
    ]);
    if (requestResponse.status === 401) {
      setHospital(null);
      return;
    }
    if (!requestResponse.ok || !inventoryResponse.ok || !membersResponse.ok) {
      throw new Error("Unable to refresh hospital data.");
    }
    const requestData = (await requestResponse.json()) as {
      requests: EmergencyRequest[];
    };
    const inventoryData = (await inventoryResponse.json()) as {
      forecasts: Forecast[];
    };
    const membersData = (await membersResponse.json()) as DonorNetwork;
    setRequests(requestData.requests);
    setForecasts(inventoryData.forecasts);
    setDonorNetwork(membersData);
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
    setIsLocalApp(
      window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1",
    );
    const error = new URLSearchParams(window.location.search).get("google_error");
    const messages: Record<string, string> = {
      not_configured: "Google sign-in is not configured yet. Use your hospital email and password.",
      account: "No hospital account is registered with that Google email. Use the account email registered by your hospital.",
      failed: "Google sign-in could not be completed. Please try again or use your hospital password.",
    };
    if (error && messages[error]) {
      setMessage(messages[error]);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/hospital/google/status", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not check Google sign-in configuration.");
        const data = (await response.json()) as { configured: boolean };
        if (active) setGoogleStatus(data.configured ? "ready" : "not_configured");
      })
      .catch(() => {
        if (active) setGoogleStatus("unavailable");
      });
    return () => {
      active = false;
    };
  }, []);

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
        throw new Error(await responseError(response, "Sign-in failed."));
      }
      const session = await fetch("/api/hospital/me", { cache: "no-store" });
      if (!session.ok) {
        throw new Error(await responseError(session, "Could not start your hospital session."));
      }
      const data = (await session.json()) as { hospital: Hospital };
      setHospital(data.hospital);
      setPassword("");
      await refresh();
    } catch (error) {
      setMessage(requestError(error, "Sign-in failed."));
    } finally {
      setBusy(false);
    }
  }

  async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirmPassword) {
      setMessage("Passwords do not match.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/hospital/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, hospitalName, password, confirmPassword }),
      });
      if (!response.ok) {
        throw new Error(await responseError(response, "Registration failed."));
      }
      const session = await fetch("/api/hospital/me", { cache: "no-store" });
      if (!session.ok) {
        throw new Error("Account was created, but sign-in could not be completed.");
      }
      const sessionData = (await session.json()) as { hospital: Hospital };
      setHospital(sessionData.hospital);
      setPassword("");
      setConfirmPassword("");
      await refresh();
    } catch (error) {
      setMessage(requestError(error, "Registration failed."));
    } finally {
      setBusy(false);
    }
  }

  async function saveHospitalLocation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/hospital/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: hospitalAddress,
          latitude: Number(hospitalLatitude),
          longitude: Number(hospitalLongitude),
        }),
      });
      const data = (await response.json()) as { hospital?: Hospital; error?: string };
      if (!response.ok || !data.hospital) {
        throw new Error(data.error ?? "Could not save hospital location.");
      }
      setHospital(data.hospital);
      setMessage("Hospital location saved. Donor matching is ready.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save hospital location.");
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

  async function selectDonorCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setDonorImportError(false);
    setDonorImportMessage("");
    setDonorImportRows([]);
    setDonorImportFilename("");
    if (!file) return;
    try {
      const rows = parseDonorCsv(await file.text());
      setDonorImportRows(rows);
      setDonorImportFilename(file.name);
      setDonorImportMessage(`${rows.length} donor records are ready to review.`);
    } catch (error) {
      setDonorImportError(true);
      setDonorImportMessage(requestError(error, "Could not read this CSV file."));
    }
  }

  async function importDonors(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!donorImportConsent || donorImportRows.length === 0) return;
    setDonorImportBusy(true);
    setDonorImportError(false);
    setDonorImportMessage("");
    try {
      const response = await fetch("/api/hospital/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          consentConfirmed: true,
          donors: donorImportRows,
        }),
      });
      if (!response.ok) {
        throw new Error(await responseError(response, "Donor import failed."));
      }
      const result = (await response.json()) as {
        imported: number;
        activationTokens: { name: string; phone: string; token: string }[];
      };
      downloadCsv(
        "bloodbridge-donor-activation-tokens.csv",
        [
          ["Name", "Phone", "LocationToken"],
          ...result.activationTokens.map((donor) => [
            donor.name,
            donor.phone,
            donor.token,
          ]),
        ],
      );
      setDonorImportRows([]);
      setDonorImportFilename("");
      setDonorImportConsent(false);
      setDonorImportMessage(
        `${result.imported} donors imported. A one-time activation-token file was downloaded; deliver each token securely to its donor.`,
      );
      try {
        await refresh();
      } catch (error) {
        setDonorImportError(true);
        setDonorImportMessage(
          `${result.imported} donors were imported and the activation-token file was downloaded, but the dashboard could not refresh: ${requestError(error, "refresh failed.")}`,
        );
      }
    } catch (error) {
      setDonorImportError(true);
      setDonorImportMessage(requestError(error, "Donor import failed."));
    } finally {
      setDonorImportBusy(false);
    }
  }

  function downloadDonorTemplate() {
    downloadCsv("bloodbridge-donor-import-template.csv", [
      ["Name", "Phone", "BloodGroup", "Latitude", "Longitude"],
    ]);
  }

  async function signOut() {
    await fetch("/api/hospital/logout", { method: "POST" });
    setHospital(null);
    setRequests([]);
    setForecasts([]);
    setDonorNetwork(null);
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
          <div className="auth-switch" role="tablist" aria-label="Hospital account">
            <button
              type="button"
              role="tab"
              aria-selected={!registrationMode}
              onClick={() => { setRegistrationMode(false); setMessage(""); }}
            >
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={registrationMode}
              onClick={() => { setRegistrationMode(true); setMessage(""); }}
            >
              Register
            </button>
          </div>
          <form onSubmit={registrationMode ? register : signIn} className="stack-form">
            {registrationMode && (
              <label>
                Hospital name
                <input
                  type="text"
                  autoComplete="organization"
                  minLength={2}
                  maxLength={160}
                  required
                  value={hospitalName}
                  onChange={(event) => setHospitalName(event.target.value)}
                />
              </label>
            )}
            <label>
              Hospital email
              <input
                type="email"
                autoComplete={registrationMode ? "email" : "username"}
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label>
              Password
              <span className="password-input">
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete={registrationMode ? "new-password" : "current-password"}
                  minLength={registrationMode ? 12 : undefined}
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button
                  type="button"
                  className="password-toggle"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((visible) => !visible)}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </span>
            </label>
            {registrationMode && (
              <label>
                Confirm password
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  minLength={12}
                  required
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                />
              </label>
            )}
            {message && <p className="notice error" role="alert">{message}</p>}
            <button disabled={busy} className="button primary">
              {busy
                ? registrationMode ? "Creating account..." : "Signing in..."
                : registrationMode ? "Create hospital account" : "Sign in"}
            </button>
          </form>
          {!registrationMode && <>
          <div className="login-divider"><span>or</span></div>
          <button
            type="button"
            className="google-sign-in"
            disabled={googleStatus !== "ready"}
            onClick={() => window.location.assign("/api/hospital/google/start")}
          >
            <svg aria-hidden="true" viewBox="0 0 48 48">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z" transform="translate(0 5)" />
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94a11.05 11.05 0 0 1-4.8 7.24l7.75 6C44.4 38.02 46.98 31.9 46.98 24.55Z" />
              <path fill="#FBBC05" d="M10.53 28.59a14.4 14.4 0 0 1 0-9.18l-7.98-6.19a23.9 23.9 0 0 0 0 21.56l7.98-6.19Z" transform="translate(0 5)" />
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.9-5.8l-7.75-6c-2.15 1.45-4.9 2.3-8.15 2.3-6.26 0-11.57-4.22-13.46-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z" transform="translate(0 -5)" />
            </svg>
            {googleStatus === "checking"
              ? "Checking Google sign-in..."
              : googleStatus === "ready"
                ? "Continue with Google"
                : googleStatus === "not_configured" && isLocalApp
                  ? "Google sign-in not configured locally"
                  : "Google sign-in unavailable"}
          </button>
          <p className="google-note">
            {googleStatus === "not_configured"
              ? isLocalApp
                ? "Google sign-in is configured on the deployed site, but this local app has no OAuth credentials. Use the production site or configure local OAuth credentials and the localhost callback URI."
                : "Google sign-in must be configured by the administrator. Use your hospital email and password for now."
              : googleStatus === "unavailable"
                ? "Google sign-in status could not be checked. Refresh the page or use your hospital email and password."
                : "Use the verified Google account matching your hospital account email."}
          </p>
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
          </>}
          <p className="fine-print">Hospital accounts only. Donor tracking is never shown to public users.</p>
        </section>
      </main>
    );
  }

  const hospitalLocation =
    hospital.latitude !== null && hospital.longitude !== null
      ? { latitude: hospital.latitude, longitude: hospital.longitude }
      : null;

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/hospital">
          <span className="brand-mark small">B</span> BloodBridge
        </a>
        <div className="topbar-label">Hospital coordination center</div>
        <div className="account">
          <div>
            <strong>{hospital.name}</strong>
            <span>{hospital.email}</span>
          </div>
          <button className="button subtle" onClick={signOut}>Sign out</button>
        </div>
      </header>

      <div className="dashboard-layout">
        <aside className="dashboard-sidebar" aria-label="Dashboard sections">
          <p className="sidebar-label">WORKSPACE</p>
          <nav>
            <a href="#overview"><span>◫</span> Overview</a>
            <a href="#emergency"><span>✚</span> Emergency dispatch</a>
            <a href="#tracking"><span>⌖</span> Donor tracking</a>
            <a href="#inventory"><span>▤</span> Blood inventory</a>
            <a href="#members"><span>♧</span> Donor network</a>
            <a href="#requests"><span>◷</span> Recent requests</a>
          </nav>
          <div className="sidebar-help">
            <span className="sidebar-status-dot" />
            <strong>Protected workspace</strong>
            <small>Only your hospital team can view this dashboard.</small>
          </div>
        </aside>

      <div className="page-content">
        <section className="welcome-row" id="overview">
          <div>
            <p className="eyebrow">HOSPITAL OPERATIONS · OVERVIEW</p>
            <h1>Good day, {hospital.name}</h1>
            <p className="muted">Your emergency coordination workspace at a glance.</p>
          </div>
          <div className="overview-actions">
            <div className="live-indicator"><span /> Live updates · every 10 sec</div>
            <span className="overview-date">{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</span>
          </div>
        </section>
        <section className="metric-grid" aria-label="Hospital overview metrics">
          <article className="metric-card">
            <div className="metric-icon rose">♧</div>
            <span className="metric-label">Donor network</span>
            <strong>{donorNetwork?.total ?? "—"}</strong>
            <small>registered members</small>
          </article>
          <article className="metric-card">
            <div className="metric-icon green">✓</div>
            <span className="metric-label">Eligible donors</span>
            <strong>{donorNetwork?.callable ?? "—"}</strong>
            <small>consented · location enabled</small>
          </article>
          <article className="metric-card">
            <div className="metric-icon amber">✚</div>
            <span className="metric-label">Open emergencies</span>
            <strong>{activeRequests.length}</strong>
            <small>currently seeking donors</small>
          </article>
          <article className="metric-card">
            <div className="metric-icon blue">⌖</div>
            <span className="metric-label">Donors en route</span>
            <strong>{trackedDonors.length}</strong>
            <small>sharing live location</small>
          </article>
        </section>
        {message && <p className="notice">{message}</p>}
        {(!hospitalLocation || !hospital.address) && (
          <section className="panel location-setup">
            <div className="section-heading">
              <div><p className="eyebrow">REQUIRED FOR MATCHING</p><h2>Set your hospital location</h2></div>
            </div>
            <p className="muted">
              Add your address and coordinates to search within 5 km and calculate donor ETAs.
              Use the coordinates for your hospital entrance or emergency department.
            </p>
            <form className="stack-form location-form" onSubmit={saveHospitalLocation}>
              <label>
                Hospital address
                <input
                  required
                  maxLength={300}
                  value={hospitalAddress}
                  onChange={(event) => setHospitalAddress(event.target.value)}
                />
              </label>
              <div className="location-coordinate-fields">
                <label>
                  Latitude
                  <input
                    required
                    type="number"
                    step="any"
                    min="-90"
                    max="90"
                    value={hospitalLatitude}
                    onChange={(event) => setHospitalLatitude(event.target.value)}
                  />
                </label>
                <label>
                  Longitude
                  <input
                    required
                    type="number"
                    step="any"
                    min="-180"
                    max="180"
                    value={hospitalLongitude}
                    onChange={(event) => setHospitalLongitude(event.target.value)}
                  />
                </label>
              </div>
              <button disabled={busy} className="button primary">
                {busy ? "Saving..." : "Save hospital location"}
              </button>
            </form>
          </section>
        )}

        <section className="dashboard-grid" id="emergency">
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
              <button
                disabled={busy || !hospitalLocation || !hospital.address}
                className="button primary"
              >
                {busy ? "Submitting..." : "Find nearby donors"}
              </button>
            </form>
            <p className="helper-text">Eligible, consenting donors are called in groups of up to five within 5 km.</p>
          </article>

          <article className="panel dispatch-guide">
            <p className="eyebrow">AUTOMATED DISPATCH</p>
            <h2>Smart donor call queue</h2>
            <p className="muted">The system contacts eligible, consenting donors near your hospital and keeps the response queue moving.</p>
            <div className="dispatch-rule"><span>01</span><div><strong>5 km radius</strong><small>Exact blood-group match near this hospital</small></div></div>
            <div className="dispatch-rule"><span>02</span><div><strong>Up to 5 calls at once</strong><small>Rollover continues until units are confirmed</small></div></div>
            <a href="#requests" className="text-link">View recent requests <span>→</span></a>
          </article>
        </section>

        <section className="panel" id="tracking">
          <div className="section-heading">
            <div><p className="eyebrow">ARRIVAL MONITOR</p><h2>Live donor tracking</h2></div>
            <span className="live-indicator"><span /> Restricted hospital view</span>
          </div>
          {!hospitalLocation ? (
            <div className="empty-state">
              <strong>Hospital location required</strong>
              <span>Set your location above to view donor positions and ETAs.</span>
            </div>
          ) : trackedDonors.length ? (
            <div className="tracking-grid">
              <div className="map-card" aria-label="Illustrative map of hospital and donor locations">
                <div className="map-grid" />
                <div className="radius-ring" />
                <div className="hospital-pin" style={mapPosition(hospitalLocation.latitude, hospitalLocation.longitude, hospitalLocation.latitude, hospitalLocation.longitude)}>H</div>
                {trackedDonors.map((item, index) => (
                  <div
                    key={`${item.request.id}-${item.id}`}
                    className="donor-pin"
                    style={mapPosition(item.location!.latitude, item.location!.longitude, hospitalLocation.latitude, hospitalLocation.longitude, index)}
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

        <section className="panel" id="inventory">
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

        <section className="panel donor-network-panel" id="members">
          <div className="section-heading">
            <div><p className="eyebrow">MEMBER MANAGEMENT</p><h2>Donor network</h2></div>
            <span className="demo-badge">Demo preview is separate from real donors</span>
          </div>
          <div className="member-network-grid">
            <article className="network-summary">
              <span className="metric-label">Real network members</span>
              <strong className="network-total">{donorNetwork?.total ?? "—"}</strong>
              <p>Actual donor records in the shared network. Fictional preview profiles are not included.</p>
              <div className="member-callable">
                <span className="sidebar-status-dot" />
                <strong>{donorNetwork?.callable ?? "—"} consented and location-enabled</strong>
              </div>
              <div className="blood-group-summary">
                {(donorNetwork?.groups ?? []).map((group) => (
                  <div key={group.bloodGroup}>
                    <span>{formatGroup(group.bloodGroup)}</span>
                    <strong>{group.count}</strong>
                  </div>
                ))}
                {!donorNetwork?.groups.length && <span className="muted">No real donor profiles imported yet.</span>}
              </div>
            </article>

            <article className="import-card">
              <div className="import-card-heading">
                <div className="metric-icon blue">↑</div>
                <div><strong>Import real donor members</strong><small>Secure CSV · up to 150 records at a time</small></div>
              </div>
              <button type="button" className="button subtle template-button" onClick={downloadDonorTemplate}>
                Download CSV template
              </button>
              <form className="donor-import-form" onSubmit={(event) => void importDonors(event)}>
                <label className="file-picker">
                  <span>{donorImportFilename || "Choose donor CSV file"}</span>
                  <input type="file" accept=".csv,text/csv" onChange={(event) => void selectDonorCsv(event)} />
                </label>
                {donorImportRows.length > 0 && (
                  <p className="import-preview">{donorImportRows.length} records ready. Review the file before importing.</p>
                )}
                <label className="consent-confirmation">
                  <input
                    type="checkbox"
                    checked={donorImportConsent}
                    onChange={(event) => setDonorImportConsent(event.target.checked)}
                  />
                  <span>I confirm every donor in this file has explicitly agreed to be contacted and share the listed location for emergency matching.</span>
                </label>
                {donorImportMessage && (
                  <p className={`notice${donorImportError ? " error" : ""}`} role="status">{donorImportMessage}</p>
                )}
                <button
                  type="submit"
                  className="button primary"
                  disabled={donorImportBusy || !donorImportRows.length || !donorImportConsent}
                >
                  {donorImportBusy ? "Importing members..." : "Import consented donors"}
                </button>
              </form>
              <p className="import-safety-note">Activation tokens are downloaded once after import. Keep the token file private and deliver each donor’s token through a secure channel. Demo profiles are never imported or called.</p>
            </article>
          </div>

          <article className="demo-preview">
            <div className="demo-preview-header">
              <div>
                <span className="demo-badge">FICTIONAL DEMO DATA</span>
                <h3>150-member dashboard preview</h3>
                <p>Sample display data only. These names and blood groups are generated examples, not real people or available donors.</p>
              </div>
              <strong className="demo-count">150 <small>sample profiles</small></strong>
            </div>
            <div className="demo-content">
              <div className="demo-group-bars">
                {demoGroupCounts.map((group) => (
                  <div className="demo-group-row" key={group.bloodGroup}>
                    <span>{formatGroup(group.bloodGroup)}</span>
                    <div className="demo-bar"><i style={{ width: `${(group.count / 150) * 100}%` }} /></div>
                    <strong>{group.count}</strong>
                  </div>
                ))}
              </div>
              <div className="demo-member-list">
                {demoMembers.slice(0, 6).map((member) => (
                  <div className="demo-member-row" key={member.id}>
                    <span className="demo-avatar">{String(member.id).padStart(2, "0")}</span>
                    <span><strong>{member.name}</strong><small>Fictional sample profile</small></span>
                    <b>{formatGroup(member.bloodGroup)}</b>
                  </div>
                ))}
                <span className="demo-list-footer">Showing 6 of 150 fictional sample profiles</span>
              </div>
            </div>
          </article>
        </section>

        <section className="panel" id="requests">
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
  hospitalLatitude: number,
  hospitalLongitude: number,
  index = -1,
) {
  const latOffsetKm = (latitude - hospitalLatitude) * 110.574;
  const lonOffsetKm =
    (longitude - hospitalLongitude) *
    111.32 *
    Math.cos((hospitalLatitude * Math.PI) / 180);
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

function downloadCsv(filename: string, rows: string[][]) {
  const contents = rows
    .map((row) =>
      row
        .map((value) => `"${value.replaceAll('"', '""')}"`)
        .join(","),
    )
    .join("\r\n");
  const url = URL.createObjectURL(
    new Blob([contents], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
