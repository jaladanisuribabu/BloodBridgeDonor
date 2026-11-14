import { NextResponse } from "next/server";
import { hospitalForRequest } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  const hospital = await hospitalForRequest();
  if (!hospital) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const now = new Date();
  const [hospitals, inventory] = await Promise.all([
    db.hospital.findMany({
      where: { id: { not: hospital.id } },
      orderBy: [{ city: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        city: true,
        phone: true,
      },
    }),
    db.bloodUnit.groupBy({
      by: ["hospitalId", "bloodGroup"],
      where: {
        hospitalId: { not: hospital.id },
        status: "AVAILABLE",
        expiresAt: { gt: now },
        verifiedAt: { not: null },
      },
      _count: { _all: true },
      _max: { verifiedAt: true },
    }),
  ]);
  const inventoryByHospital = new Map<
    string,
    {
      bloodGroup: (typeof inventory)[number]["bloodGroup"];
      verifiedUsableUnits: number;
      updatedAt: Date | null;
    }[]
  >();
  for (const row of inventory) {
    const records = inventoryByHospital.get(row.hospitalId) ?? [];
    records.push({
      bloodGroup: row.bloodGroup,
      verifiedUsableUnits: row._count._all,
      updatedAt: row._max.verifiedAt,
    });
    inventoryByHospital.set(row.hospitalId, records);
  }

  return NextResponse.json(
    {
      hospitals: hospitals.map((entry) => ({
        ...entry,
        inventory: inventoryByHospital.get(entry.id) ?? [],
      })),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
