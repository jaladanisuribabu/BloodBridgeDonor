import { NextRequest, NextResponse } from "next/server";
import { BloodGroup } from "@prisma/client";
import { z } from "zod";
import { hospitalForRequest } from "@/lib/auth";
import { db } from "@/lib/db";
import { bloodGroupSchema } from "@/lib/validation";

const inventorySchema = z.object({
  bloodGroup: bloodGroupSchema,
  unitsAvailable: z.number().int().min(0).max(100_000),
});

export async function GET() {
  const hospital = await hospitalForRequest();
  if (!hospital) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const [inventory, usage, changes] = await Promise.all([
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
  ]);
  const availableByGroup = new Map(
    inventory.map((row) => [row.bloodGroup, row.unitsAvailable]),
  );
  const demandByGroup = new Map(
    usage.map((row) => [row.bloodGroup, row._sum.unitsRequired ?? 0]),
  );

  const forecasts = Object.values(BloodGroup).map((bloodGroup) => {
    const unitsAvailable = availableByGroup.get(bloodGroup) ?? 0;
    const historicalUnits90Days = demandByGroup.get(bloodGroup) ?? 0;
    const projectedSevenDayDemand = Math.ceil((historicalUnits90Days / 90) * 7);
    return {
      bloodGroup,
      unitsAvailable,
      historicalUnits90Days,
      projectedSevenDayDemand,
      projectedShortage: Math.max(0, projectedSevenDayDemand - unitsAvailable),
      confidence: historicalUnits90Days >= 10 ? "moderate" : "low",
    };
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
