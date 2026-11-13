import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hospitalForRequest } from "@/lib/auth";
import { db } from "@/lib/db";
import { bloodGroupSchema } from "@/lib/validation";

const createSchema = z.object({
  patientName: z.string().trim().min(2).max(120),
  patientReference: z.string().trim().max(80).nullable().optional(),
  bloodGroup: bloodGroupSchema,
  unitsRequired: z.number().int().min(1).max(1000),
  notes: z.string().trim().max(500).nullable().optional(),
});

export async function GET() {
  const hospital = await hospitalForRequest();
  if (!hospital) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const cases = await db.patientCase.findMany({
    where: { hospitalId: hospital.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json({ cases });
}

export async function POST(request: NextRequest) {
  const hospital = await hospitalForRequest();
  if (!hospital) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid patient case." },
      { status: 400 },
    );
  }
  const patientCase = await db.patientCase.create({
    data: {
      hospitalId: hospital.id,
      patientName: parsed.data.patientName,
      patientReference: parsed.data.patientReference || null,
      bloodGroup: parsed.data.bloodGroup,
      unitsRequired: parsed.data.unitsRequired,
      notes: parsed.data.notes || null,
    },
  });
  return NextResponse.json({ case: patientCase }, { status: 201 });
}
