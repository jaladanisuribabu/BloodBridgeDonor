ALTER TABLE "Hospital"
  ADD COLUMN "city" TEXT,
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "donationIntervalMonths" INTEGER;

ALTER TABLE "Donor"
  ADD COLUMN "nextEligibleAt" TIMESTAMP(3);

CREATE TABLE "PatientAccount" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "city" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PatientAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PatientCase" (
  "id" TEXT NOT NULL,
  "hospitalId" TEXT NOT NULL,
  "patientName" TEXT NOT NULL,
  "patientReference" TEXT,
  "bloodGroup" "BloodGroup" NOT NULL,
  "unitsRequired" INTEGER NOT NULL,
  "unitsIssued" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PatientCase_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InventoryChange" (
  "id" TEXT NOT NULL,
  "hospitalId" TEXT NOT NULL,
  "bloodGroup" "BloodGroup" NOT NULL,
  "unitsDelta" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "patientCaseId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryChange_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DonorDonation" (
  "id" TEXT NOT NULL,
  "donorId" TEXT NOT NULL,
  "hospitalId" TEXT NOT NULL,
  "donatedAt" TIMESTAMP(3) NOT NULL,
  "nextEligibleAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DonorDonation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PatientAccount_email_key" ON "PatientAccount"("email");
CREATE INDEX "PatientCase_hospitalId_status_createdAt_idx" ON "PatientCase"("hospitalId", "status", "createdAt");
CREATE INDEX "InventoryChange_hospitalId_createdAt_idx" ON "InventoryChange"("hospitalId", "createdAt");
CREATE INDEX "DonorDonation_donorId_donatedAt_idx" ON "DonorDonation"("donorId", "donatedAt");
CREATE INDEX "DonorDonation_hospitalId_donatedAt_idx" ON "DonorDonation"("hospitalId", "donatedAt");

ALTER TABLE "PatientCase"
  ADD CONSTRAINT "PatientCase_hospitalId_fkey"
  FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryChange"
  ADD CONSTRAINT "InventoryChange_hospitalId_fkey"
  FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryChange"
  ADD CONSTRAINT "InventoryChange_patientCaseId_fkey"
  FOREIGN KEY ("patientCaseId") REFERENCES "PatientCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DonorDonation"
  ADD CONSTRAINT "DonorDonation_donorId_fkey"
  FOREIGN KEY ("donorId") REFERENCES "Donor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DonorDonation"
  ADD CONSTRAINT "DonorDonation_hospitalId_fkey"
  FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE CASCADE ON UPDATE CASCADE;
