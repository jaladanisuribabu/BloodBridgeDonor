import { Prisma } from "@prisma/client";
import { hash, compare } from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hospitalForRequest } from "@/lib/auth";
import { db } from "@/lib/db";

const schema = z.object({
  name: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().max(30).nullable(),
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(12).max(200).optional().or(z.literal("")),
  donationIntervalMonths: z.number().int().min(1).max(36).nullable(),
});

export async function PUT(request: NextRequest) {
  const hospital = await hospitalForRequest();
  if (!hospital) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid hospital settings." },
      { status: 400 },
    );
  }
  const current = await db.hospital.findUnique({
    where: { id: hospital.id },
    select: { passwordHash: true },
  });
  if (!current || !(await compare(parsed.data.currentPassword, current.passwordHash))) {
    return NextResponse.json({ error: "Current password is incorrect." }, { status: 401 });
  }

  try {
    const updated = await db.hospital.update({
      where: { id: hospital.id },
      data: {
        name: parsed.data.name,
        email: parsed.data.email.toLowerCase(),
        phone: parsed.data.phone?.trim() || null,
        donationIntervalMonths: parsed.data.donationIntervalMonths,
        ...(parsed.data.newPassword
          ? { passwordHash: await hash(parsed.data.newPassword, 12) }
          : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        address: true,
        city: true,
        latitude: true,
        longitude: true,
        donationIntervalMonths: true,
      },
    });
    return NextResponse.json({ hospital: updated });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "That email is already in use." }, { status: 409 });
    }
    console.error("Hospital settings update failed.", error);
    return NextResponse.json({ error: "Could not update hospital settings." }, { status: 503 });
  }
}
