import { BloodGroup, Prisma } from "@prisma/client";

type RawQueryClient = Pick<Prisma.TransactionClient, "$queryRaw">;

export type EligibleDonor = {
  id: string;
  name: string;
  phone: string;
  latitude: number | null;
  longitude: number | null;
  distanceKm: number | null;
};

export function buildEligibleDonorQuery(
  input: {
    bloodGroup: BloodGroup;
    latitude: number | null;
    longitude: number | null;
    limit: number;
    emergencyRequestId?: string;
  },
): Prisma.Sql {
  const hasOrigin = input.latitude !== null && input.longitude !== null;
  const distanceExpression = hasOrigin
    ? Prisma.sql`CASE
        WHEN d."latitude" IS NOT NULL AND d."longitude" IS NOT NULL THEN
          6371 * 2 * ASIN(SQRT(
          POWER(SIN(RADIANS(d."latitude" - ${input.latitude}) / 2), 2)
          + COS(RADIANS(${input.latitude}))
          * COS(RADIANS(d."latitude"))
          * POWER(SIN(RADIANS(d."longitude" - ${input.longitude}) / 2), 2)
          ))
        ELSE NULL
      END`
    : Prisma.sql`NULL::double precision`;
  const orderBy = hasOrigin
    ? Prisma.sql`"distanceKm" ASC NULLS LAST, d."createdAt" ASC`
    : Prisma.sql`d."createdAt" ASC`;

  return Prisma.sql`
    SELECT d."id", d."name", d."phone", d."latitude", d."longitude",
      ${distanceExpression} AS "distanceKm"
    FROM "Donor" d
    WHERE d."bloodGroup" = ${input.bloodGroup}::"BloodGroup"
      AND d."available" = true
      AND d."callConsent" = true
      AND (d."nextEligibleAt" IS NULL OR d."nextEligibleAt" <= CURRENT_TIMESTAMP)
      AND NOT EXISTS (
        SELECT 1 FROM "CallLog" c
        WHERE c."donorId" = d."id"
          AND c."status" IN ('QUEUED', 'INITIATED', 'RINGING', 'IN_PROGRESS', 'ACCEPTED')
      )
      ${input.emergencyRequestId
        ? Prisma.sql`AND NOT EXISTS (
            SELECT 1 FROM "CallLog" prior
            WHERE prior."emergencyRequestId" = ${input.emergencyRequestId}
              AND prior."donorId" = d."id"
          )`
        : Prisma.empty}
    ORDER BY ${orderBy}
    LIMIT ${input.limit}
    FOR UPDATE OF d SKIP LOCKED
  `;
}

export async function findEligibleDonors(
  tx: RawQueryClient,
  input: {
    bloodGroup: BloodGroup;
    latitude: number | null;
    longitude: number | null;
    limit: number;
    emergencyRequestId?: string;
  },
): Promise<EligibleDonor[]> {
  return tx.$queryRaw<EligibleDonor[]>(buildEligibleDonorQuery(input));
}
