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
import BloodCellBackdrop from "@/components/blood-cell-backdrop";

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
  city: string | null;
  phone: string | null;
  donationIntervalMonths: number | null;
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
type InventoryChange = {
  id: string;
  bloodGroup: BloodGroup;
  unitsDelta: number;
  reason: string;
  createdAt: string;
  patientCase: { patientName: string } | null;
};
type DonorNetwork = {
  total: number;
  callable: number;
  groups: { bloodGroup: BloodGroup; count: number }[];
};
type PatientCase = {
  id: string;
  patientName: string;
  patientReference: string | null;
  bloodGroup: BloodGroup;
  unitsRequired: number;
  unitsIssued: number;
  status: string;
  notes: string | null;
  createdAt: string;
};
type DonationRecord = {
  id: string;
  donatedAt: string;
  nextEligibleAt: string | null;
  donor: { name: string; bloodGroup: BloodGroup };
};
type HospitalDonor = {
  id: string;
  name: string;
  bloodGroup: BloodGroup;
  nextEligibleAt: string | null;
};
type DashboardSection =
  | "overview"
  | "emergency"
  | "tracking"
  | "inventory"
  | "members"
  | "requests"
  | "patients"
  | "donations"
  | "settings";

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
  const [inventoryChanges, setInventoryChanges] = useState<InventoryChange[]>([]);
  const [donorNetwork, setDonorNetwork] = useState<DonorNetwork | null>(null);
  const [patientCases, setPatientCases] = useState<PatientCase[]>([]);
  const [hospitalDonors, setHospitalDonors] = useState<HospitalDonor[]>([]);
  const [donationRecords, setDonationRecords] = useState<DonationRecord[]>([]);
  const [activeSection, setActiveSection] = useState<DashboardSection>("overview");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [registrationMode, setRegistrationMode] = useState(false);
  const [hospitalName, setHospitalName] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [hospitalAddress, setHospitalAddress] = useState("");
  const [hospitalCity, setHospitalCity] = useState("");
  const [hospitalLatitude, setHospitalLatitude] = useState("");
  const [hospitalLongitude, setHospitalLongitude] = useState("");
  const [locationError, setLocationError] = useState("");
  const [locationBusy, setLocationBusy] = useState(false);
  const [hospitalPhone, setHospitalPhone] = useState("");
  const [settingsEmail, setSettingsEmail] = useState("");
  const [settingsName, setSettingsName] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [donationIntervalMonths, setDonationIntervalMonths] = useState("");
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
  const [caseName, setCaseName] = useState("");
  const [caseReference, setCaseReference] = useState("");
  const [caseBloodGroup, setCaseBloodGroup] = useState<BloodGroup>("O_NEGATIVE");
  const [caseUnits, setCaseUnits] = useState(1);
  const [caseNotes, setCaseNotes] = useState("");
  const [donationDonorId, setDonationDonorId] = useState("");
  const [donationDateTime, setDonationDateTime] = useState("");
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
      changes: InventoryChange[];
    };
    const membersData = (await membersResponse.json()) as DonorNetwork;
    setRequests(requestData.requests);
    setForecasts(inventoryData.forecasts);
    setInventoryChanges(inventoryData.changes);
    setDonorNetwork(membersData);
  }, []);

  const refreshStaffRecords = useCallback(async (section: DashboardSection) => {
    if (section === "patients") {
      const response = await fetch("/api/hospital/cases", { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load patient case records.");
      const data = (await response.json()) as { cases: PatientCase[] };
      setPatientCases(data.cases);
    }
    if (section === "donations") {
      const response = await fetch("/api/hospital/donations", { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load donor donation records.");
      const data = (await response.json()) as {
        donors: HospitalDonor[];
        donations: DonationRecord[];
      };
      setHospitalDonors(data.donors);
      setDonationRecords(data.donations);
      if (!donationDonorId && data.donors[0]) setDonationDonorId(data.donors[0].id);
    }
  }, [donationDonorId]);

  useEffect(() => {
    if (!hospital || (activeSection !== "patients" && activeSection !== "donations")) return;
    void refreshStaffRecords(activeSection).catch((error: unknown) => {
      setMessage(requestError(error, "Could not load staff records."));
    });
  }, [hospital, activeSection, refreshStaffRecords]);

  useEffect(() => {
    let active = true;
    async function loadSession() {
      try {
        const response = await fetch("/api/hospital/me", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as { hospital: Hospital };
        if (active) {
          setHospital(data.hospital);
          setSettingsName(data.hospital.name);
          setSettingsEmail(data.hospital.email);
          setHospitalAddress(data.hospital.address ?? "");
          setHospitalCity(data.hospital.city ?? "");
          setHospitalLatitude(data.hospital.latitude?.toString() ?? "");
          setHospitalLongitude(data.hospital.longitude?.toString() ?? "");
          setHospitalPhone(data.hospital.phone ?? "");
          setDonationIntervalMonths(
            data.hospital.donationIntervalMonths?.toString() ?? "",
          );
          if (!data.hospital.address || !data.hospital.city) setActiveSection("settings");
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
      setSettingsName(data.hospital.name);
      setSettingsEmail(data.hospital.email);
      setHospitalAddress(data.hospital.address ?? "");
      setHospitalCity(data.hospital.city ?? "");
      setHospitalLatitude(data.hospital.latitude?.toString() ?? "");
      setHospitalLongitude(data.hospital.longitude?.toString() ?? "");
      setHospitalPhone(data.hospital.phone ?? "");
      setDonationIntervalMonths(
        data.hospital.donationIntervalMonths?.toString() ?? "",
      );
      setActiveSection(
        !data.hospital.address || !data.hospital.city ? "settings" : "overview",
      );
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
      setSettingsName(sessionData.hospital.name);
      setSettingsEmail(sessionData.hospital.email);
      setHospitalAddress(sessionData.hospital.address ?? "");
      setHospitalCity(sessionData.hospital.city ?? "");
      setHospitalPhone(sessionData.hospital.phone ?? "");
      setActiveSection("settings");
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
          city: hospitalCity,
          latitude: Number(hospitalLatitude),
          longitude: Number(hospitalLongitude),
        }),
      });
      const data = (await response.json()) as { hospital?: Hospital; error?: string };
      if (!response.ok || !data.hospital) {
        throw new Error(data.error ?? "Could not save hospital location.");
      }
      setHospital(data.hospital);
      setHospitalCity(data.hospital.city ?? "");
      setMessage("Hospital location saved. Donor matching is ready.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save hospital location.");
    } finally {
      setBusy(false);
    }
  }

  function useCurrentHospitalLocation() {
    setLocationError("");
    if (!navigator.geolocation) {
      setLocationError("Location access is not available in this browser.");
      return;
    }
    setLocationBusy(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setHospitalLatitude(position.coords.latitude.toString());
        setHospitalLongitude(position.coords.longitude.toString());
        setLocationBusy(false);
      },
      (error) => {
        setLocationError(
          error.code === error.PERMISSION_DENIED
            ? "Allow location access in your browser settings, then try again."
            : "Could not determine your current location. Check location services and try again.",
        );
        setLocationBusy(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
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

  async function saveHospitalSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/hospital/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: settingsName,
          email: settingsEmail,
          phone: hospitalPhone || null,
          currentPassword,
          newPassword,
          donationIntervalMonths: donationIntervalMonths
            ? Number(donationIntervalMonths)
            : null,
        }),
      });
      const data = (await response.json()) as { hospital?: Hospital; error?: string };
      if (!response.ok || !data.hospital) {
        throw new Error(data.error ?? "Could not update hospital settings.");
      }
      setHospital(data.hospital);
      setSettingsName(data.hospital.name);
      setSettingsEmail(data.hospital.email);
      setHospitalPhone(data.hospital.phone ?? "");
      setDonationIntervalMonths(
        data.hospital.donationIntervalMonths?.toString() ?? "",
      );
      setCurrentPassword("");
      setNewPassword("");
      setMessage("Hospital settings updated.");
    } catch (error) {
      setMessage(requestError(error, "Could not update hospital settings."));
    } finally {
      setBusy(false);
    }
  }

  async function createPatientCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/hospital/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientName: caseName,
          patientReference: caseReference || null,
          bloodGroup: caseBloodGroup,
          unitsRequired: caseUnits,
          notes: caseNotes || null,
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not save patient record.");
      setCaseName("");
      setCaseReference("");
      setCaseUnits(1);
      setCaseNotes("");
      setMessage("Private patient case saved.");
      await refreshStaffRecords("patients");
    } catch (error) {
      setMessage(requestError(error, "Could not save patient record."));
    } finally {
      setBusy(false);
    }
  }

  async function updatePatientCase(patientCase: PatientCase, unitsIssued: number) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/hospital/cases/${patientCase.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unitsIssued }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not update issued units.");
      await refreshStaffRecords("patients");
    } catch (error) {
      setMessage(requestError(error, "Could not update issued units."));
    } finally {
      setBusy(false);
    }
  }

  async function recordDonation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/hospital/donations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          donorId: donationDonorId,
          donatedAt: new Date(donationDateTime).toISOString(),
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not record donor donation.");
      setDonationDateTime("");
      setMessage("Donation recorded; next review date calculated from the configured interval.");
      await refreshStaffRecords("donations");
      await refresh();
    } catch (error) {
      setMessage(requestError(error, "Could not record donor donation."));
    } finally {
      setBusy(false);
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
    setPatientCases([]);
    setHospitalDonors([]);
    setDonationRecords([]);
    setActiveSection("overview");
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
        <BloodCellBackdrop />
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
          <a className="patient-portal-link" href="/patient">Looking for blood? Sign in as a patient →</a>
          <p className="fine-print">Hospital-only features and records are not visible to patient accounts.</p>
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
            <button type="button" className={activeSection === "overview" ? "active" : ""} onClick={() => setActiveSection("overview")}><span>◫</span> Overview</button>
            <button type="button" className={activeSection === "emergency" ? "active" : ""} onClick={() => setActiveSection("emergency")}><span>✚</span> Emergency dispatch</button>
            <button type="button" className={activeSection === "tracking" ? "active" : ""} onClick={() => setActiveSection("tracking")}><span>⌖</span> Donor tracking</button>
            <button type="button" className={activeSection === "inventory" ? "active" : ""} onClick={() => setActiveSection("inventory")}><span>▤</span> Blood inventory</button>
            <button type="button" className={activeSection === "members" ? "active" : ""} onClick={() => setActiveSection("members")}><span>♧</span> Donor network</button>
            <button type="button" className={activeSection === "requests" ? "active" : ""} onClick={() => setActiveSection("requests")}><span>◷</span> Recent requests</button>
            <button type="button" className={activeSection === "patients" ? "active" : ""} onClick={() => setActiveSection("patients")}><span>▣</span> Patient records</button>
            <button type="button" className={activeSection === "donations" ? "active" : ""} onClick={() => setActiveSection("donations")}><span>♥</span> Donation history</button>
            <button type="button" className={activeSection === "settings" ? "active" : ""} onClick={() => setActiveSection("settings")}><span>⚙</span> Settings</button>
          </nav>
          <div className="sidebar-help">
            <span className="sidebar-status-dot" />
            <strong>Protected workspace</strong>
            <small>Only your hospital team can view this dashboard.</small>
          </div>
        </aside>

      <div className="page-content">
        <div className={`overview-stage dashboard-view${activeSection === "overview" ? "" : " section-hidden"}`} id="overview">
        <BloodCellBackdrop />
        <section className="welcome-row">
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
        </div>
        {message && <p className="notice">{message}</p>}
          <section className={`panel location-setup dashboard-view${activeSection === "settings" ? "" : " section-hidden"}`}>
            <div className="section-heading">
              <div><p className="eyebrow">{hospitalLocation && hospital.address && hospital.city ? "MAP & ADDRESS" : "REQUIRED FOR MATCHING"}</p><h2>{hospitalLocation && hospital.address && hospital.city ? "Hospital location" : "Set your hospital location"}</h2></div>
            </div>
            <p className="muted">
              Enter the facility address and city. Use the location button at the hospital entrance or emergency department to pin the matching point on Google Maps.
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
              <label>
                City or area
                <input
                  required
                  maxLength={120}
                  value={hospitalCity}
                  onChange={(event) => setHospitalCity(event.target.value)}
                />
              </label>
              <div className="map-location-tools">
                <button type="button" className="button subtle" disabled={locationBusy} onClick={useCurrentHospitalLocation}>
                  {locationBusy ? "Finding location..." : "Use this device's live location"}
                </button>
                <span className="helper-text">
                  {hospitalLatitude && hospitalLongitude
                    ? "Map pin selected. Save to update matching and ETA calculations."
                    : "Location is used only to match nearby donors and calculate ETA."}
                </span>
              </div>
              {locationError && <p className="notice error" role="alert">{locationError}</p>}
              <div className="google-map-preview">
                {hospitalLatitude && hospitalLongitude ? (
                  <iframe
                    title="Google Maps hospital location preview"
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                    src={`https://maps.google.com/maps?q=${encodeURIComponent(`${hospitalLatitude},${hospitalLongitude}`)}&z=16&output=embed`}
                  />
                ) : (
                  <div className="map-preview-empty">
                    <span className="map-preview-pin">⌖</span>
                    <strong>Choose a hospital location</strong>
                    <span>Allow location access to preview the pin on Google Maps.</span>
                  </div>
                )}
              </div>
              <button disabled={busy} className="button primary">
                {busy ? "Saving..." : "Save hospital location"}
              </button>
            </form>
          </section>

        <section className={`panel dashboard-view${activeSection === "settings" ? "" : " section-hidden"}`}>
          <div className="section-heading">
            <div><p className="eyebrow">ACCOUNT & PROFILE</p><h2>Hospital settings</h2></div>
          </div>
          <form className="stack-form hospital-settings-form" onSubmit={(event) => void saveHospitalSettings(event)}>
            <div className="location-coordinate-fields">
              <label>Hospital name<input required minLength={2} maxLength={160} value={settingsName} onChange={(event) => setSettingsName(event.target.value)} /></label>
              <label>Hospital email<input type="email" required maxLength={254} value={settingsEmail} onChange={(event) => setSettingsEmail(event.target.value)} /></label>
            </div>
            <label>Hospital mobile number<input type="tel" maxLength={30} value={hospitalPhone} onChange={(event) => setHospitalPhone(event.target.value)} placeholder="+1 415 555 0123" /></label>
            <div className="location-coordinate-fields">
              <label>New password (optional)<input type="password" minLength={12} maxLength={200} autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
              <label>Current password (required to save)<input type="password" required autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
            </div>
            <label>
              Hospital-approved minimum donation interval for new records (months)
              <input type="number" min={1} max={36} step={1} value={donationIntervalMonths} onChange={(event) => setDonationIntervalMonths(event.target.value)} placeholder="Not configured" />
            </label>
            <p className="fine-print settings-caution">Only set the interval approved by your blood-bank medical director and applicable local rules. The interval applies to newly recorded donations; older records retain their saved dates. This date is an administrative reminder, not medical clearance or donor eligibility certification. Donation recording is disabled until an interval is configured.</p>
            <button disabled={busy} className="button primary">{busy ? "Saving..." : "Save hospital settings"}</button>
          </form>
        </section>

        <section className={`panel dashboard-view${activeSection === "patients" ? "" : " section-hidden"}`}>
          <div className="section-heading">
            <div><p className="eyebrow">STAFF-ONLY · CONFIDENTIAL</p><h2>Patient cases & unit issue log</h2></div>
          </div>
          <p className="muted privacy-note">These records are visible only to authenticated hospital staff and are never included in patient availability searches. Record only the minimum required identifiers; do not enter diagnoses or unnecessary sensitive details.</p>
          <form className="stack-form patient-case-form" onSubmit={(event) => void createPatientCase(event)}>
            <div className="location-coordinate-fields">
              <label>Patient name<input required minLength={2} maxLength={120} value={caseName} onChange={(event) => setCaseName(event.target.value)} /></label>
              <label>Internal reference (optional)<input maxLength={80} value={caseReference} onChange={(event) => setCaseReference(event.target.value)} /></label>
            </div>
            <div className="location-coordinate-fields">
              <label>Blood group<select value={caseBloodGroup} onChange={(event) => setCaseBloodGroup(event.target.value as BloodGroup)}>{bloodGroups.map((group) => <option key={group} value={group}>{formatGroup(group)}</option>)}</select></label>
              <label>Units requested<input type="number" min={1} max={1000} value={caseUnits} onChange={(event) => setCaseUnits(Number(event.target.value))} /></label>
            </div>
            <label>Staff note (optional)<input maxLength={500} value={caseNotes} onChange={(event) => setCaseNotes(event.target.value)} /></label>
            <button disabled={busy} className="button primary">{busy ? "Saving..." : "Add private patient case"}</button>
          </form>
          <div className="staff-case-list">
            {patientCases.map((patientCase) => (
              <PatientCaseRow key={patientCase.id} patientCase={patientCase} busy={busy} onSave={updatePatientCase} />
            ))}
            {!patientCases.length && <div className="empty-state compact">No patient cases have been added to this hospital.</div>}
          </div>
        </section>

        <section className={`panel dashboard-view${activeSection === "donations" ? "" : " section-hidden"}`}>
          <div className="section-heading">
            <div><p className="eyebrow">STAFF-ONLY · DONOR HISTORY</p><h2>Donation date & next review</h2></div>
          </div>
          <p className="muted privacy-note">Record verified donation dates. The next review date uses the interval configured in Settings; clinicians must determine actual donor eligibility. This record never appears in the patient portal.</p>
          <form className="location-coordinate-fields donation-entry-form" onSubmit={(event) => void recordDonation(event)}>
            <label>Donor<select required value={donationDonorId} onChange={(event) => setDonationDonorId(event.target.value)}><option value="" disabled>Select a donor</option>{hospitalDonors.map((donor) => <option key={donor.id} value={donor.id}>{donor.name} · {formatGroup(donor.bloodGroup)}</option>)}</select></label>
            <label>Donation date and time<input required type="datetime-local" value={donationDateTime} onChange={(event) => setDonationDateTime(event.target.value)} /></label>
            <button className="button primary" disabled={busy || !donationIntervalMonths || !donationDonorId}>{busy ? "Saving..." : "Record donation"}</button>
          </form>
          {!donationIntervalMonths && <p className="notice">Configure a medically approved donation interval in Settings before recording donation dates.</p>}
          <div className="table-scroll">
            <table><thead><tr><th>Donor</th><th>Blood group</th><th>Donation date & time</th><th>Next review date</th></tr></thead>
              <tbody>{donationRecords.map((record) => <tr key={record.id}><td>{record.donor.name}</td><td>{formatGroup(record.donor.bloodGroup)}</td><td>{new Date(record.donatedAt).toLocaleString()}</td><td>{record.nextEligibleAt ? new Date(record.nextEligibleAt).toLocaleString() : "Not calculated"}</td></tr>)}</tbody>
            </table>
            {!donationRecords.length && <div className="empty-state compact">No donation events recorded by this hospital.</div>}
          </div>
        </section>

        <section className={`dashboard-grid dashboard-view${activeSection === "emergency" ? "" : " section-hidden"}`} id="emergency">
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

        <section className={`panel dashboard-view${activeSection === "tracking" ? "" : " section-hidden"}`} id="tracking">
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

        <section className={`panel dashboard-view${activeSection === "inventory" ? "" : " section-hidden"}`} id="inventory">
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
          <div className="inventory-history">
            <div className="section-heading"><div><p className="eyebrow">STAFF AUDIT TRAIL</p><h2>Recent unit changes</h2></div></div>
            <div className="table-scroll">
              <table><thead><tr><th>Date</th><th>Blood group</th><th>Change</th><th>Reason</th></tr></thead>
                <tbody>{inventoryChanges.slice(0, 20).map((change) => (
                  <tr key={change.id}>
                    <td>{new Date(change.createdAt).toLocaleString()}</td>
                    <td>{formatGroup(change.bloodGroup)}</td>
                    <td className={change.unitsDelta < 0 ? "shortage" : "covered"}>{change.unitsDelta > 0 ? "+" : ""}{change.unitsDelta}</td>
                    <td>{change.reason.replaceAll("_", " ").toLowerCase()}{change.patientCase ? ` · ${change.patientCase.patientName}` : ""}</td>
                  </tr>
                ))}</tbody>
              </table>
              {!inventoryChanges.length && <div className="empty-state compact">No stock changes have been recorded.</div>}
            </div>
          </div>
        </section>

        <section className={`panel donor-network-panel dashboard-view${activeSection === "members" ? "" : " section-hidden"}`} id="members">
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

        <section className={`panel dashboard-view${activeSection === "requests" ? "" : " section-hidden"}`} id="requests">
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

function PatientCaseRow({
  patientCase,
  busy,
  onSave,
}: {
  patientCase: PatientCase;
  busy: boolean;
  onSave: (patientCase: PatientCase, unitsIssued: number) => Promise<void>;
}) {
  const [issued, setIssued] = useState(String(patientCase.unitsIssued));
  useEffect(() => setIssued(String(patientCase.unitsIssued)), [patientCase.unitsIssued]);
  return (
    <article className="staff-case-row">
      <div className="staff-case-info">
        <strong>{patientCase.patientName} <span>{formatGroup(patientCase.bloodGroup)}</span></strong>
        <small>{patientCase.patientReference || "No internal reference"} · {patientCase.status} · {new Date(patientCase.createdAt).toLocaleDateString()}</small>
        <small>{patientCase.unitsIssued} of {patientCase.unitsRequired} units issued{patientCase.notes ? ` · ${patientCase.notes}` : ""}</small>
      </div>
      <div className="stock-edit">
        <input aria-label={`Units issued for ${patientCase.patientName}`} type="number" min={0} max={patientCase.unitsRequired} value={issued} onChange={(event) => setIssued(event.target.value)} />
        <button className="button small-button" disabled={busy} onClick={() => void onSave(patientCase, Number(issued))}>Update issued</button>
      </div>
    </article>
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
