import twilio from "twilio";

export type TwilioFeatureStatus = {
  configured: boolean;
  missingVariables: string[];
};

export function getTwilioConfigurationStatus(): {
  voice: TwilioFeatureStatus;
  sms: TwilioFeatureStatus;
} {
  const credentialsMissing = [
    ...(!process.env.TWILIO_ACCOUNT_SID ? ["TWILIO_ACCOUNT_SID"] : []),
    ...(!process.env.TWILIO_AUTH_TOKEN ? ["TWILIO_AUTH_TOKEN"] : []),
  ];
  let validPublicAppUrl = false;
  try {
    const url = new URL(process.env.APP_URL ?? "");
    validPublicAppUrl =
      url.protocol === "https:" &&
      url.hostname !== "localhost" &&
      url.hostname !== "127.0.0.1";
  } catch {
    validPublicAppUrl = false;
  }

  const voiceMissing = [
    ...credentialsMissing,
    ...(!process.env.TWILIO_PHONE_NUMBER ? ["TWILIO_PHONE_NUMBER"] : []),
    ...(!validPublicAppUrl ? ["APP_URL (public HTTPS URL required)"] : []),
  ];
  const smsMissing = [
    ...credentialsMissing,
    ...(!process.env.TWILIO_MESSAGING_SERVICE_SID &&
    !process.env.TWILIO_PHONE_NUMBER
      ? ["TWILIO_MESSAGING_SERVICE_SID or TWILIO_PHONE_NUMBER"]
      : []),
  ];

  return {
    voice: { configured: voiceMissing.length === 0, missingVariables: voiceMissing },
    sms: { configured: smsMissing.length === 0, missingVariables: smsMissing },
  };
}

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
  const url = new URL(path, baseUrl);
  if (url.protocol !== "https:") {
    throw new Error("APP_URL must use HTTPS for Twilio callbacks.");
  }
  return url.toString();
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
