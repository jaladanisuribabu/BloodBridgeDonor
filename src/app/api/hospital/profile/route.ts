import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hospitalForRequest } from "@/lib/auth";
import { db } from "@/lib/db";

const locationSchema = z.object({
  address: z.string().trim().min(5).max(300),
  city: z.string().trim().min(2).max(120),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
});

export async function PUT(request: NextRequest) {
  const hospital = await hospitalForRequest();
  if (!hospital) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const parsed = locationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Enter a valid hospital address and map coordinates." },
      { status: 400 },
    );
  }

  const updated = await db.hospital.update({
    where: { id: hospital.id },
    data: parsed.data,
    select: {
      id: true,
      name: true,
      email: true,
      address: true,
      city: true,
      phone: true,
      latitude: true,
      longitude: true,
      donationIntervalMonths: true,
    },
  });

  return NextResponse.json({ hospital: updated });
}
