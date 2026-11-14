import { NextRequest, NextResponse } from "next/server";
import { patientForRequest } from "@/lib/auth";
import { db } from "@/lib/db";
import { bloodGroupSchema } from "@/lib/validation";

export async function GET(request: NextRequest) {
  const patient = await patientForRequest();
  if (!patient) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const city = request.nextUrl.searchParams.get("city")?.trim().slice(0, 120);
  const groupParam = request.nextUrl.searchParams.get("bloodGroup");
  const bloodGroup = groupParam ? bloodGroupSchema.safeParse(groupParam) : null;
  if (!city || city.length < 2 || (bloodGroup && !bloodGroup.success)) {
    return NextResponse.json({ error: "Choose a valid city and blood group." }, { status: 400 });
  }

  const rows = await db.bloodUnit.groupBy({
    by: ["bloodGroup"],
    where: {
      status: "AVAILABLE",
      expiresAt: { gt: new Date() },
      verifiedAt: { not: null },
      hospital: { city: { equals: city, mode: "insensitive" } },
      ...(bloodGroup?.success ? { bloodGroup: bloodGroup.data } : {}),
    },
    _count: { _all: true },
    orderBy: { bloodGroup: "asc" },
  });

  return NextResponse.json({
    city,
    availability: rows.map((row) => ({
      bloodGroup: row.bloodGroup,
      unitsAvailable: row._count._all,
    })),
  });
}
