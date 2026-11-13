import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { dispatchRequest } from "@/lib/dispatch";
import { hospitalForRequest } from "@/lib/auth";
import { emergencyRequestSchema } from "@/lib/validation";

export async function GET() {
  const hospital = await hospitalForRequest();
  if (!hospital) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const requests = await db.emergencyRequest.findMany({
    where: { hospitalId: hospital.id },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: {
      callLogs: {
        orderBy: { updatedAt: "desc" },
        include: {
          donor: {
            select: { id: true, name: true, bloodGroup: true },
          },
          locationTracking: {
            orderBy: { recordedAt: "desc" },
            take: 1,
          },
        },
      },
    },
  });

  return NextResponse.json({
    requests: requests.map((request) => ({
      id: request.id,
      bloodGroup: request.bloodGroup,
      unitsRequired: request.unitsRequired,
      unitsConfirmed: request.unitsConfirmed,
      state: request.state,
      createdAt: request.createdAt,
      donors: request.callLogs.map((call) => {
        const location =
          call.status === "ACCEPTED" &&
          hospital.latitude !== null &&
          hospital.longitude !== null
            ? call.locationTracking[0]
            : undefined;
        const distanceKm =
          location && hospital.latitude !== null && hospital.longitude !== null
          ? distanceInKm(
              location.latitude,
              location.longitude,
              hospital.latitude,
              hospital.longitude,
            )
          : null;
        return {
          id: call.donor.id,
          name: call.donor.name,
          bloodGroup: call.donor.bloodGroup,
          status: call.status,
          location: location
            ? {
                latitude: location.latitude,
                longitude: location.longitude,
                recordedAt: location.recordedAt,
                accuracyMeters: location.accuracyMeters,
                etaMinutes: Math.ceil((distanceKm! / 25) * 60) + 5,
              }
            : null,
        };
      }),
    })),
  });
}

export async function POST(request: NextRequest) {
  const hospital = await hospitalForRequest();
  if (!hospital) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (hospital.latitude === null || hospital.longitude === null || !hospital.address) {
    return NextResponse.json(
      { error: "Add the hospital address and map coordinates before requesting donors." },
      { status: 409 },
    );
  }

  const parsed = emergencyRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Choose a valid blood group and a unit count between 1 and 20." },
      { status: 400 },
    );
  }

  const created = await db.emergencyRequest.create({
    data: {
      hospitalId: hospital.id,
      bloodGroup: parsed.data.bloodGroup,
      unitsRequired: parsed.data.unitsRequired,
    },
    select: { id: true },
  });

  try {
    const outcome = await dispatchRequest(created.id);
    if (outcome.startedCalls === 0) {
      return NextResponse.json(
        {
          id: created.id,
          warning: "No eligible nearby donors were available to call.",
        },
        { status: 201 },
      );
    }
  } catch (error) {
    console.error(`Unable to dispatch request ${created.id}:`, error);
    return NextResponse.json(
      {
        id: created.id,
        error: "The request was saved, but no donor calls could start. Check IVR configuration.",
      },
      { status: 503 },
    );
  }

  return NextResponse.json({ id: created.id }, { status: 201 });
}

function distanceInKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latDelta = radians(lat2 - lat1);
  const lonDelta = radians(lon2 - lon1);
  const value =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(radians(lat1)) *
      Math.cos(radians(lat2)) *
      Math.sin(lonDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}
