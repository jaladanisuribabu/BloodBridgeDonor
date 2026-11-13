import { hash } from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { hashResetToken } from "@/lib/password-reset";

const confirmSchema = z.object({
  token: z.string().min(40).max(50),
  password: z.string().min(12).max(200),
});

export async function POST(request: NextRequest) {
  const parsed = confirmSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Use a valid reset link and a password of at least 12 characters." },
      { status: 400 },
    );
  }

  const tokenHash = hashResetToken(parsed.data.token);
  const now = new Date();
  const reset = await db.hospitalPasswordReset.findUnique({
    where: { tokenHash },
    select: { id: true, hospitalId: true, expiresAt: true, usedAt: true },
  });
  if (
    !reset?.hospitalId ||
    !reset.expiresAt ||
    reset.expiresAt <= now ||
    reset.usedAt
  ) {
    return NextResponse.json(
      { error: "This password reset link is invalid or has expired. Request a new one." },
      { status: 400 },
    );
  }

  const hospitalId = reset.hospitalId;
  const passwordHash = await hash(parsed.data.password, 12);
  const result = await db.$transaction(async (transaction) => {
    const consumed = await transaction.hospitalPasswordReset.updateMany({
      where: {
        id: reset.id,
        hospitalId,
        usedAt: null,
        expiresAt: { gt: now },
      },
      data: { usedAt: now },
    });
    if (consumed.count !== 1) return false;

    await transaction.hospital.update({
      where: { id: hospitalId },
      data: { passwordHash },
    });
    await transaction.hospitalPasswordReset.updateMany({
      where: { hospitalId, usedAt: null },
      data: { usedAt: now },
    });
    return true;
  });

  if (!result) {
    return NextResponse.json(
      { error: "This password reset link is invalid or has expired. Request a new one." },
      { status: 400 },
    );
  }

  return NextResponse.json({ message: "Password updated. You can now sign in." });
}
