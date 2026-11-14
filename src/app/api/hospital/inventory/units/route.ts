import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { hospitalForRequest } from "@/lib/auth";
import { db } from "@/lib/db";
import { bloodGroupSchema } from "@/lib/validation";

const createSchema = z.object({
  bloodGroup: bloodGroupSchema,
  unitCode: z.string().trim().max(80).optional(),
  donorId: z.string().min(1).nullable(),
  collectedAt: z.coerce.date(),
  expiresAt: z.coerce.date(),
  incrementReported: z.boolean().default(true),
}).superRefine((unit, context) => {
  if (unit.collectedAt > new Date()) {
    context.addIssue({
      code: "custom",
      message: "Collection date cannot be in the future.",
      path: ["collectedAt"],
    });
  }
  if (unit.expiresAt <= unit.collectedAt) {
    context.addIssue({
      code: "custom",
      message: "Expiry date must be after the collection date.",
      path: ["expiresAt"],
    });
  }
});

export async function GET() {
  const hospital = await hospitalForRequest();
  if (!hospital) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const units = await db.bloodUnit.findMany({
    where: { hospitalId: hospital.id, status: { not: "ISSUED" } },
    orderBy: [{ expiresAt: "asc" }, { createdAt: "desc" }],
    take: 300,
    select: {
      id: true,
      unitCode: true,
      bloodGroup: true,
      collectedAt: true,
      expiresAt: true,
      status: true,
      verifiedAt: true,
      reservationReference: true,
      quarantineReason: true,
      updatedAt: true,
      donor: { select: { name: true } },
    },
  });

  return NextResponse.json(
    { units },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(request: NextRequest) {
  const hospital = await hospitalForRequest();
  if (!hospital) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid blood unit record." },
      { status: 400 },
    );
  }

  if (parsed.data.donorId) {
    const donor = await db.donor.findFirst({
      where: {
        id: parsed.data.donorId,
        registeredByHospitalId: hospital.id,
      },
      select: { id: true, bloodGroup: true },
    });
    if (!donor) {
      return NextResponse.json(
        { error: "Choose a donor record managed by this hospital." },
        { status: 400 },
      );
    }
    if (donor.bloodGroup !== parsed.data.bloodGroup) {
      return NextResponse.json(
        { error: "The donor's blood group must match the blood unit." },
        { status: 400 },
      );
    }
  }

  const unitCode =
    parsed.data.unitCode || `BB-${randomBytes(8).toString("hex").toUpperCase()}`;
  const { incrementReported, ...unitData } = parsed.data;

  try {
    const unit = await db.$transaction(async (tx) => {
      const created = await tx.bloodUnit.create({
        data: {
          ...unitData,
          unitCode,
          hospitalId: hospital.id,
          status: "PENDING_TESTING",
        },
        select: {
          id: true,
          unitCode: true,
          bloodGroup: true,
          collectedAt: true,
          expiresAt: true,
          status: true,
          createdAt: true,
          donor: { select: { name: true } },
        },
      });

      if (incrementReported) {
        await tx.bloodInventory.upsert({
          where: {
            hospitalId_bloodGroup: {
              hospitalId: hospital.id,
              bloodGroup: parsed.data.bloodGroup,
            },
          },
          create: {
            hospitalId: hospital.id,
            bloodGroup: parsed.data.bloodGroup,
            unitsAvailable: 1,
          },
          update: { unitsAvailable: { increment: 1 } },
        });
        await tx.inventoryChange.create({
          data: {
            hospitalId: hospital.id,
            bloodGroup: parsed.data.bloodGroup,
            unitsDelta: 1,
            reason: "UNIT_REGISTERED_PENDING_TESTING",
          },
        });
      }
      await tx.bloodUnitAudit.create({
        data: {
          hospitalId: hospital.id,
          bloodUnitId: created.id,
          toStatus: "PENDING_TESTING",
          reason: incrementReported
            ? "New unit registered; pending testing."
            : "Unit recorded from previously reported stock; pending testing.",
        },
      });
      return created;
    });

    return NextResponse.json(
      { unit },
      { status: 201, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "That unit/barcode ID is already registered." },
        { status: 409 },
      );
    }
    console.error("Blood unit could not be registered.", error);
    return NextResponse.json(
      { error: "Could not register this blood unit." },
      { status: 503 },
    );
  }
}
