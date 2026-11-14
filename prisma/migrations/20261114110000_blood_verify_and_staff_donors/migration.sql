CREATE TYPE "BloodUnitStatus" AS ENUM (
  'PENDING_TESTING',
  'AVAILABLE',
  'RESERVED',
  'ISSUED',
  'QUARANTINED'
);

ALTER TABLE "Donor"
  ADD COLUMN "callConsent" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "address" TEXT,
  ADD COLUMN "registeredByHospitalId" TEXT;

UPDATE "Donor"
SET "callConsent" = "trackingConsent";

CREATE INDEX "Donor_registeredByHospitalId_createdAt_idx"
  ON "Donor"("registeredByHospitalId", "createdAt");

ALTER TABLE "Donor"
  ADD CONSTRAINT "Donor_registeredByHospitalId_fkey"
  FOREIGN KEY ("registeredByHospitalId")
  REFERENCES "Hospital"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

CREATE TABLE "BloodUnit" (
  "id" TEXT NOT NULL,
  "hospitalId" TEXT NOT NULL,
  "donorId" TEXT,
  "bloodGroup" "BloodGroup" NOT NULL,
  "unitCode" TEXT NOT NULL,
  "collectedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "status" "BloodUnitStatus" NOT NULL DEFAULT 'PENDING_TESTING',
  "verifiedAt" TIMESTAMP(3),
  "reservationReference" TEXT,
  "quarantineReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BloodUnit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BloodUnitAudit" (
  "id" TEXT NOT NULL,
  "hospitalId" TEXT NOT NULL,
  "bloodUnitId" TEXT NOT NULL,
  "fromStatus" "BloodUnitStatus",
  "toStatus" "BloodUnitStatus" NOT NULL,
  "reason" TEXT NOT NULL,
  "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BloodUnitAudit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BloodUnit_unitCode_key" ON "BloodUnit"("unitCode");
CREATE INDEX "BloodUnit_hospitalId_bloodGroup_status_expiresAt_idx"
  ON "BloodUnit"("hospitalId", "bloodGroup", "status", "expiresAt");
CREATE INDEX "BloodUnit_donorId_collectedAt_idx"
  ON "BloodUnit"("donorId", "collectedAt");
CREATE INDEX "BloodUnitAudit_hospitalId_changedAt_idx"
  ON "BloodUnitAudit"("hospitalId", "changedAt");
CREATE INDEX "BloodUnitAudit_bloodUnitId_changedAt_idx"
  ON "BloodUnitAudit"("bloodUnitId", "changedAt");

ALTER TABLE "BloodUnit"
  ADD CONSTRAINT "BloodUnit_hospitalId_fkey"
  FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BloodUnit"
  ADD CONSTRAINT "BloodUnit_donorId_fkey"
  FOREIGN KEY ("donorId") REFERENCES "Donor"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BloodUnitAudit"
  ADD CONSTRAINT "BloodUnitAudit_hospitalId_fkey"
  FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BloodUnitAudit"
  ADD CONSTRAINT "BloodUnitAudit_bloodUnitId_fkey"
  FOREIGN KEY ("bloodUnitId") REFERENCES "BloodUnit"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
