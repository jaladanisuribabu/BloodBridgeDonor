import { Prisma } from "@prisma/client";
import { hash } from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createPatientSession } from "@/lib/auth";
import { db } from "@/lib/db";

const schema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254),
  city: z.string().trim().min(2).max(120),
  password: z.string().min(12).max(200),
  confirmPassword: z.string().min(12).max(200),
}).refine((value) => value.password === value.confirmPassword, {
  path: ["confirmPassword"],
  message: "Passwords do not match.",
});

export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Enter valid patient registration details." },
      { status: 400 },
    );
  }
  try {
    const patient = await db.patientAccount.create({
      data: {
        name: parsed.data.name,
        email: parsed.data.email.toLowerCase(),
        city: parsed.data.city,
        passwordHash: await hash(parsed.data.password, 12),
      },
      select: { id: true },
    });
    await createPatientSession(patient.id);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { error: "An account with this email already exists." },
        { status: 409 },
      );
    }
    console.error("Patient registration failed.", error);
    return NextResponse.json(
      { error: "Could not create the patient account right now. Please try again later." },
      { status: 503 },
    );
  }
}
