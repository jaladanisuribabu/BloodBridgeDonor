import { NextRequest } from "next/server";
import twilio from "twilio";
import { db } from "@/lib/db";
import { twimlResponse, validateTwilioRequest } from "@/lib/twilio";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const params = formToRecord(form);
  if (
    !validateTwilioRequest(
      request.url,
      request.headers.get("x-twilio-signature"),
      params,
    )
  ) {
    return new Response("Forbidden", { status: 403 });
  }

  const callLogId = request.nextUrl.searchParams.get("callLogId");
  if (!callLogId) return new Response("Missing call reference", { status: 400 });
  const call = await db.callLog.findUnique({
    where: { id: callLogId },
    include: { emergencyRequest: { include: { hospital: true } } },
  });
  if (!call) return new Response("Call not found", { status: 404 });

  const voice = new twilio.twiml.VoiceResponse();
  const gather = voice.gather({
    numDigits: 1,
    timeout: 15,
    actionOnEmptyResult: true,
    method: "POST",
    action: `/api/ivr/response?callLogId=${encodeURIComponent(callLogId)}`,
  });
  gather.say(
    `This is an emergency blood donation request from ${call.emergencyRequest.hospital.name}, ` +
      `located at ${call.emergencyRequest.hospital.address}. ` +
      `The requested blood type is ${call.emergencyRequest.bloodGroup.replaceAll("_", " ")}. ` +
      "Press 1 if you are available to donate. Press 2 if you are not available.",
  );
  voice.hangup();
  return twimlResponse(voice.toString());
}

function formToRecord(form: FormData): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") result[key] = value;
  }
  return result;
}
