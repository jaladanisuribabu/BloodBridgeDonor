import { BloodGroup, BloodUnitStatus } from "@prisma/client";

type InventoryRow = {
  bloodGroup: BloodGroup;
  unitsAvailable: number;
  updatedAt: Date;
};

type UnitStatusCount = {
  bloodGroup: BloodGroup;
  status: BloodUnitStatus;
  count: number;
};

type ExpiringCount = {
  bloodGroup: BloodGroup;
  count: number;
};

type VerifiedDate = {
  bloodGroup: BloodGroup;
  verifiedAt: Date | null;
};

type InventoryChange = {
  bloodGroup: BloodGroup;
  unitsDelta: number;
  createdAt: Date;
};

export type BloodStockAnomaly = {
  kind:
    | "MISMATCH"
    | "STALE"
    | "EXPIRED"
    | "PENDING_TESTING"
    | "QUARANTINED"
    | "EXPIRY_RISK"
    | "LARGE_CHANGE";
  bloodGroup: BloodGroup;
  message: string;
  createdAt?: Date;
};

export type BloodVerificationSummary = {
  bloodGroup: BloodGroup;
  reportedUnits: number;
  trackedUnits: number;
  unverifiedUnits: number;
  verifiedUsableUnits: number;
  pendingTestingUnits: number;
  reservedUnits: number;
  expiredUnits: number;
  quarantinedUnits: number;
  projectedSevenDayDemand: number;
  projectedShortage: number;
  expiryRiskUnits: number;
  confidenceScore: number;
  confidence: "low" | "moderate" | "high";
  lastReportedAt: Date | null;
  lastVerifiedAt: Date | null;
  anomalies: BloodStockAnomaly[];
};

function mapByGroup<T extends { bloodGroup: BloodGroup }>(items: T[]) {
  return new Map(items.map((item) => [item.bloodGroup, item]));
}

