import { NextRequest, NextResponse } from "next/server";
import { handleCallStatus } from "@/lib/dispatch";
import { validateTwilioRequest } from "@/lib/twilio";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") params[key] = value;
  }
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
  const callSid = params.CallSid;
  const status = params.CallStatus;
  if (!callLogId || !callSid || !status) {
    return NextResponse.json({ error: "Missing call status fields." }, { status: 400 });
  }

  await handleCallStatus(callLogId, status, callSid);
  return new Response(null, { status: 204 });
}
