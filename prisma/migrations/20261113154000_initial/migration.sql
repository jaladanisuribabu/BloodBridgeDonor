CREATE TYPE "BloodGroup" AS ENUM ('O_NEGATIVE', 'O_POSITIVE', 'A_NEGATIVE', 'A_POSITIVE', 'B_NEGATIVE', 'B_POSITIVE', 'AB_NEGATIVE', 'AB_POSITIVE');
CREATE TYPE "RequestState" AS ENUM ('OPEN', 'FULFILLED', 'CANCELLED');
CREATE TYPE "CallLogStatus" AS ENUM ('QUEUED', 'INITIATED', 'RINGING', 'IN_PROGRESS', 'ACCEPTED', 'COMPLETED', 'UNAVAILABLE', 'NO_ANSWER', 'FAILED', 'CANCELLED');

CREATE TABLE "Donor" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "bloodGroup" "BloodGroup" NOT NULL,
  "available" BOOLEAN NOT NULL DEFAULT true,
  "trackingConsent" BOOLEAN NOT NULL DEFAULT false,
  "locationTokenHash" TEXT NOT NULL,
  "latitude" DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Donor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Hospital" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "latitude" DOUBLE PRECISION NOT NULL,
  "longitude" DOUBLE PRECISION NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Hospital_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BloodInventory" (
  "id" TEXT NOT NULL,
  "hospitalId" TEXT NOT NULL,
  "bloodGroup" "BloodGroup" NOT NULL,
  "unitsAvailable" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BloodInventory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmergencyRequest" (
  "id" TEXT NOT NULL,
  "hospitalId" TEXT NOT NULL,
  "bloodGroup" "BloodGroup" NOT NULL,
  "unitsRequired" INTEGER NOT NULL,
  "unitsConfirmed" INTEGER NOT NULL DEFAULT 0,
  "state" "RequestState" NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmergencyRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CallLog" (
  "id" TEXT NOT NULL,
  "emergencyRequestId" TEXT NOT NULL,
  "donorId" TEXT NOT NULL,
  "twilioCallSid" TEXT,
  "status" "CallLogStatus" NOT NULL DEFAULT 'QUEUED',
  "responseDigit" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CallLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LocationTracking" (
  "id" TEXT NOT NULL,
  "emergencyRequestId" TEXT NOT NULL,
  "callLogId" TEXT NOT NULL,
  "donorId" TEXT NOT NULL,
  "latitude" DOUBLE PRECISION NOT NULL,
  "longitude" DOUBLE PRECISION NOT NULL,
  "accuracyMeters" DOUBLE PRECISION,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LocationTracking_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Donor_phone_key" ON "Donor"("phone");
CREATE UNIQUE INDEX "Donor_locationTokenHash_key" ON "Donor"("locationTokenHash");
CREATE INDEX "Donor_bloodGroup_available_trackingConsent_idx" ON "Donor"("bloodGroup", "available", "trackingConsent");
CREATE UNIQUE INDEX "Hospital_email_key" ON "Hospital"("email");
CREATE UNIQUE INDEX "BloodInventory_hospitalId_bloodGroup_key" ON "BloodInventory"("hospitalId", "bloodGroup");
CREATE INDEX "EmergencyRequest_hospitalId_state_createdAt_idx" ON "EmergencyRequest"("hospitalId", "state", "createdAt");
CREATE UNIQUE INDEX "CallLog_twilioCallSid_key" ON "CallLog"("twilioCallSid");
CREATE UNIQUE INDEX "CallLog_emergencyRequestId_donorId_key" ON "CallLog"("emergencyRequestId", "donorId");
CREATE INDEX "CallLog_emergencyRequestId_status_idx" ON "CallLog"("emergencyRequestId", "status");
CREATE INDEX "LocationTracking_emergencyRequestId_donorId_recordedAt_idx" ON "LocationTracking"("emergencyRequestId", "donorId", "recordedAt");

ALTER TABLE "EmergencyRequest" ADD CONSTRAINT "EmergencyRequest_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BloodInventory" ADD CONSTRAINT "BloodInventory_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CallLog" ADD CONSTRAINT "CallLog_emergencyRequestId_fkey" FOREIGN KEY ("emergencyRequestId") REFERENCES "EmergencyRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CallLog" ADD CONSTRAINT "CallLog_donorId_fkey" FOREIGN KEY ("donorId") REFERENCES "Donor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LocationTracking" ADD CONSTRAINT "LocationTracking_emergencyRequestId_fkey" FOREIGN KEY ("emergencyRequestId") REFERENCES "EmergencyRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LocationTracking" ADD CONSTRAINT "LocationTracking_callLogId_fkey" FOREIGN KEY ("callLogId") REFERENCES "CallLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LocationTracking" ADD CONSTRAINT "LocationTracking_donorId_fkey" FOREIGN KEY ("donorId") REFERENCES "Donor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