export function summarizeBloodStock(input: {
  now: Date;
  inventory: InventoryRow[];
  unitStatuses: UnitStatusCount[];
  expiredStatuses: UnitStatusCount[];
  expiringSoon: ExpiringCount[];
  oldestVerification: VerifiedDate[];
  demand90Days: { bloodGroup: BloodGroup; units: number }[];
  recentChanges: InventoryChange[];
}): BloodVerificationSummary[] {
  const inventoryByGroup = mapByGroup(input.inventory);
  const expiringByGroup = mapByGroup(input.expiringSoon);
  const verificationByGroup = mapByGroup(input.oldestVerification);
  const demandByGroup = new Map(
    input.demand90Days.map((row) => [row.bloodGroup, row.units]),
  );
  const statusesByGroup = new Map<BloodGroup, Map<BloodUnitStatus, number>>();
  const expiredByGroup = new Map<BloodGroup, Map<BloodUnitStatus, number>>();

  for (const row of input.unitStatuses) {
    const statuses = statusesByGroup.get(row.bloodGroup) ?? new Map();
    statuses.set(row.status, row.count);
    statusesByGroup.set(row.bloodGroup, statuses);
  }
  for (const row of input.expiredStatuses) {
    const statuses = expiredByGroup.get(row.bloodGroup) ?? new Map();
    statuses.set(row.status, row.count);
    expiredByGroup.set(row.bloodGroup, statuses);
  }

  const nowMs = input.now.getTime();
  const reportStaleAfterMs = 24 * 60 * 60 * 1000;
  const reportMaxAgeMs = 7 * reportStaleAfterMs;

  return Object.values(BloodGroup).map((bloodGroup) => {
    const inventory = inventoryByGroup.get(bloodGroup);
    const statusCounts = statusesByGroup.get(bloodGroup) ?? new Map();
    const expiredCounts = expiredByGroup.get(bloodGroup) ?? new Map();
    const count = (status: BloodUnitStatus) => statusCounts.get(status) ?? 0;
    const expiredCount = (status: BloodUnitStatus) => expiredCounts.get(status) ?? 0;
    const trackedUnits = [...statusCounts.entries()]
      .filter(([status]) => status !== BloodUnitStatus.ISSUED)
      .reduce((total, [, units]) => total + units, 0);
    const expiredUnits = [...expiredCounts.values()].reduce(
      (total, units) => total + units,
      0,
    );
    const reportedUnits = inventory?.unitsAvailable ?? 0;
    const unverifiedUnits = Math.max(0, reportedUnits - trackedUnits);
    const verifiedUsableUnits = Math.max(
      0,
      count(BloodUnitStatus.AVAILABLE) - expiredCount(BloodUnitStatus.AVAILABLE),
    );
    const pendingTestingUnits = Math.max(
      0,
      count(BloodUnitStatus.PENDING_TESTING) -
        expiredCount(BloodUnitStatus.PENDING_TESTING),
    );
    const reservedUnits = Math.max(
      0,
      count(BloodUnitStatus.RESERVED) - expiredCount(BloodUnitStatus.RESERVED),
    );
    const quarantinedUnits = Math.max(
      0,
      count(BloodUnitStatus.QUARANTINED) -
        expiredCount(BloodUnitStatus.QUARANTINED),
    );
    const historicalUnits90Days = demandByGroup.get(bloodGroup) ?? 0;
    const projectedSevenDayDemand = Math.ceil((historicalUnits90Days / 90) * 7);
    const expiringSoonUnits = expiringByGroup.get(bloodGroup)?.count ?? 0;
    const expiryRiskUnits = Math.max(
      0,
      expiringSoonUnits - projectedSevenDayDemand,
    );
    const oldestVerifiedAt =
      verificationByGroup.get(bloodGroup)?.verifiedAt ?? null;
    const reportAgeMs = inventory ? Math.max(0, nowMs - inventory.updatedAt.getTime()) : reportMaxAgeMs;
    const verificationAgeMs = oldestVerifiedAt
      ? Math.max(0, nowMs - oldestVerifiedAt.getTime())
      : reportMaxAgeMs;
    const scale = Math.max(reportedUnits, trackedUnits, 1);
    const consistency = 1 - Math.abs(reportedUnits - trackedUnits) / scale;
    const reportFreshness = Math.max(0, 1 - reportAgeMs / reportMaxAgeMs);
    const verificationFreshness = Math.max(
      0,
      1 - verificationAgeMs / reportMaxAgeMs,
    );
    const releaseRatio =
      trackedUnits > 0 ? verifiedUsableUnits / trackedUnits : 0;
    const freshness =
      trackedUnits > 0
        ? (reportFreshness + verificationFreshness) / 2
        : reportFreshness;
    const confidenceScore = Math.round(
      100 * (0.4 * consistency + 0.3 * freshness + 0.3 * releaseRatio),
    );
    const confidence =
      confidenceScore >= 80
        ? "high"
        : confidenceScore >= 60
          ? "moderate"
          : "low";
    const anomalies: BloodStockAnomaly[] = [];

    if (reportedUnits !== trackedUnits) {
      anomalies.push({
        kind: "MISMATCH",
        bloodGroup,
        message:
          reportedUnits > trackedUnits
            ? `${reportedUnits - trackedUnits} reported unit(s) have no unit-level verification record.`
            : `${trackedUnits - reportedUnits} tracked unit(s) exceed the reported stock count.`,
      });
    }
    if (inventory && reportAgeMs > reportStaleAfterMs) {
      anomalies.push({
        kind: "STALE",
        bloodGroup,
        message: "Reported stock has not been updated in over 24 hours.",
      });
    }
    if (expiredUnits > 0) {
      anomalies.push({
        kind: "EXPIRED",
        bloodGroup,
        message: `${expiredUnits} unit(s) are past their expiry date and excluded from usable stock.`,
      });
    }
    if (pendingTestingUnits > 0) {
      anomalies.push({
        kind: "PENDING_TESTING",
        bloodGroup,
        message: `${pendingTestingUnits} unit(s) are not released because testing is pending.`,
      });
    }
    if (quarantinedUnits > 0) {
      anomalies.push({
        kind: "QUARANTINED",
        bloodGroup,
        message: `${quarantinedUnits} unit(s) are quarantined and excluded from usable stock.`,
      });
    }
    if (expiryRiskUnits > 0) {
      anomalies.push({
        kind: "EXPIRY_RISK",
        bloodGroup,
        message: `${expiryRiskUnits} verified unit(s) may expire within 7 days beyond the projected demand.`,
      });
    }
    for (const change of input.recentChanges) {
      if (change.bloodGroup === bloodGroup && change.unitsDelta >= 10) {
        anomalies.push({
          kind: "LARGE_CHANGE",
          bloodGroup,
          message: `A reported stock increase of ${change.unitsDelta} unit(s) needs staff review.`,
          createdAt: change.createdAt,
        });
      }
    }

    return {
      bloodGroup,
      reportedUnits,
      trackedUnits,
      unverifiedUnits,
      verifiedUsableUnits,
      pendingTestingUnits,
      reservedUnits,
      expiredUnits,
      quarantinedUnits,
      projectedSevenDayDemand,
      projectedShortage: Math.max(
        0,
        projectedSevenDayDemand - verifiedUsableUnits,
      ),
      expiryRiskUnits,
      confidenceScore,
      confidence,
      lastReportedAt: inventory?.updatedAt ?? null,
      lastVerifiedAt: oldestVerifiedAt,
      anomalies,
    };
  });
}
