import { BloodGroup, Prisma } from "@prisma/client";

type RawQueryClient = Pick<Prisma.TransactionClient, "$queryRaw">;

export type NearbyDonor = {
  id: string;
  name: string;
  phone: string;
  latitude: number;
  longitude: number;
  distanceKm: number;
};

export async function findNearbyDonors(
  tx: RawQueryClient,
  input: {
    bloodGroup: BloodGroup;
    latitude: number;
    longitude: number;
    limit: number;
    emergencyRequestId?: string;
  },
): Promise<NearbyDonor[]> {
  return tx.$queryRaw<NearbyDonor[]>(Prisma.sql`
    SELECT d."id", d."name", d."phone", d."latitude", d."longitude",
      6371 * 2 * ASIN(SQRT(
          POWER(SIN(RADIANS(d."latitude" - ${input.latitude}) / 2), 2)
          + COS(RADIANS(${input.latitude}))
          * COS(RADIANS(d."latitude"))
          * POWER(SIN(RADIANS(d."longitude" - ${input.longitude}) / 2), 2)
        )) AS "distanceKm"
    FROM "Donor" d
    WHERE d."bloodGroup" = ${input.bloodGroup}::"BloodGroup"
      AND d."available" = true
      AND d."trackingConsent" = true
      AND d."latitude" IS NOT NULL
      AND d."longitude" IS NOT NULL
      AND d."latitude" BETWEEN ${Math.max(-90, input.latitude - 5 / 110.574)}
        AND ${Math.min(90, input.latitude + 5 / 110.574)}
      AND 6371 * 2 * ASIN(SQRT(
        POWER(SIN(RADIANS(d."latitude" - ${input.latitude}) / 2), 2)
        + COS(RADIANS(${input.latitude}))
        * COS(RADIANS(d."latitude"))
        * POWER(SIN(RADIANS(d."longitude" - ${input.longitude}) / 2), 2)
      )) <= 5
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
    ORDER BY "distanceKm"
    LIMIT ${input.limit}
    FOR UPDATE OF d SKIP LOCKED
  `);
}
