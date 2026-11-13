import { compare } from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createPatientSession } from "@/lib/auth";
import { db } from "@/lib/db";

const schema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(200),
});

export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid email and password." }, { status: 400 });
  }
  const patient = await db.patientAccount.findUnique({
    where: { email: parsed.data.email.toLowerCase() },
    select: { id: true, passwordHash: true },
  });
  if (!patient || !(await compare(parsed.data.password, patient.passwordHash))) {
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }
  await createPatientSession(patient.id);
  return NextResponse.json({ ok: true });
}
