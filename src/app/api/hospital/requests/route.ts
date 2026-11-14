import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { dispatchRequest } from "@/lib/dispatch";
import { hospitalForRequest } from "@/lib/auth";
import { sendEmergencySmsAlerts } from "@/lib/notifications";
import { getTwilioConfigurationStatus } from "@/lib/twilio";
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
            select: { id: true, name: true, phone: true, address: true, bloodGroup: true },
          },
          locationTracking: {
            orderBy: { recordedAt: "desc" },
            take: 1,
          },
        },
      },
      smsLogs: { select: { status: true } },
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
      smsSent: request.smsLogs.filter((log) => log.status === "SENT").length,
      smsFailed: request.smsLogs.filter((log) => log.status === "FAILED").length,
      smsQueued: request.smsLogs.filter((log) => log.status === "QUEUED").length,
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
          phone: call.donor.phone,
          address: call.donor.address,
          bloodGroup: call.donor.bloodGroup,
          status: call.status,
          distanceKm: distanceKm !== null ? Number(distanceKm.toFixed(1)) : null,
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
  if (!hospital.address) {
    return NextResponse.json(
      { error: "Add the hospital address before requesting donors." },
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

  const warnings: string[] = [];
  const voiceStatus = getTwilioConfigurationStatus().voice;
  let startedCalls = 0;
  try {
    const outcome = await dispatchRequest(created.id);
    startedCalls = outcome.startedCalls;
    if (outcome.failedCalls > 0) {
      warnings.push(`${outcome.failedCalls} donor call(s) could not start.`);
    }
    if (outcome.startedCalls === 0) {
      warnings.push("No eligible, call-consented donors were available.");
    }
  } catch (error) {
    console.error(`Unable to dispatch request ${created.id}:`, error);
    warnings.push(
      voiceStatus.configured
        ? "Twilio could not start donor calls. Review provider logs and retry dispatch."
        : `Voice IVR is not configured. Add ${voiceStatus.missingVariables.join(", ")} in the server environment, then retry dispatch.`,
    );
  }

  try {
    const alerts = await sendEmergencySmsAlerts(created.id);
    if (!alerts.missingVariables.length && alerts.eligible > 0) {
      if (alerts.sent > 0) {
        warnings.push(`${alerts.sent} opted-in donor SMS alert(s) sent.`);
      }
      if (alerts.failed > 0) {
        warnings.push(`${alerts.failed} opted-in donor SMS alert(s) failed.`);
      }
    } else if (alerts.missingVariables.length && alerts.eligible > 0) {
      warnings.push(
        `SMS alerts are not configured. Add ${alerts.missingVariables.join(", ")} in the server environment.`,
      );
    } else if (alerts.eligible === 0) {
      warnings.push("No donors have opted in to SMS alerts for this blood group.");
    }
  } catch (error) {
    console.error(`Unable to send SMS alerts for request ${created.id}:`, error);
    warnings.push("SMS alerts could not be completed. Review provider logs.");
  }

  const contactedDonors = await db.callLog.findMany({
    where: { emergencyRequestId: created.id },
    include: {
      donor: { select: { id: true, name: true, phone: true, bloodGroup: true, address: true } },
    },
  });

  return NextResponse.json(
    {
      id: created.id,
      startedCalls,
      matchedDonors: contactedDonors.map((c) => ({
        id: c.donor.id,
        name: c.donor.name,
        phone: c.donor.phone,
        bloodGroup: c.donor.bloodGroup,
        address: c.donor.address,
      })),
      ...(warnings.length ? { warning: warnings.join(" ") } : {}),
    },
    { status: 201 },
  );
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
