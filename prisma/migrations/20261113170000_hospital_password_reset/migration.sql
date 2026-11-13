CREATE TABLE "HospitalPasswordReset" (
  "id" TEXT NOT NULL,
  "hospitalId" TEXT,
  "emailHash" TEXT NOT NULL,
  "ipHash" TEXT NOT NULL,
  "tokenHash" TEXT,
  "expiresAt" TIMESTAMP(3),
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HospitalPasswordReset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HospitalPasswordReset_tokenHash_key" ON "HospitalPasswordReset"("tokenHash");
CREATE INDEX "HospitalPasswordReset_emailHash_createdAt_idx" ON "HospitalPasswordReset"("emailHash", "createdAt");
CREATE INDEX "HospitalPasswordReset_ipHash_createdAt_idx" ON "HospitalPasswordReset"("ipHash", "createdAt");
CREATE INDEX "HospitalPasswordReset_createdAt_idx" ON "HospitalPasswordReset"("createdAt");

ALTER TABLE "HospitalPasswordReset"
ADD CONSTRAINT "HospitalPasswordReset_hospitalId_fkey"
FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE CASCADE ON UPDATE CASCADE;
