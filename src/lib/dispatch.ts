import {
  CallLogStatus,
  RequestState,
} from "@prisma/client";
import { db } from "@/lib/db";
import { appUrl, getTwilioClient } from "@/lib/twilio";
import { findNearbyDonors } from "@/lib/proximity";

const MAX_SIMULTANEOUS_CALLS = 5;
const ACTIVE_CALL_STATUSES: CallLogStatus[] = [
  "QUEUED",
  "INITIATED",
  "RINGING",
  "IN_PROGRESS",
];

type ReservedCall = {
  id: string;
  donor: { phone: string };
};

async function reserveNextBatch(requestId: string): Promise<ReservedCall[]> {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "EmergencyRequest" WHERE "id" = ${requestId} FOR UPDATE`;
    const request = await tx.emergencyRequest.findUnique({
      where: { id: requestId },
      include: { hospital: { select: { latitude: true, longitude: true } } },
    });

    if (!request || request.state !== RequestState.OPEN) return [];

    const activeCount = await tx.callLog.count({
      where: { emergencyRequestId: requestId, status: { in: ACTIVE_CALL_STATUSES } },
    });
    const slots = MAX_SIMULTANEOUS_CALLS - activeCount;
    if (slots <= 0 || request.unitsConfirmed >= request.unitsRequired) return [];

    const remainingUnits = request.unitsRequired - request.unitsConfirmed;
    const take = Math.min(slots, remainingUnits);
    const donors = await findNearbyDonors(tx, {
      bloodGroup: request.bloodGroup,
      latitude: request.hospital.latitude,
      longitude: request.hospital.longitude,
      limit: take,
      emergencyRequestId: requestId,
    });

    if (donors.length === 0) return [];
    await tx.callLog.createMany({
      data: donors.map((donor) => ({
        emergencyRequestId: requestId,
        donorId: donor.id,
        status: CallLogStatus.QUEUED,
      })),
    });
    const records = await tx.callLog.findMany({
      where: {
        emergencyRequestId: requestId,
        donorId: { in: donors.map((donor) => donor.id) },
      },
      select: { id: true, donor: { select: { phone: true } } },
    });
    return records;
  });
}

export async function dispatchRequest(
  requestId: string,
): Promise<{ startedCalls: number; failedCalls: number }> {
  const from = process.env.TWILIO_PHONE_NUMBER;
  if (!from) throw new Error("TWILIO_PHONE_NUMBER is not configured.");
  const client = getTwilioClient();
  let startedCalls = 0;
  let failedCalls = 0;

  while (true) {
    const queuedCalls = await reserveNextBatch(requestId);
    if (queuedCalls.length === 0) {
      if (startedCalls === 0 && failedCalls > 0) {
        throw new Error(`Unable to start any of ${failedCalls} reserved donor calls.`);
      }
      return { startedCalls, failedCalls };
    }

    let startedAtLeastOne = false;
    for (const call of queuedCalls) {
      try {
        const stillQueued = await db.callLog.findFirst({
          where: {
            id: call.id,
            status: CallLogStatus.QUEUED,
            emergencyRequest: { is: { state: RequestState.OPEN } },
          },
          select: { id: true },
        });
        if (!stillQueued) continue;

        const created = await client.calls.create({
          to: call.donor.phone,
          from,
          url: appUrl(`/api/ivr/answer?callLogId=${encodeURIComponent(call.id)}`),
          method: "POST",
          statusCallback: appUrl(
            `/api/ivr/status?callLogId=${encodeURIComponent(call.id)}`,
          ),
          statusCallbackMethod: "POST",
          statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
        });
        const linked = await db.callLog.updateMany({
          where: {
            id: call.id,
            status: CallLogStatus.QUEUED,
            emergencyRequest: { is: { state: RequestState.OPEN } },
          },
          data: { twilioCallSid: created.sid, status: CallLogStatus.INITIATED },
        });
        if (linked.count === 0) {
          const current = await db.callLog.findUnique({
            where: { id: call.id },
            include: { emergencyRequest: { select: { state: true } } },
          });
          if (
            current?.emergencyRequest.state !== RequestState.OPEN ||
            current.status === CallLogStatus.CANCELLED
          ) {
            await client.calls(created.sid).update({ status: "completed" });
            continue;
          }
        }
        startedCalls += 1;
        startedAtLeastOne = true;
      } catch (error) {
        failedCalls += 1;
        await db.callLog.updateMany({
          where: { id: call.id, status: CallLogStatus.QUEUED },
          data: { status: CallLogStatus.FAILED },
        });
        console.error(`Unable to start donor call ${call.id}:`, error);
      }
    }

    if (startedAtLeastOne) return { startedCalls, failedCalls };
  }
}

export async function markDonorUnavailable(callLogId: string): Promise<void> {
  const changed = await db.callLog.updateMany({
    where: { id: callLogId, status: { in: ACTIVE_CALL_STATUSES } },
    data: { status: CallLogStatus.UNAVAILABLE, responseDigit: "2" },
  });
  if (changed.count > 0) {
    const call = await db.callLog.findUnique({
      where: { id: callLogId },
      select: { emergencyRequestId: true },
    });
    if (call) await dispatchRequest(call.emergencyRequestId);
  }
}

export async function markDonorNoAnswer(callLogId: string): Promise<void> {
  const changed = await db.callLog.updateMany({
    where: { id: callLogId, status: { in: ACTIVE_CALL_STATUSES } },
    data: { status: CallLogStatus.NO_ANSWER },
  });
  if (changed.count > 0) {
    const call = await db.callLog.findUnique({
      where: { id: callLogId },
      select: { emergencyRequestId: true },
    });
    if (call) await dispatchRequest(call.emergencyRequestId);
  }
}

export async function markDonorAccepted(callLogId: string): Promise<void> {
  const result = await db.$transaction(async (tx) => {
    const call = await tx.callLog.findUnique({
      where: { id: callLogId },
      include: { emergencyRequest: true },
    });
    if (!call) throw new Error("Call log was not found.");
    if (!ACTIVE_CALL_STATUSES.includes(call.status)) {
      return { requestId: call.emergencyRequestId, fulfilled: call.emergencyRequest.state === "FULFILLED", accepted: false };
    }

    await tx.$queryRaw`SELECT "id" FROM "EmergencyRequest" WHERE "id" = ${call.emergencyRequestId} FOR UPDATE`;
    const lockedCall = await tx.callLog.findUniqueOrThrow({ where: { id: callLogId } });
    if (!ACTIVE_CALL_STATUSES.includes(lockedCall.status)) {
      const currentRequest = await tx.emergencyRequest.findUniqueOrThrow({
        where: { id: call.emergencyRequestId },
      });
      return {
        requestId: call.emergencyRequestId,
        fulfilled: currentRequest.state === RequestState.FULFILLED,
        accepted: false,
      };
    }

    const request = await tx.emergencyRequest.findUniqueOrThrow({
      where: { id: call.emergencyRequestId },
    });
    if (request.state !== "OPEN") {
      await tx.callLog.update({
        where: { id: callLogId },
        data: { status: CallLogStatus.CANCELLED, responseDigit: "1" },
      });
      return { requestId: call.emergencyRequestId, fulfilled: true, accepted: false };
    }

    await tx.callLog.update({
      where: { id: callLogId },
      data: { status: CallLogStatus.ACCEPTED, responseDigit: "1" },
    });
    const unitsConfirmed = request.unitsConfirmed + 1;
    const fulfilled = unitsConfirmed >= request.unitsRequired;
    await tx.emergencyRequest.update({
      where: { id: request.id },
      data: {
        unitsConfirmed,
        ...(fulfilled ? { state: RequestState.FULFILLED } : {}),
      },
    });
    return { requestId: request.id, fulfilled, accepted: true };
  });

  if (result.fulfilled) {
    await cancelOutstandingCalls(result.requestId);
  } else {
    await dispatchRequest(result.requestId);
  }
}

export async function cancelOutstandingCalls(requestId: string): Promise<void> {
  const outstanding = await db.callLog.findMany({
    where: {
      emergencyRequestId: requestId,
      status: { in: ACTIVE_CALL_STATUSES },
    },
    select: { id: true, twilioCallSid: true },
  });

  await db.callLog.updateMany({
    where: {
      emergencyRequestId: requestId,
      status: { in: ACTIVE_CALL_STATUSES },
    },
    data: { status: CallLogStatus.CANCELLED },
  });

  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) return;
  const client = getTwilioClient();
  await Promise.all(
    outstanding
      .filter((call) => call.twilioCallSid)
      .map(async (call) => {
        try {
          await client.calls(call.twilioCallSid!).update({ status: "completed" });
        } catch (error) {
          console.error(`Unable to terminate Twilio call ${call.id}:`, error);
        }
      }),
  );
}

export async function completeAcceptedDonors(requestId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.emergencyRequest.updateMany({
      where: { id: requestId, state: RequestState.OPEN },
      data: { state: RequestState.CANCELLED },
    });
    await tx.callLog.updateMany({
      where: { emergencyRequestId: requestId, status: CallLogStatus.ACCEPTED },
      data: { status: CallLogStatus.COMPLETED },
    });
  });
  await cancelOutstandingCalls(requestId);
}

export async function handleCallStatus(
  callLogId: string,
  twilioStatus: string,
  callSid: string,
): Promise<void> {
  const statusByTwilio: Record<string, CallLogStatus> = {
    initiated: CallLogStatus.INITIATED,
    ringing: CallLogStatus.RINGING,
    answered: CallLogStatus.IN_PROGRESS,
    "in-progress": CallLogStatus.IN_PROGRESS,
  };
  const activeStatus = statusByTwilio[twilioStatus];
  if (activeStatus) {
    await db.callLog.updateMany({
      where: { id: callLogId, status: { in: ACTIVE_CALL_STATUSES } },
      data: { status: activeStatus, twilioCallSid: callSid },
    });
    return;
  }

  if (twilioStatus !== "completed") return;
  const changed = await db.callLog.updateMany({
    where: { id: callLogId, status: { in: ACTIVE_CALL_STATUSES } },
    data: { status: CallLogStatus.NO_ANSWER, twilioCallSid: callSid },
  });
  if (changed.count > 0) {
    const call = await db.callLog.findUnique({
      where: { id: callLogId },
      select: { emergencyRequestId: true },
    });
    if (call) await dispatchRequest(call.emergencyRequestId);
  }
}
