import { Prisma } from "@prisma/client";
import { hash } from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createHospitalSession } from "@/lib/auth";
import { db } from "@/lib/db";

const registerSchema = z
  .object({
    email: z.string().trim().email().max(254),
    hospitalName: z.string().trim().min(2).max(160),
    password: z.string().min(12).max(200),
    confirmPassword: z.string().min(12).max(200),
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match.",
  });

export async function POST(request: NextRequest) {
  const parsed = registerSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Enter valid registration details." },
      { status: 400 },
    );
  }

  const email = parsed.data.email.toLowerCase();
  const passwordHash = await hash(parsed.data.password, 12);
  let hospital: { id: string };

  try {
    hospital = await db.hospital.create({
      data: {
        name: parsed.data.hospitalName,
        email,
        passwordHash,
      },
      select: { id: true },
    });

    await createHospitalSession(hospital.id);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "An account with this email already exists. Please sign in." },
        { status: 409 },
      );
    }
    console.error("Hospital registration could not create the account.", error);
    return NextResponse.json(
      { error: "Could not create the hospital account right now. Please try again later." },
      { status: 503 },
    );
  }

  try {
    await createHospitalSession(hospital.id);
  } catch (error) {
    console.error("Hospital account was created, but session creation failed.", error);
    return NextResponse.json(
      {
        error: "Your account was created, but sign-in could not be completed. Please sign in with your new credentials.",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
