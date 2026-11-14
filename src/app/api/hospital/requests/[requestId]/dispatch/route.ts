import { NextRequest, NextResponse } from "next/server";
import { hospitalForRequest } from "@/lib/auth";
import { db } from "@/lib/db";
import { dispatchRequest } from "@/lib/dispatch";
import { sendEmergencySmsAlerts } from "@/lib/notifications";
import { getTwilioConfigurationStatus } from "@/lib/twilio";

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ requestId: string }> },
) {
  const hospital = await hospitalForRequest();
  if (!hospital) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { requestId } = await context.params;
  const emergencyRequest = await db.emergencyRequest.findFirst({
    where: { id: requestId, hospitalId: hospital.id },
    select: { id: true, state: true },
  });
  if (!emergencyRequest) {
    return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }
  if (emergencyRequest.state !== "OPEN") {
    return NextResponse.json(
      { error: "Only open emergency requests can be dispatched." },
      { status: 409 },
    );
  }

  const voiceStatus = getTwilioConfigurationStatus().voice;
  if (!voiceStatus.configured) {
    return NextResponse.json(
      {
        error: `Voice IVR is not configured. Add ${voiceStatus.missingVariables.join(", ")} in the server environment.`,
      },
      { status: 503 },
    );
  }

  try {
    const outcome = await dispatchRequest(requestId);
    let smsSent = 0;
    let smsFailed = 0;
    let smsWarning: string | undefined;
    try {
      const alerts = await sendEmergencySmsAlerts(requestId);
      smsSent = alerts.sent;
      smsFailed = alerts.failed;
      if (alerts.missingVariables.length) {
        smsWarning = `SMS alerts are not configured. Add ${alerts.missingVariables.join(", ")} in the server environment.`;
      }
    } catch (error) {
      console.error(`Unable to retry SMS alerts for request ${requestId}:`, error);
      smsWarning = "SMS alerts could not be completed. Review provider logs.";
    }
    return NextResponse.json({
      ...outcome,
      smsSent,
      smsFailed,
      ...(smsWarning ? { smsWarning } : {}),
      ...(outcome.startedCalls === 0
        ? { warning: "No new eligible, call-consented donors were available." }
        : {}),
    });
  } catch (error) {
    console.error(`Unable to retry dispatch for request ${requestId}:`, error);
    return NextResponse.json(
      { error: "Twilio could not start donor calls. Review provider logs and retry." },
      { status: 503 },
    );
  }
}
