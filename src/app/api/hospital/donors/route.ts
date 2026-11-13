import { NextRequest, NextResponse } from "next/server";
import { hospitalForRequest } from "@/lib/auth";
import { db } from "@/lib/db";
import { findNearbyDonors } from "@/lib/proximity";
import { bloodGroupSchema } from "@/lib/validation";

export async function GET(request: NextRequest) {
  const hospital = await hospitalForRequest();
  if (!hospital) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const bloodGroup = bloodGroupSchema.safeParse(params.get("bloodGroup"));
  if (!bloodGroup.success) {
    return NextResponse.json({ error: "A valid bloodGroup query is required." }, { status: 400 });
  }
  const emergencyRequestId = params.get("requestId") || undefined;
  if (emergencyRequestId) {
    const ownedRequest = await db.emergencyRequest.findFirst({
      where: { id: emergencyRequestId, hospitalId: hospital.id },
      select: { id: true },
    });
    if (!ownedRequest) return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }

  const donors = await db.$transaction((tx) =>
    findNearbyDonors(tx, {
      bloodGroup: bloodGroup.data,
      latitude: hospital.latitude,
      longitude: hospital.longitude,
      limit: 100,
      emergencyRequestId,
    }),
  );
  return NextResponse.json({
    donors: donors.map(({ id, name, distanceKm }) => ({
      id,
      name,
      distanceKm: Math.round(distanceKm * 100) / 100,
    })),
    radiusKm: 5,
  });
}
