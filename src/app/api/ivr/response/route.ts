import { NextRequest } from "next/server";
import twilio from "twilio";
import {
  markDonorAccepted,
  markDonorNoAnswer,
  markDonorUnavailable,
} from "@/lib/dispatch";
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

  const digit = params.Digits;
  const voice = new twilio.twiml.VoiceResponse();
  if (digit === "1") {
    await markDonorAccepted(callLogId);
    voice.say("Thank you. Your availability has been confirmed with the hospital.");
  } else if (digit === "2") {
    await markDonorUnavailable(callLogId);
    voice.say("Thank you for responding. Goodbye.");
  } else {
    await markDonorNoAnswer(callLogId);
    voice.say("We did not receive a valid response. Goodbye.");
  }
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
