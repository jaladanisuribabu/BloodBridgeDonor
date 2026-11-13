import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateHospital, createHospitalSession } from "@/lib/auth";

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(200),
});

export async function POST(request: NextRequest) {
  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid email and password." }, { status: 400 });
  }

  const hospitalId = await authenticateHospital(
    parsed.data.email,
    parsed.data.password,
  );
  if (!hospitalId) {
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  await createHospitalSession(hospitalId);
  return NextResponse.json({ ok: true });
}
