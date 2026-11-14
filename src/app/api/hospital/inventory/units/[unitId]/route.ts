import { BloodUnitStatus, Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hospitalForRequest } from "@/lib/auth";
import { db } from "@/lib/db";

const updateSchema = z.object({
  status: z.nativeEnum(BloodUnitStatus),
  reason: z.string().trim().min(3).max(200),
  reservationReference: z.string().trim().max(80).nullable().optional(),
  verificationConfirmed: z.boolean().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ unitId: string }> },
) {
  const hospital = await hospitalForRequest();
  if (!hospital) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { unitId } = await params;
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid unit status update." },
      { status: 400 },
    );
  }

  try {
    const unit = await db.$transaction(async (tx) => {
      const current = await tx.bloodUnit.findFirst({
        where: { id: unitId, hospitalId: hospital.id },
      });
      if (!current) throw new Error("BLOOD_UNIT_NOT_FOUND");
      if (current.status === BloodUnitStatus.ISSUED) {
        throw new Error("BLOOD_UNIT_ALREADY_ISSUED");
      }
      if (current.status === parsed.data.status) {
        throw new Error("BLOOD_UNIT_STATUS_UNCHANGED");
      }

      const now = new Date();
      const expired = current.expiresAt <= now;
      const target = parsed.data.status;
      const canMoveToAvailable =
        current.status === BloodUnitStatus.PENDING_TESTING ||
        current.status === BloodUnitStatus.QUARANTINED ||
        current.status === BloodUnitStatus.RESERVED;

      if (target === BloodUnitStatus.AVAILABLE) {
        if (!canMoveToAvailable || expired) {
          throw new Error("BLOOD_UNIT_CANNOT_BE_RELEASED");
        }
        if (
          current.status !== BloodUnitStatus.RESERVED &&
          parsed.data.verificationConfirmed !== true
        ) {
          throw new Error("BLOOD_UNIT_RELEASE_CONFIRMATION_REQUIRED");
        }
      } else if (target === BloodUnitStatus.RESERVED) {
        if (
          current.status !== BloodUnitStatus.AVAILABLE ||
          current.verifiedAt === null ||
          expired ||
          !parsed.data.reservationReference?.trim()
        ) {
          throw new Error("BLOOD_UNIT_CANNOT_BE_RESERVED");
        }
      } else if (target === BloodUnitStatus.ISSUED) {
        if (
          (current.status !== BloodUnitStatus.AVAILABLE &&
            current.status !== BloodUnitStatus.RESERVED) ||
          current.verifiedAt === null ||
          expired
        ) {
          throw new Error("BLOOD_UNIT_CANNOT_BE_ISSUED");
        }
      } else if (target === BloodUnitStatus.PENDING_TESTING) {
        if (
          current.status !== BloodUnitStatus.AVAILABLE &&
          current.status !== BloodUnitStatus.QUARANTINED
        ) {
          throw new Error("BLOOD_UNIT_CANNOT_RETURN_TO_TESTING");
        }
      }

      if (target === BloodUnitStatus.ISSUED) {
        const stock = await tx.bloodInventory.updateMany({
          where: {
            hospitalId: hospital.id,
            bloodGroup: current.bloodGroup,
            unitsAvailable: { gte: 1 },
          },
          data: { unitsAvailable: { decrement: 1 } },
        });
        if (stock.count !== 1) throw new Error("REPORTED_STOCK_MISMATCH");
        await tx.inventoryChange.create({
          data: {
            hospitalId: hospital.id,
            bloodGroup: current.bloodGroup,
            unitsDelta: -1,
            reason: "VERIFIED_UNIT_ISSUED",
          },
        });
      }

      const updateResult = await tx.bloodUnit.updateMany({
        where: {
          id: current.id,
          hospitalId: hospital.id,
          status: current.status,
        },
        data: {
          status: target,
          verifiedAt:
            target === BloodUnitStatus.PENDING_TESTING
              ? null
              : target === BloodUnitStatus.AVAILABLE &&
                  current.status !== BloodUnitStatus.RESERVED
                ? now
                : current.verifiedAt,
          reservationReference:
            target === BloodUnitStatus.RESERVED
              ? parsed.data.reservationReference?.trim() ?? null
              : null,
          quarantineReason:
            target === BloodUnitStatus.QUARANTINED
              ? parsed.data.reason
              : null,
        },
      });
      if (updateResult.count !== 1) throw new Error("BLOOD_UNIT_CHANGED");
      const updated = await tx.bloodUnit.findUniqueOrThrow({
        where: { id: current.id },
        select: {
          id: true,
          unitCode: true,
          bloodGroup: true,
          status: true,
          collectedAt: true,
          expiresAt: true,
          verifiedAt: true,
          reservationReference: true,
          quarantineReason: true,
          updatedAt: true,
        },
      });

      await tx.bloodUnitAudit.create({
        data: {
          hospitalId: hospital.id,
          bloodUnitId: current.id,
          fromStatus: current.status,
          toStatus: target,
          reason: parsed.data.reason,
        },
      });
      return updated;
    });

    return NextResponse.json({ unit });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const responses: Record<string, { status: number; error: string }> = {
      BLOOD_UNIT_NOT_FOUND: { status: 404, error: "Blood unit not found." },
      BLOOD_UNIT_ALREADY_ISSUED: { status: 409, error: "Issued units cannot be changed." },
      BLOOD_UNIT_STATUS_UNCHANGED: { status: 409, error: "Choose a different unit status." },
      BLOOD_UNIT_CHANGED: {
        status: 409,
        error: "This unit changed in another update. Refresh the inventory and retry.",
      },
      BLOOD_UNIT_CANNOT_BE_RELEASED: {
        status: 409,
        error: "This unit cannot be released. Check its current status and expiry date.",
      },
      BLOOD_UNIT_RELEASE_CONFIRMATION_REQUIRED: {
        status: 400,
        error: "Confirm that required testing passed and clinical staff released this unit.",
      },
      BLOOD_UNIT_CANNOT_BE_RESERVED: {
        status: 409,
        error: "Only an unexpired, verified available unit can be reserved. Add a reservation reference.",
      },
      BLOOD_UNIT_CANNOT_BE_ISSUED: {
        status: 409,
        error: "Only an unexpired, verified available or reserved unit can be issued.",
      },
      BLOOD_UNIT_CANNOT_RETURN_TO_TESTING: {
        status: 409,
        error: "Only an available or quarantined unit can return to testing.",
      },
      REPORTED_STOCK_MISMATCH: {
        status: 409,
        error: "Reported stock is lower than tracked units. Reconcile the reported count before issuing.",
      },
    };
    const known = responses[message];
    if (known) {
      return NextResponse.json({ error: known.error }, { status: known.status });
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return NextResponse.json({ error: "Blood unit not found." }, { status: 404 });
    }
    console.error("Blood unit status update failed.", error);
    return NextResponse.json(
      { error: "Could not update this blood unit." },
      { status: 503 },
    );
  }
}
