import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { CallLogStatus } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { locationSchema } from "@/lib/validation";

const ACCEPTED_STATUSES = [
  CallLogStatus.ACCEPTED,
] satisfies CallLogStatus[];

export async function POST(request: NextRequest) {
  const bearer = request.headers.get("authorization");
  if (!bearer?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Donor token required." }, { status: 401 });
  }

  const tokenHash = createHash("sha256").update(bearer.slice(7)).digest("hex");
  const donor = await db.donor.findUnique({
    where: { locationTokenHash: tokenHash },
    select: { id: true, trackingConsent: true },
  });
  if (!donor || !donor.trackingConsent) {
    return NextResponse.json({ error: "Donor tracking is not authorized." }, { status: 403 });
  }

  const parsed = locationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid location coordinates." }, { status: 400 });
  }

  const activeCall = await db.callLog.findFirst({
    where: { donorId: donor.id, status: { in: ACCEPTED_STATUSES } },
    orderBy: { updatedAt: "desc" },
    select: { id: true, emergencyRequestId: true },
  });
  if (!activeCall) {
    return NextResponse.json({ error: "No accepted emergency is being tracked." }, { status: 409 });
  }

  const { latitude, longitude, accuracyMeters } = parsed.data;
  await db.$transaction([
    db.donor.update({
      where: { id: donor.id },
      data: { latitude, longitude },
    }),
    db.locationTracking.create({
      data: {
        emergencyRequestId: activeCall.emergencyRequestId,
        callLogId: activeCall.id,
        donorId: donor.id,
        latitude,
        longitude,
        accuracyMeters,
      },
    }),
  ]);
  return NextResponse.json({ ok: true });
}

export async function PATCH(request: NextRequest) {
  const bearer = request.headers.get("authorization");
  if (!bearer?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Donor token required." }, { status: 401 });
  }
  const tokenHash = createHash("sha256").update(bearer.slice(7)).digest("hex");
  const donor = await db.donor.findUnique({
    where: { locationTokenHash: tokenHash },
    select: { id: true },
  });
  if (!donor) return NextResponse.json({ error: "Donor token is invalid." }, { status: 401 });

  const parsed = zAvailability.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Availability must be true or false." }, { status: 400 });
  }
  const activeCall = await db.callLog.findFirst({
    where: { donorId: donor.id, status: CallLogStatus.ACCEPTED },
    select: { id: true },
  });
  if (activeCall && !parsed.data.available) {
    return NextResponse.json(
      { error: "Complete the accepted emergency before changing availability." },
      { status: 409 },
    );
  }
  await db.donor.update({
    where: { id: donor.id },
    data: { available: parsed.data.available },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const bearer = request.headers.get("authorization");
  if (!bearer?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Donor token required." }, { status: 401 });
  }
  const tokenHash = createHash("sha256").update(bearer.slice(7)).digest("hex");
  const donor = await db.donor.findUnique({
    where: { locationTokenHash: tokenHash },
    select: { id: true },
  });
  if (!donor) return NextResponse.json({ error: "Donor token is invalid." }, { status: 401 });

  await db.$transaction([
    db.donor.update({
      where: { id: donor.id },
      data: { trackingConsent: false, latitude: null, longitude: null },
    }),
    db.locationTracking.deleteMany({ where: { donorId: donor.id } }),
  ]);
  return NextResponse.json({ ok: true });
}

const zAvailability = z.object({ available: z.boolean() });
