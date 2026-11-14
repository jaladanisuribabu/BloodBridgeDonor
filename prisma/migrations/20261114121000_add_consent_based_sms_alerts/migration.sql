CREATE TYPE "EmergencySmsStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED');

ALTER TABLE "Donor"
  ADD COLUMN "smsConsent" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Donor_bloodGroup_available_callConsent_nextEligibleAt_idx"
  ON "Donor"("bloodGroup", "available", "callConsent", "nextEligibleAt");
CREATE INDEX "Donor_bloodGroup_available_smsConsent_nextEligibleAt_idx"
  ON "Donor"("bloodGroup", "available", "smsConsent", "nextEligibleAt");
CREATE INDEX "CallLog_donorId_status_idx"
  ON "CallLog"("donorId", "status");

CREATE TABLE "EmergencySmsLog" (
  "id" TEXT NOT NULL,
  "emergencyRequestId" TEXT NOT NULL,
  "donorId" TEXT NOT NULL,
  "messageSid" TEXT,
  "status" "EmergencySmsStatus" NOT NULL DEFAULT 'QUEUED',
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmergencySmsLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmergencySmsLog_messageSid_key"
  ON "EmergencySmsLog"("messageSid");
CREATE UNIQUE INDEX "EmergencySmsLog_emergencyRequestId_donorId_key"
  ON "EmergencySmsLog"("emergencyRequestId", "donorId");
CREATE INDEX "EmergencySmsLog_emergencyRequestId_status_idx"
  ON "EmergencySmsLog"("emergencyRequestId", "status");

ALTER TABLE "EmergencySmsLog"
  ADD CONSTRAINT "EmergencySmsLog_emergencyRequestId_fkey"
  FOREIGN KEY ("emergencyRequestId") REFERENCES "EmergencyRequest"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmergencySmsLog"
  ADD CONSTRAINT "EmergencySmsLog_donorId_fkey"
  FOREIGN KEY ("donorId") REFERENCES "Donor"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
