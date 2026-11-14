import assert from "node:assert/strict";
import test from "node:test";
import { getTwilioConfigurationStatus } from "@/lib/twilio";

const variableNames = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_PHONE_NUMBER",
  "TWILIO_MESSAGING_SERVICE_SID",
  "APP_URL",
] as const;

test("reports missing Twilio variable names without exposing values", () => {
  const originalValues = variableNames.map((name) => process.env[name]);
  try {
    for (const name of variableNames) delete process.env[name];
    const status = getTwilioConfigurationStatus();

    assert.equal(status.voice.configured, false);
    assert.deepEqual(status.voice.missingVariables, [
      "TWILIO_ACCOUNT_SID",
      "TWILIO_AUTH_TOKEN",
      "TWILIO_PHONE_NUMBER",
      "APP_URL (public HTTPS URL required)",
    ]);
    assert.equal(status.sms.configured, false);
    assert.deepEqual(status.sms.missingVariables, [
      "TWILIO_ACCOUNT_SID",
      "TWILIO_AUTH_TOKEN",
      "TWILIO_MESSAGING_SERVICE_SID or TWILIO_PHONE_NUMBER",
    ]);
  } finally {
    variableNames.forEach((name, index) => {
      const value = originalValues[index];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    });
  }
});

test("recognizes independently configured voice and SMS features", () => {
  const originalValues = variableNames.map((name) => process.env[name]);
  try {
    process.env.TWILIO_ACCOUNT_SID = "configured";
    process.env.TWILIO_AUTH_TOKEN = "configured";
    process.env.TWILIO_PHONE_NUMBER = "configured";
    process.env.TWILIO_MESSAGING_SERVICE_SID = "";
    process.env.APP_URL = "https://bloodbridge.example";
    const status = getTwilioConfigurationStatus();

    assert.equal(status.voice.configured, true);
    assert.equal(status.sms.configured, true);
    assert.deepEqual(status.voice.missingVariables, []);
    assert.deepEqual(status.sms.missingVariables, []);
  } finally {
    variableNames.forEach((name, index) => {
      const value = originalValues[index];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    });
  }
});
