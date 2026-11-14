import { NextResponse } from "next/server";
import { hospitalForRequest } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  const hospital = await hospitalForRequest();
  if (!hospital) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const hospitals = await db.hospital.findMany({
    where: { id: { not: hospital.id } },
    orderBy: [{ city: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      city: true,
      phone: true,
      inventory: {
        orderBy: { bloodGroup: "asc" },
        select: {
          bloodGroup: true,
          unitsAvailable: true,
          updatedAt: true,
        },
      },
    },
  });

  return NextResponse.json(
    { hospitals },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
