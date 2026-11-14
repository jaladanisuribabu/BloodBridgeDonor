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
  smsSent: number;
  smsFailed: number;
  smsQueued: number;
  donors: Donor[];
};
type Forecast = {
  bloodGroup: BloodGroup;
  reportedUnits: number;
  trackedUnits: number;
  unverifiedUnits: number;
  verifiedUsableUnits: number;
  pendingTestingUnits: number;
  reservedUnits: number;
  expiredUnits: number;
  quarantinedUnits: number;
  historicalUnits90Days: number;
  projectedSevenDayDemand: number;
  projectedShortage: number;
  expiryRiskUnits: number;
  confidenceScore: number;
  confidence: "low" | "moderate" | "high";
  anomalies: { kind: string; message: string; createdAt?: string }[];
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
type StaffDonor = {
  id: string;
  name: string;
  phone: string;
  address: string | null;
  bloodGroup: BloodGroup;
  available: boolean;
  callConsent: boolean;
  trackingConsent: boolean;
  smsConsent: boolean;
  hasLocation: boolean;
  nextEligibleAt: string | null;
  createdAt: string;
};
type TwilioReadiness = {
  configured: boolean;
  missingVariables: string[];
};
type TwilioConfiguration = {
  voice: TwilioReadiness;
  sms: TwilioReadiness;
};
type BloodUnitStatus =
  | "PENDING_TESTING"
  | "AVAILABLE"
  | "RESERVED"
  | "ISSUED"
  | "QUARANTINED";
type BloodUnit = {
  id: string;
  unitCode: string;
  bloodGroup: BloodGroup;
  collectedAt: string;
  expiresAt: string;
  status: BloodUnitStatus;
  verifiedAt: string | null;
  reservationReference: string | null;
  quarantineReason: string | null;
  updatedAt: string;
  donor: { name: string } | null;
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
type HospitalContact = {
  id: string;
  name: string;
  city: string | null;
  phone: string | null;
  inventory: {
    bloodGroup: BloodGroup;
    verifiedUsableUnits: number;
    updatedAt: string | null;
  }[];
};
type DashboardSection =
  | "overview"
  | "emergency"
  | "tracking"
  | "inventory"
  | "hospital-network"
  | "members"
  | "requests"
  | "donors"
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
  const [hospitalDonors, setHospitalDonors] = useState<HospitalDonor[]>([]);
  const [donorRecords, setDonorRecords] = useState<StaffDonor[]>([]);
  const [donorName, setDonorName] = useState("");
  const [donorPhone, setDonorPhone] = useState("");
  const [donorAddress, setDonorAddress] = useState("");
  const [donorBloodGroup, setDonorBloodGroup] = useState<BloodGroup>("O_POSITIVE");
  const [donorCallConsent, setDonorCallConsent] = useState(false);
  const [donorTrackingConsent, setDonorTrackingConsent] = useState(false);
  const [donorSmsConsent, setDonorSmsConsent] = useState(false);
  const [donorLatitude, setDonorLatitude] = useState("");
  const [donorLongitude, setDonorLongitude] = useState("");
  const [donorLocationBusy, setDonorLocationBusy] = useState(false);
  const [donorLocationError, setDonorLocationError] = useState("");
  const [donorRecordBusy, setDonorRecordBusy] = useState(false);
  const [donorRecordMessage, setDonorRecordMessage] = useState("");
  const [donorRecordError, setDonorRecordError] = useState(false);
  const [donorActivationToken, setDonorActivationToken] = useState("");
  const [bloodUnits, setBloodUnits] = useState<BloodUnit[]>([]);
  const [unitBloodGroup, setUnitBloodGroup] = useState<BloodGroup>("O_POSITIVE");
  const [unitCode, setUnitCode] = useState("");
  const [unitDonorId, setUnitDonorId] = useState("");
  const [unitCollectedAt, setUnitCollectedAt] = useState("");
  const [unitExpiresAt, setUnitExpiresAt] = useState("");
  const [unitIncrementReported, setUnitIncrementReported] = useState(true);
  const [unitRecordBusy, setUnitRecordBusy] = useState(false);
  const [donationRecords, setDonationRecords] = useState<DonationRecord[]>([]);
  const [hospitalNetwork, setHospitalNetwork] = useState<HospitalContact[]>([]);
  const [hospitalNetworkLoading, setHospitalNetworkLoading] = useState(false);
  const [hospitalNetworkError, setHospitalNetworkError] = useState("");
  const [hospitalNetworkSearch, setHospitalNetworkSearch] = useState("");
  const [hospitalNetworkBloodGroup, setHospitalNetworkBloodGroup] = useState<
    BloodGroup | "ALL"
  >("ALL");
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
  const [twilioConfiguration, setTwilioConfiguration] =
    useState<TwilioConfiguration | null>(null);
  const [twilioConfigurationError, setTwilioConfigurationError] = useState("");
  const [retryingRequestId, setRetryingRequestId] = useState("");
  const [isLocalApp, setIsLocalApp] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState<"password" | "email" | null>(
    null,
  );
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const [recoveryError, setRecoveryError] = useState(false);
  const [bloodGroup, setBloodGroup] = useState<BloodGroup>("O_NEGATIVE");
  const [unitsRequired, setUnitsRequired] = useState(1);
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

  const refreshTwilioConfiguration = useCallback(async () => {
    setTwilioConfigurationError("");
    try {
      const response = await fetch("/api/hospital/ivr/status", {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(
          await responseError(response, "Could not check IVR configuration."),
        );
      }
      const data = (await response.json()) as TwilioConfiguration;
      setTwilioConfiguration(data);
    } catch (error) {
      setTwilioConfigurationError(
        requestError(error, "Could not check IVR configuration."),
      );
    }
  }, []);

  const refreshStaffRecords = useCallback(async (section: DashboardSection) => {
    if (section === "donors") {
      const response = await fetch("/api/hospital/donor-records", { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load staff donor records.");
      const data = (await response.json()) as { donors: StaffDonor[] };
      setDonorRecords(data.donors);
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

  const refreshBloodUnits = useCallback(async () => {
    const response = await fetch("/api/hospital/inventory/units", {
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(
        await responseError(response, "Could not load unit-level inventory."),
      );
    }
    const data = (await response.json()) as { units: BloodUnit[] };
    setBloodUnits(data.units);
  }, []);

  const refreshHospitalNetwork = useCallback(async () => {
    setHospitalNetworkLoading(true);
    setHospitalNetworkError("");
    try {
      const response = await fetch("/api/hospital/network", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(
          await responseError(response, "Could not load the hospital network."),
        );
      }
      const data = (await response.json()) as { hospitals: HospitalContact[] };
      setHospitalNetwork(data.hospitals);
    } catch (error) {
      setHospitalNetworkError(
        requestError(error, "Could not load the hospital network."),
      );
    } finally {
      setHospitalNetworkLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!hospital || (activeSection !== "donors" && activeSection !== "donations")) return;
    void refreshStaffRecords(activeSection).catch((error: unknown) => {
      setMessage(requestError(error, "Could not load staff records."));
    });
  }, [hospital, activeSection, refreshStaffRecords]);

  useEffect(() => {
    if (!hospital || activeSection !== "inventory") return;
    void refreshBloodUnits().catch((error: unknown) => {
      setMessage(requestError(error, "Could not load unit-level inventory."));
    });
    const timer = window.setInterval(() => {
      void refreshBloodUnits().catch((error: unknown) => {
        setMessage(requestError(error, "Could not refresh unit-level inventory."));
      });
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [hospital, activeSection, refreshBloodUnits]);

  useEffect(() => {
    if (!hospital || activeSection !== "hospital-network") return;
    void refreshHospitalNetwork();
    const timer = window.setInterval(() => {
      void refreshHospitalNetwork();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [hospital, activeSection, refreshHospitalNetwork]);

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

  useEffect(() => {
    if (!hospital || activeSection !== "emergency") return;
    void refreshTwilioConfiguration();
  }, [hospital, activeSection, refreshTwilioConfiguration]);

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
      setMessage("Hospital address and map settings saved. The address is used in IVR; the map pin is optional for ETA.");
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
      const data = (await response.json()) as {
        error?: string;
        warning?: string;
        startedCalls?: number;
      };
      if (!response.ok) throw new Error(data.error ?? "Could not create request.");
      setMessage(
        data.warning ??
          `Emergency request saved. ${data.startedCalls ?? 0} donor call(s) started.`,
      );
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create request.");
    } finally {
      setBusy(false);
    }
  }

  async function retryRequestDispatch(requestId: string) {
    setRetryingRequestId(requestId);
    setMessage("");
    try {
      const response = await fetch(
        `/api/hospital/requests/${encodeURIComponent(requestId)}/dispatch`,
        { method: "POST" },
      );
      const data = (await response.json()) as {
        error?: string;
        warning?: string;
        startedCalls?: number;
        smsWarning?: string;
      };
      if (!response.ok) {
        throw new Error(data.error ?? "Could not retry donor dispatch.");
      }
      setMessage(
        [data.warning, data.smsWarning].filter(Boolean).join(" ") ||
          `${data.startedCalls ?? 0} additional donor call(s) started.`,
      );
      await refresh();
    } catch (error) {
      setMessage(requestError(error, "Could not retry donor dispatch."));
    } finally {
      setRetryingRequestId("");
    }
  }

  async function updateDonorConsent(
    donor: StaffDonor,
    field: "callConsent" | "smsConsent",
  ) {
    const consent = !donor[field];
    const description =
      field === "callConsent"
        ? "automated emergency calls"
        : "emergency SMS alerts";
    if (
      consent &&
      !window.confirm(`Confirm this donor explicitly opted in to ${description}.`)
    ) {
      return;
    }

    try {
      const response = await fetch(
        `/api/hospital/donor-records/${encodeURIComponent(donor.id)}/consent`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [field]: consent }),
        },
      );
      if (!response.ok) {
        throw new Error(
          await responseError(response, "Could not update donor consent."),
        );
      }
      setDonorRecords((records) =>
        records.map((record) =>
          record.id === donor.id ? { ...record, [field]: consent } : record,
        ),
      );
      setMessage(
        consent
          ? `${field === "callConsent" ? "Call" : "SMS"} opt-in recorded.`
          : `${field === "callConsent" ? "Call" : "SMS"} opt-in revoked.`,
      );
    } catch (error) {
      setMessage(requestError(error, "Could not update donor consent."));
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

  function captureDonorLocation() {
    setDonorLocationError("");
    if (!donorTrackingConsent) {
      setDonorLocationError("Get the donor's explicit location-sharing consent first.");
      return;
    }
    if (!navigator.geolocation) {
      setDonorLocationError("Location access is not available in this browser.");
      return;
    }
    setDonorLocationBusy(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setDonorLatitude(position.coords.latitude.toString());
        setDonorLongitude(position.coords.longitude.toString());
        setDonorLocationBusy(false);
      },
      (error) => {
        setDonorLocationError(
          error.code === error.PERMISSION_DENIED
            ? "Allow location access after confirming the donor's consent."
            : "Could not determine the donor's location. Check location services and try again.",
        );
        setDonorLocationBusy(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }

  async function createDonorRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDonorRecordBusy(true);
    setDonorRecordError(false);
    setDonorRecordMessage("");
    setDonorActivationToken("");
    const compactPhone = donorPhone.trim().replace(/[\s()-]/g, "");
    const normalizedPhone = /^\d{10}$/.test(compactPhone)
      ? `+91${compactPhone}`
      : compactPhone;
    try {
      const response = await fetch("/api/hospital/donor-records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: donorName,
          phone: normalizedPhone,
          address: donorAddress,
          bloodGroup: donorBloodGroup,
          callConsent: donorCallConsent,
          trackingConsent: donorTrackingConsent,
          smsConsent: donorSmsConsent,
          latitude: donorLatitude ? Number(donorLatitude) : null,
          longitude: donorLongitude ? Number(donorLongitude) : null,
        }),
      });
      const data = (await response.json()) as {
        donor?: StaffDonor;
        activationToken?: string | null;
        error?: string;
      };
      if (!response.ok || !data.donor) {
        throw new Error(data.error ?? "Could not save this donor record.");
      }
      const createdDonor = data.donor;
      setDonorRecords((records) => [createdDonor, ...records]);
      setDonorName("");
      setDonorPhone("");
      setDonorAddress("");
      setDonorLatitude("");
      setDonorLongitude("");
      setDonorCallConsent(false);
      setDonorTrackingConsent(false);
      setDonorSmsConsent(false);
      setDonorActivationToken(data.activationToken ?? "");
      setDonorRecordMessage(
        createdDonor.callConsent
          ? "Donor record saved. Calls can match across any distance; location sharing is optional and used only for tracking and ETA."
          : "Donor record saved. The donor will not be called until explicit call consent is recorded.",
      );
    } catch (error) {
      setDonorRecordError(true);
      setDonorRecordMessage(requestError(error, "Could not save this donor record."));
    } finally {
      setDonorRecordBusy(false);
    }
  }

  async function createBloodUnit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUnitRecordBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/hospital/inventory/units", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bloodGroup: unitBloodGroup,
          unitCode: unitCode.trim() || undefined,
          donorId: unitDonorId || null,
          collectedAt: new Date(unitCollectedAt).toISOString(),
          expiresAt: new Date(unitExpiresAt).toISOString(),
          incrementReported: unitIncrementReported,
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Could not register this blood unit.");
      }
      setUnitCode("");
      setUnitDonorId("");
      setUnitCollectedAt("");
      setUnitExpiresAt("");
      setMessage("Unit recorded as pending testing. It is not counted as usable until released.");
      await Promise.all([refresh(), refreshBloodUnits()]);
    } catch (error) {
      setMessage(requestError(error, "Could not register this blood unit."));
    } finally {
      setUnitRecordBusy(false);
    }
  }

  async function updateBloodUnit(unit: BloodUnit, status: BloodUnitStatus) {
    let reason = "";
    let reservationReference: string | null = null;
    let verificationConfirmed = false;
    if (status === "AVAILABLE") {
      if (
        unit.status !== "RESERVED" &&
        !window.confirm(
          "Confirm required testing is complete and qualified staff have released this unit for clinical use.",
        )
      ) return;
      reason = unit.status === "RESERVED"
        ? "Reservation released by authorized staff."
        : "Testing completed and released by authorized staff.";
      verificationConfirmed = unit.status !== "RESERVED";
    } else if (status === "RESERVED") {
      reservationReference = window.prompt(
        "Enter a non-identifying reservation reference. Do not enter patient names or diagnoses.",
      )?.trim() ?? "";
      if (!reservationReference) return;
      reason = "Reserved for a hospital case.";
    } else if (status === "ISSUED") {
      if (!window.confirm("Confirm this verified unit has been issued to the patient.")) return;
      reason = "Issued to a hospital patient.";
    } else if (status === "QUARANTINED") {
      reason = window.prompt("Enter the non-sensitive reason for quarantine.")?.trim() ?? "";
      if (reason.length < 3) return;
    } else {
      reason = "Returned to testing for staff review.";
    }

    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/hospital/inventory/units/${unit.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          reason,
          reservationReference,
          verificationConfirmed,
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Could not update this unit.");
      }
      await Promise.all([refresh(), refreshBloodUnits()]);
      setMessage(`Unit ${unit.unitCode} updated.`);
    } catch (error) {
      setMessage(requestError(error, "Could not update this unit."));
    } finally {
      setBusy(false);
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
    setDonorRecords([]);
    setHospitalDonors([]);
    setBloodUnits([]);
    setDonorActivationToken("");
    setDonorRecordMessage("");
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
            <button type="button" className={activeSection === "hospital-network" ? "active" : ""} onClick={() => setActiveSection("hospital-network")}><span>☎</span> Hospital network</button>
            <button type="button" className={activeSection === "members" ? "active" : ""} onClick={() => setActiveSection("members")}><span>♧</span> Donor network</button>
            <button type="button" className={activeSection === "requests" ? "active" : ""} onClick={() => setActiveSection("requests")}><span>◷</span> Recent requests</button>
            <button type="button" className={activeSection === "donors" ? "active" : ""} onClick={() => setActiveSection("donors")}><span>♥</span> Donor records</button>
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
              <div><p className="eyebrow">{hospital.address && hospital.city ? "HOSPITAL ADDRESS" : "ADDRESS REQUIRED FOR CALLS"}</p><h2>{hospital.address && hospital.city ? "Hospital location" : "Set hospital address"}</h2></div>
            </div>
              <p className="muted">
                Enter the facility address and city for the IVR message. The optional map pin is used for ETA calculations, not donor call matching.
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
                    : "Hospital coordinates are optional and used only for ETA calculations."}
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

        <section className={`panel dashboard-view${activeSection === "donors" ? "" : " section-hidden"}`}>
          <div className="section-heading">
            <div><p className="eyebrow">STAFF-ONLY · DONOR INTAKE</p><h2>Donor records</h2></div>
          </div>
          <p className="muted privacy-note">Add donors encountered at hospital visits or campaigns. Voice calls, SMS alerts, and location tracking each require separate explicit consent. Call matching works at any distance; location sharing is optional and is used only for tracking and ETA.</p>
          <form className="stack-form donor-intake-form" onSubmit={(event) => void createDonorRecord(event)}>
            <div className="location-coordinate-fields">
              <label>Donor name<input required minLength={2} maxLength={120} value={donorName} onChange={(event) => setDonorName(event.target.value)} /></label>
              <label>Mobile number<input required type="tel" maxLength={30} value={donorPhone} onChange={(event) => setDonorPhone(event.target.value)} placeholder="+91 97000 00000" /></label>
            </div>
            <div className="location-coordinate-fields">
              <label>Blood group<select value={donorBloodGroup} onChange={(event) => setDonorBloodGroup(event.target.value as BloodGroup)}>{bloodGroups.map((group) => <option key={group} value={group}>{formatGroup(group)}</option>)}</select></label>
              <label>Address<input required minLength={2} maxLength={300} value={donorAddress} onChange={(event) => setDonorAddress(event.target.value)} placeholder="Area, city" /></label>
            </div>
            <div className="donor-consents">
              <label className="consent-confirmation">
                <input type="checkbox" checked={donorCallConsent} onChange={(event) => setDonorCallConsent(event.target.checked)} />
                <span>Donor explicitly agreed to receive automated emergency calls.</span>
              </label>
              <label className="consent-confirmation">
                <input type="checkbox" checked={donorTrackingConsent} onChange={(event) => {
                  setDonorTrackingConsent(event.target.checked);
                  if (!event.target.checked) {
                    setDonorLatitude("");
                    setDonorLongitude("");
                  }
                }} />
                <span>Donor explicitly agreed to share location for live tracking and ETA.</span>
              </label>
              <label className="consent-confirmation">
                <input type="checkbox" checked={donorSmsConsent} onChange={(event) => setDonorSmsConsent(event.target.checked)} />
                <span>Donor explicitly agreed to receive emergency SMS alerts.</span>
              </label>
            </div>
            <div className="donor-location-capture">
              <button type="button" className="button subtle" disabled={!donorTrackingConsent || donorLocationBusy} onClick={captureDonorLocation}>
                {donorLocationBusy ? "Getting location..." : "Capture donor-confirmed live location"}
              </button>
              <span className="helper-text">
                {donorLatitude && donorLongitude
                  ? `Location captured (${Number(donorLatitude).toFixed(4)}, ${Number(donorLongitude).toFixed(4)}).`
                  : "Capture only while the donor is present and has agreed. GPS is not required for calls."}
              </span>
            </div>
            {donorLocationError && <p className="notice error" role="alert">{donorLocationError}</p>}
            <button disabled={donorRecordBusy} className="button primary">{donorRecordBusy ? "Saving..." : "Add donor record"}</button>
          </form>
          {donorActivationToken && (
            <p className="notice donor-token-note" role="status">
              One-time location activation token: <code>{donorActivationToken}</code>. Deliver it privately to the donor; do not share it in public or add it to source control.
            </p>
          )}
          {donorRecordMessage && <p className={`notice${donorRecordError ? " error" : ""}`} role="status">{donorRecordMessage}</p>}
          <div className="staff-donor-list">
            {donorRecords.map((donor) => (
              <article className="staff-donor-card" key={donor.id}>
                <div>
                  <strong>{donor.name}</strong>
                  <span>{formatGroup(donor.bloodGroup)} · {donor.phone}</span>
                  <small>{donor.address || "Address not recorded"}</small>
                </div>
                <div className="donor-eligibility">
                  <span className={donor.callConsent ? "consent-yes" : "consent-no"}>
                    Calls {donor.callConsent ? "consented" : "not consented"}
                  </span>
                  <button
                    type="button"
                    className="button subtle small-button"
                    onClick={() => void updateDonorConsent(donor, "callConsent")}
                  >
                    {donor.callConsent ? "Revoke call opt-in" : "Record call opt-in"}
                  </button>
                  <span className={donor.trackingConsent && donor.hasLocation ? "consent-yes" : "consent-no"}>
                    {donor.trackingConsent && donor.hasLocation ? "Location ready" : "Location not ready"}
                  </span>
                  <span className={donor.smsConsent ? "consent-yes" : "consent-no"}>
                    SMS {donor.smsConsent ? "consented" : "not consented"}
                  </span>
                  <button
                    type="button"
                    className="button subtle small-button"
                    onClick={() => void updateDonorConsent(donor, "smsConsent")}
                  >
                    {donor.smsConsent ? "Revoke SMS opt-in" : "Record SMS opt-in"}
                  </button>
                  <span>{donor.available ? "Available" : "Unavailable"}{donor.nextEligibleAt ? ` · Review ${new Date(donor.nextEligibleAt).toLocaleDateString()}` : ""}</span>
                </div>
              </article>
            ))}
            {!donorRecords.length && <div className="empty-state compact">No donors registered by this hospital yet.</div>}
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
                disabled={busy || !hospital.address}
                className="button primary"
              >
                {busy ? "Submitting..." : "Find eligible donors"}
              </button>
            </form>
            <p className="helper-text">Available donors with call consent are matched nationwide and called in groups of up to five. GPS is optional and only used for live tracking after a donor accepts.</p>
          </article>

          <article className="panel dispatch-guide">
            <p className="eyebrow">AUTOMATED DISPATCH</p>
            <h2>IVR and alert readiness</h2>
            <p className="muted">Only available donors with explicit call consent are called. SMS is sent only to donors who separately opted in.</p>
            <div className="dispatch-rule"><span>01</span><div><strong>Any distance</strong><small>Exact blood-group match; GPS is not required to call</small></div></div>
            <div className="dispatch-rule"><span>02</span><div><strong>Up to 5 calls at once</strong><small>Rollover continues until units are confirmed</small></div></div>
            <div className="provider-readiness">
              <div className="section-heading">
                <strong>Twilio configuration</strong>
                <button type="button" className="button subtle small-button" onClick={() => void refreshTwilioConfiguration()}>
                  Refresh status
                </button>
              </div>
              {twilioConfigurationError && <p className="notice error">{twilioConfigurationError}</p>}
              {!twilioConfiguration && !twilioConfigurationError && <p className="helper-text">Checking server configuration…</p>}
              {twilioConfiguration && (
                <>
                  <p className={`notice${twilioConfiguration.voice.configured ? "" : " error"}`}>
                    Voice IVR configuration {twilioConfiguration.voice.configured ? "present" : "incomplete"}
                    {!twilioConfiguration.voice.configured && ` · Missing: ${twilioConfiguration.voice.missingVariables.join(", ")}`}
                  </p>
                  <p className={`notice${twilioConfiguration.sms.configured ? "" : " error"}`}>
                    SMS configuration {twilioConfiguration.sms.configured ? "present" : "incomplete"}
                    {!twilioConfiguration.sms.configured && ` · Missing: ${twilioConfiguration.sms.missingVariables.join(", ")}`}
                  </p>
                  <p className="fine-print">This checks required settings only; it cannot verify your Twilio account, number capabilities, or trial limits. Set secrets server-side in Vercel → Project → Settings → Environment Variables, then redeploy. Never paste Twilio secrets into the browser or chat.</p>
                </>
              )}
            </div>
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
            <div><p className="eyebrow">BLOODVERIFY · STOCK CONFIDENCE</p><h2>Verified inventory & forecast</h2></div>
            <span className="helper-text">Based on the previous 90 days of requests</span>
          </div>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Group</th><th>Reported</th><th>Verified usable</th><th>Pending</th><th>Reserved</th><th>Expired</th><th>Quarantined</th><th>7-day demand</th><th>Shortage</th><th>Confidence</th><th>Adjust reported</th></tr></thead>
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
          <p className="fine-print">Reported totals are not treated as verified stock. Only unexpired, staff-released unit records count as usable. Forecasts are planning estimates, not clinical advice; confidence reflects record reconciliation, freshness and release status.</p>

          <div className="inventory-anomalies">
            <div className="section-heading"><div><p className="eyebrow">DATA QUALITY & EXPIRY</p><h2>Verification alerts</h2></div></div>
            {forecasts.flatMap((forecast) =>
              forecast.anomalies.map((anomaly, index) => (
                <article className={`inventory-alert ${anomaly.kind.toLowerCase()}`} key={`${forecast.bloodGroup}-${anomaly.kind}-${index}`}>
                  <strong>{formatGroup(forecast.bloodGroup)} · {anomaly.kind.replaceAll("_", " ")}</strong>
                  <span>{anomaly.message}</span>
                  {anomaly.createdAt && <small>{new Date(anomaly.createdAt).toLocaleString()}</small>}
                </article>
              )),
            )}
            {!forecasts.some((forecast) => forecast.anomalies.length) && (
              <div className="empty-state compact">No stock verification alerts.</div>
            )}
          </div>

          <div className="inventory-unit-entry">
            <div className="section-heading"><div><p className="eyebrow">STAFF UNIT INTAKE</p><h2>Register a blood unit</h2></div></div>
            <p className="muted privacy-note">New units begin in pending testing and are excluded from usable stock. To reconcile a unit with an existing aggregate count, leave “New stock” unchecked so the reported total is not double-counted.</p>
            <form className="stack-form unit-intake-form" onSubmit={(event) => void createBloodUnit(event)}>
              <div className="location-coordinate-fields">
                <label>Blood group<select required value={unitBloodGroup} onChange={(event) => { setUnitBloodGroup(event.target.value as BloodGroup); setUnitDonorId(""); }}>{bloodGroups.map((group) => <option key={group} value={group}>{formatGroup(group)}</option>)}</select></label>
                <label>Unit / barcode ID (optional)<input maxLength={80} value={unitCode} onChange={(event) => setUnitCode(event.target.value)} placeholder="Generated if blank" /></label>
                <label>Donor (optional)<select value={unitDonorId} onChange={(event) => setUnitDonorId(event.target.value)}><option value="">Not linked</option>{donorRecords.filter((donor) => donor.bloodGroup === unitBloodGroup).map((donor) => <option key={donor.id} value={donor.id}>{donor.name}</option>)}</select></label>
              </div>
              <div className="location-coordinate-fields">
                <label>Collection date/time<input required type="datetime-local" value={unitCollectedAt} onChange={(event) => setUnitCollectedAt(event.target.value)} /></label>
                <label>Expiry date/time<input required type="datetime-local" value={unitExpiresAt} onChange={(event) => setUnitExpiresAt(event.target.value)} /></label>
              </div>
              <label className="consent-confirmation">
                <input type="checkbox" checked={unitIncrementReported} onChange={(event) => setUnitIncrementReported(event.target.checked)} />
                <span>This is newly collected stock; increase the reported inventory by one.</span>
              </label>
              <button className="button primary" disabled={unitRecordBusy}>{unitRecordBusy ? "Recording unit..." : "Record pending unit"}</button>
            </form>
          </div>

          <div className="inventory-unit-list">
            <div className="section-heading"><div><p className="eyebrow">UNIT-LEVEL LEDGER</p><h2>Tracked blood units</h2></div><span className="helper-text">Up to 300 non-issued units</span></div>
            {bloodUnits.map((unit) => {
              const isExpired = new Date(unit.expiresAt).getTime() <= Date.now();
              return (
                <article className="inventory-unit-card" key={unit.id}>
                  <div className="inventory-unit-summary">
                    <strong>{formatGroup(unit.bloodGroup)} · {unit.unitCode}</strong>
                    <span>{unit.donor ? `Donor: ${unit.donor.name} · ` : ""}{formatStatus(unit.status)}{isExpired ? " · expired" : ""}</span>
                    <small>Expires {new Date(unit.expiresAt).toLocaleString()}{unit.reservationReference ? ` · Reservation ${unit.reservationReference}` : ""}{unit.quarantineReason ? ` · ${unit.quarantineReason}` : ""}</small>
                  </div>
                  <div className="inventory-unit-actions">
                    {unit.status === "PENDING_TESTING" && !isExpired && <button className="button small-button" disabled={busy} onClick={() => void updateBloodUnit(unit, "AVAILABLE")}>Release usable</button>}
                    {unit.status === "AVAILABLE" && !isExpired && <button className="button small-button" disabled={busy} onClick={() => void updateBloodUnit(unit, "RESERVED")}>Reserve</button>}
                    {(unit.status === "AVAILABLE" || unit.status === "RESERVED") && !isExpired && <button className="button small-button" disabled={busy} onClick={() => void updateBloodUnit(unit, "ISSUED")}>Issue unit</button>}
                    {unit.status === "RESERVED" && !isExpired && <button className="button small-button" disabled={busy} onClick={() => void updateBloodUnit(unit, "AVAILABLE")}>Release reservation</button>}
                    {unit.status === "QUARANTINED" && !isExpired && <button className="button small-button" disabled={busy} onClick={() => void updateBloodUnit(unit, "PENDING_TESTING")}>Return to testing</button>}
                    {unit.status !== "QUARANTINED" && <button className="button small-button danger-button" disabled={busy} onClick={() => void updateBloodUnit(unit, "QUARANTINED")}>Quarantine</button>}
                    {isExpired && <span className="helper-text">Expired units cannot be released, reserved or issued.</span>}
                  </div>
                </article>
              );
            })}
            {!bloodUnits.length && <div className="empty-state compact">No individual blood units have been recorded.</div>}
          </div>

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

        <section className={`panel hospital-network-panel dashboard-view${activeSection === "hospital-network" ? "" : " section-hidden"}`} id="hospital-network">
          <div className="section-heading">
            <div>
              <p className="eyebrow">INTER-HOSPITAL EMERGENCY COORDINATION</p>
              <h2>Hospital network</h2>
            </div>
            <button
              type="button"
              className="button subtle"
              onClick={() => void refreshHospitalNetwork()}
              disabled={hospitalNetworkLoading}
            >
              {hospitalNetworkLoading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
          <p className="muted privacy-note">
            This directory and verified usable stock totals are visible to every signed-in hospital account. Hospital registration is not independently verified yet, so use approved accounts and confirm your organization permits this sharing. Call to confirm availability; only unexpired, released unit records are shown.
          </p>
          <div className="hospital-network-filters">
            <label>
              Search hospital or city
              <input
                type="search"
                maxLength={120}
                value={hospitalNetworkSearch}
                onChange={(event) => setHospitalNetworkSearch(event.target.value)}
                placeholder="Search by hospital or city"
              />
            </label>
            <label>
              Filter blood group
              <select
                value={hospitalNetworkBloodGroup}
                onChange={(event) =>
                  setHospitalNetworkBloodGroup(event.target.value as BloodGroup | "ALL")
                }
              >
                <option value="ALL">All blood groups</option>
                {bloodGroups.map((group) => (
                  <option key={group} value={group}>{formatGroup(group)}</option>
                ))}
              </select>
            </label>
          </div>
          {hospitalNetworkError && (
            <p className="notice error" role="alert">{hospitalNetworkError}</p>
          )}
          {hospitalNetworkLoading && hospitalNetwork.length === 0 ? (
            <div className="empty-state compact">Loading hospital contacts and verified inventory...</div>
          ) : (
            <div className="hospital-network-list">
              {hospitalNetwork
                .filter((contact) => {
                  const search = hospitalNetworkSearch.trim().toLocaleLowerCase();
                  return !search ||
                    contact.name.toLocaleLowerCase().includes(search) ||
                    (contact.city ?? "").toLocaleLowerCase().includes(search);
                })
                .map((contact) => {
                  const inventory = hospitalNetworkBloodGroup === "ALL"
                    ? contact.inventory
                    : contact.inventory.filter(
                        (item) => item.bloodGroup === hospitalNetworkBloodGroup,
                      );
                  const phoneHref = getPhoneHref(contact.phone);
                  return (
                    <article className="hospital-network-card" key={contact.id}>
                      <div className="hospital-network-card-heading">
                        <div>
                          <h3>{contact.name}</h3>
                          <p>{contact.city || "City not provided"}</p>
                        </div>
                        {phoneHref ? (
                          <div className="hospital-phone-actions">
                            <a className="hospital-phone-number" href={phoneHref}>
                              {contact.phone}
                            </a>
                            <a
                              className="button primary hospital-call-button"
                              href={phoneHref}
                              aria-label={`Call ${contact.name}`}
                            >
                              Call hospital
                            </a>
                          </div>
                        ) : (
                          <span className="hospital-no-phone">Phone not listed</span>
                        )}
                      </div>
                      <div className="hospital-stock-grid">
                        {inventory.map((item) => (
                          <div className="hospital-stock-item" key={item.bloodGroup}>
                            <span>{formatGroup(item.bloodGroup)}</span>
                            <strong>{item.verifiedUsableUnits}</strong>
                            <small>
                              {item.updatedAt
                                ? `Verified ${new Date(item.updatedAt).toLocaleString()}`
                                : "Verification time unavailable"}
                            </small>
                          </div>
                        ))}
                        {hospitalNetworkBloodGroup === "ALL" &&
                          bloodGroups
                            .filter(
                              (group) =>
                                !contact.inventory.some((item) => item.bloodGroup === group),
                            )
                            .map((group) => (
                              <div className="hospital-stock-item unreported" key={group}>
                                <span>{formatGroup(group)}</span>
                                <strong>—</strong>
                                <small>No verified units</small>
                              </div>
                            ))}
                        {hospitalNetworkBloodGroup !== "ALL" && inventory.length === 0 && (
                          <div className="hospital-stock-unreported">
                            No verified usable {formatGroup(hospitalNetworkBloodGroup)} units are listed.
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
              {!hospitalNetworkLoading && hospitalNetwork.length === 0 && (
                <div className="empty-state compact">
                  No other hospitals are registered in the network yet.
                </div>
              )}
              {hospitalNetwork.length > 0 &&
                !hospitalNetwork.some((contact) => {
                  const search = hospitalNetworkSearch.trim().toLocaleLowerCase();
                  return !search ||
                    contact.name.toLocaleLowerCase().includes(search) ||
                    (contact.city ?? "").toLocaleLowerCase().includes(search);
                }) && (
                  <div className="empty-state compact">
                    No hospitals match your search.
                  </div>
                )}
            </div>
          )}
          <p className="fine-print">
            Inventory figures are supplied by each hospital and may be out of date. Call to confirm units, compatibility, transfer arrangements, and current availability. BloodBridge does not initiate inter-hospital transfers.
          </p>
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
                <strong>{donorNetwork?.callable ?? "—"} available and call-consented</strong>
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
                  <span>I confirm every donor in this file explicitly agreed to emergency calls and sharing the listed location. SMS consent is recorded separately.</span>
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
                    <span>
                      {new Date(request.createdAt).toLocaleString()} · {request.donors.length} call attempts
                      {request.smsSent > 0 && ` · ${request.smsSent} SMS sent`}
                      {request.smsFailed > 0 && ` · ${request.smsFailed} SMS failed`}
                      {request.smsQueued > 0 && ` · ${request.smsQueued} SMS queued`}
                    </span>
                  </div>
                  <span className={`status-pill ${request.state.toLowerCase()}`}>{request.state}</span>
                  {request.state === "OPEN" && (
                    <button
                      type="button"
                      className="button subtle small-button"
                      disabled={Boolean(retryingRequestId)}
                      onClick={() => void retryRequestDispatch(request.id)}
                    >
                      {retryingRequestId === request.id ? "Retrying…" : "Retry dispatch"}
                    </button>
                  )}
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
  const [draft, setDraft] = useState(String(forecast.reportedUnits));
  useEffect(() => setDraft(String(forecast.reportedUnits)), [forecast.reportedUnits]);
  return (
    <tr>
      <td><strong>{formatGroup(forecast.bloodGroup)}</strong></td>
      <td>{forecast.reportedUnits}<small className="table-subtext">{forecast.unverifiedUnits} unverified</small></td>
      <td>{forecast.verifiedUsableUnits}</td>
      <td>{forecast.pendingTestingUnits}</td>
      <td>{forecast.reservedUnits}</td>
      <td>{forecast.expiredUnits}{forecast.expiryRiskUnits ? <small className="table-subtext">{forecast.expiryRiskUnits} expiry risk</small> : null}</td>
      <td>{forecast.quarantinedUnits}</td>
      <td>{forecast.projectedSevenDayDemand}</td>
      <td>
        {forecast.projectedShortage > 0
          ? <span className="shortage">{forecast.projectedShortage} short</span>
          : <span className="covered">Covered</span>}
      </td>
      <td><span className={`confidence ${forecast.confidence}`}>{forecast.confidenceScore}% · {forecast.confidence}</span></td>
      <td>
        <div className="stock-edit">
          <input
            aria-label={`Reported ${formatGroup(forecast.bloodGroup)} units`}
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

function getPhoneHref(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (!digits) return null;
  return `tel:${phone.trim().startsWith("+") ? "+" : ""}${digits}`;
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
