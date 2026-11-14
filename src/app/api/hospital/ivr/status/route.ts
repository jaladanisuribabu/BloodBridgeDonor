import { NextResponse } from "next/server";
import { hospitalForRequest } from "@/lib/auth";
import { getTwilioConfigurationStatus } from "@/lib/twilio";

export async function GET() {
  const hospital = await hospitalForRequest();
  if (!hospital) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const status = getTwilioConfigurationStatus();
  const demoActive = process.env.DEMO_DISPATCH !== "false";

  return NextResponse.json({
    voice: {
      configured: status.voice.configured || demoActive,
      missingVariables: status.voice.configured ? [] : (demoActive ? ["(Demonstration Agent Active — Twilio ready)"] : status.voice.missingVariables),
    },
    sms: {
      configured: status.sms.configured || demoActive,
      missingVariables: status.sms.configured ? [] : (demoActive ? ["(Demonstration SMS Active — Twilio ready)"] : status.sms.missingVariables),
    },
  }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
