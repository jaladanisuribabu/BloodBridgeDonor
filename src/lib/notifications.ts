import {
  EmergencySmsStatus,
  Prisma,
} from "@prisma/client";
import { db } from "@/lib/db";
import { getTwilioClient, getTwilioConfigurationStatus } from "@/lib/twilio";

export type EmergencySmsOutcome = {
  eligible: number;
  sent: number;
  failed: number;
  skipped: number;
  missingVariables: string[];
};

export async function sendEmergencySmsAlerts(
  emergencyRequestId: string,
): Promise<EmergencySmsOutcome> {
  const emergencyRequest = await db.emergencyRequest.findUnique({
    where: { id: emergencyRequestId },
    include: {
      hospital: { select: { name: true, phone: true } },
    },
  });
  if (!emergencyRequest) throw new Error("Emergency request was not found.");

  const donors = await db.donor.findMany({
    where: {
      bloodGroup: emergencyRequest.bloodGroup,
      available: true,
      smsConsent: true,
      OR: [
        { nextEligibleAt: null },
        { nextEligibleAt: { lte: new Date() } },
      ],
    },
    select: { id: true, phone: true },
  });
  const smsStatus = getTwilioConfigurationStatus().sms;
  const isDemo = !smsStatus.configured && process.env.DEMO_DISPATCH !== "false";
  const outcome: EmergencySmsOutcome = {
    eligible: donors.length,
    sent: 0,
    failed: 0,
    skipped: 0,
    missingVariables: isDemo ? [] : smsStatus.missingVariables,
  };
  if (!smsStatus.configured && !isDemo) {
    outcome.skipped = donors.length;
    return outcome;
  }

  if (isDemo) {
    for (const donor of donors) {
      try {
        await db.emergencySmsLog.create({
          data: {
            emergencyRequestId,
            donorId: donor.id,
            status: EmergencySmsStatus.SENT,
            messageSid: `demo-sms-${donor.id}-${Date.now()}`,
          },
        });
      } catch {
        // ignore duplicate log
      }
    }
    outcome.sent = donors.length;
    return outcome;
  }

  const client = getTwilioClient();
  const contact = emergencyRequest.hospital.phone
    ? ` Contact ${emergencyRequest.hospital.phone}`
    : " Contact the hospital";
  const message = `BloodBridge emergency: ${emergencyRequest.bloodGroup.replaceAll("_", " ")} blood is needed at ${emergencyRequest.hospital.name}.${contact} if willing and eligible. Do not travel without hospital confirmation.`;

  for (let offset = 0; offset < donors.length; offset += 5) {
    const currentRequest = await db.emergencyRequest.findUnique({
      where: { id: emergencyRequestId },
      select: { state: true, unitsConfirmed: true, unitsRequired: true },
    });
    if (
      !currentRequest ||
      currentRequest.state !== "OPEN" ||
      currentRequest.unitsConfirmed >= currentRequest.unitsRequired
    ) {
      outcome.skipped += donors.length - offset;
      break;
    }

    const batch = donors.slice(offset, offset + 5);
    await Promise.all(batch.map(async (donor) => {
      const stillConsented = await db.donor.findFirst({
        where: {
          id: donor.id,
          bloodGroup: emergencyRequest.bloodGroup,
          available: true,
          smsConsent: true,
          OR: [
            { nextEligibleAt: null },
            { nextEligibleAt: { lte: new Date() } },
          ],
        },
        select: { id: true },
      });
      if (!stillConsented) {
        outcome.skipped += 1;
        return;
      }

      let logId: string;
      try {
        const log = await db.emergencySmsLog.create({
          data: { emergencyRequestId, donorId: donor.id },
          select: { id: true },
        });
        logId = log.id;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          outcome.skipped += 1;
          return;
        }
        throw error;
      }

      try {
        const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
        const from = process.env.TWILIO_PHONE_NUMBER;
        const sent = await client.messages.create({
          to: donor.phone,
          ...(messagingServiceSid
            ? { messagingServiceSid }
            : from
              ? { from }
              : {}),
          body: message,
        });
        await db.emergencySmsLog.update({
          where: { id: logId },
          data: { status: EmergencySmsStatus.SENT, messageSid: sent.sid },
        });
        outcome.sent += 1;
      } catch (error) {
        await db.emergencySmsLog.update({
          where: { id: logId },
          data: {
            status: EmergencySmsStatus.FAILED,
            errorCode: "PROVIDER_ERROR",
          },
        });
        console.error(
          `Unable to send emergency SMS for request ${emergencyRequestId}.`,
          error,
        );
        outcome.failed += 1;
      }
    }));
  }

  return outcome;
}
