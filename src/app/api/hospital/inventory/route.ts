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

  const [inventory, usage] = await Promise.all([
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

  return NextResponse.json({ forecasts });
}

export async function PUT(request: NextRequest) {
  const hospital = await hospitalForRequest();
  if (!hospital) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const parsed = inventorySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid blood inventory values." }, { status: 400 });
  }

  const inventory = await db.bloodInventory.upsert({
    where: {
      hospitalId_bloodGroup: {
        hospitalId: hospital.id,
        bloodGroup: parsed.data.bloodGroup,
      },
    },
    create: { hospitalId: hospital.id, ...parsed.data },
    update: { unitsAvailable: parsed.data.unitsAvailable },
  });
  return NextResponse.json({ inventory });
}
