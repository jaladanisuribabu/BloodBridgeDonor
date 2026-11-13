import twilio from "twilio";

export function getTwilioClient() {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    throw new Error("Twilio credentials are not configured.");
  }
  return twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
}

export function appUrl(path: string): string {
  const baseUrl = process.env.APP_URL;
  if (!baseUrl) throw new Error("APP_URL is not configured.");
  return new URL(path, baseUrl).toString();
}

export function validateTwilioRequest(
  url: string,
  signature: string | null,
  params: Record<string, string>,
): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken || !signature) return false;
  return twilio.validateRequest(authToken, signature, url, params);
}

export function twimlResponse(xml: string): Response {
  return new Response(xml, {
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}
