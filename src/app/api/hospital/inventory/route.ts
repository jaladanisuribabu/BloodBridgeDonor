import { NextRequest, NextResponse } from "next/server";
import { BloodUnitStatus } from "@prisma/client";
import { z } from "zod";
import { hospitalForRequest } from "@/lib/auth";
import { db } from "@/lib/db";
import { summarizeBloodStock } from "@/lib/blood-verify";
import { bloodGroupSchema } from "@/lib/validation";

const inventorySchema = z.object({
  bloodGroup: bloodGroupSchema,
  unitsAvailable: z.number().int().min(0).max(100_000),
});

export async function GET() {
  const hospital = await hospitalForRequest();
  if (!hospital) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const now = new Date();
  const expiringCutoff = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const [inventory, usage, changes, unitStatuses, expiredStatuses, expiringSoon, oldestVerification] = await Promise.all([
    db.bloodInventory.findMany({ where: { hospitalId: hospital.id } }),
    db.emergencyRequest.groupBy({
      by: ["bloodGroup"],
      where: {
        hospitalId: hospital.id,
        state: { not: "CANCELLED" },
        createdAt: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
      },
      _sum: { unitsRequired: true },
    }),
    db.inventoryChange.findMany({
      where: { hospitalId: hospital.id },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { patientCase: { select: { patientName: true } } },
    }),
    db.bloodUnit.groupBy({
      by: ["bloodGroup", "status"],
      where: {
        hospitalId: hospital.id,
        status: { not: BloodUnitStatus.ISSUED },
      },
      _count: { _all: true },
    }),
    db.bloodUnit.groupBy({
      by: ["bloodGroup", "status"],
      where: {
        hospitalId: hospital.id,
        status: { not: BloodUnitStatus.ISSUED },
        expiresAt: { lte: now },
      },
      _count: { _all: true },
    }),
    db.bloodUnit.groupBy({
      by: ["bloodGroup"],
      where: {
        hospitalId: hospital.id,
        status: BloodUnitStatus.AVAILABLE,
        expiresAt: { gt: now, lte: expiringCutoff },
      },
      _count: { _all: true },
    }),
    db.bloodUnit.groupBy({
      by: ["bloodGroup"],
      where: {
        hospitalId: hospital.id,
        status: BloodUnitStatus.AVAILABLE,
        expiresAt: { gt: now },
        verifiedAt: { not: null },
      },
      _min: { verifiedAt: true },
    }),
  ]);
  const forecasts = summarizeBloodStock({
    now,
    inventory,
    unitStatuses: unitStatuses.map((row) => ({
      bloodGroup: row.bloodGroup,
      status: row.status,
      count: row._count._all,
    })),
    expiredStatuses: expiredStatuses.map((row) => ({
      bloodGroup: row.bloodGroup,
      status: row.status,
      count: row._count._all,
    })),
    expiringSoon: expiringSoon.map((row) => ({
      bloodGroup: row.bloodGroup,
      count: row._count._all,
    })),
    oldestVerification: oldestVerification.map((row) => ({
      bloodGroup: row.bloodGroup,
      verifiedAt: row._min.verifiedAt,
    })),
    demand90Days: usage.map((row) => ({
      bloodGroup: row.bloodGroup,
      units: row._sum.unitsRequired ?? 0,
    })),
    recentChanges: changes.map((change) => ({
      bloodGroup: change.bloodGroup,
      unitsDelta: change.unitsDelta,
      createdAt: change.createdAt,
    })),
  });

  return NextResponse.json({ forecasts, changes });
}

export async function PUT(request: NextRequest) {
  const hospital = await hospitalForRequest();
  if (!hospital) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const parsed = inventorySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid blood inventory values." }, { status: 400 });
  }

  const inventory = await db.$transaction(async (tx) => {
    const where = {
      hospitalId_bloodGroup: {
        hospitalId: hospital.id,
        bloodGroup: parsed.data.bloodGroup,
      },
    };
    const previous = await tx.bloodInventory.findUnique({
      where,
      select: { unitsAvailable: true },
    });
    const updated = await tx.bloodInventory.upsert({
      where,
      create: { hospitalId: hospital.id, ...parsed.data },
      update: { unitsAvailable: parsed.data.unitsAvailable },
    });
    const delta = parsed.data.unitsAvailable - (previous?.unitsAvailable ?? 0);
    if (delta !== 0) {
      await tx.inventoryChange.create({
        data: {
          hospitalId: hospital.id,
          bloodGroup: parsed.data.bloodGroup,
          unitsDelta: delta,
          reason: "STAFF_STOCK_UPDATE",
        },
      });
    }
    return updated;
  });
  return NextResponse.json({ inventory });
}
