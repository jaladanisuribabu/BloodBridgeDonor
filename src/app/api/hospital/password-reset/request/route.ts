import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  createResetToken,
  hashRecoveryIdentifier,
  hashResetToken,
  PASSWORD_RESET_TTL_MS,
  sendPasswordResetEmail,
} from "@/lib/password-reset";

const requestSchema = z.object({
  email: z.string().email().max(254),
});

const genericResponse = {
  message:
    "If an account exists for that email, password reset instructions will be sent.",
};

function requestIp(request: NextRequest): string {
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

export async function POST(request: NextRequest) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Enter a valid email address." },
      { status: 400 },
    );
  }

  const appUrl = process.env.APP_URL;
  if (!appUrl || !process.env.RESEND_API_KEY || !process.env.PASSWORD_RESET_FROM) {
    return NextResponse.json(
      { error: "Password reset is temporarily unavailable. Contact your hospital administrator." },
      { status: 503 },
    );
  }

  const email = parsed.data.email.trim().toLowerCase();
  const emailHash = hashRecoveryIdentifier(email);
  const ipHash = hashRecoveryIdentifier(requestIp(request));
  const now = new Date();

  await db.hospitalPasswordReset.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) } },
  });

  const [emailAttempts, ipAttempts] = await Promise.all([
    db.hospitalPasswordReset.count({
      where: { emailHash, createdAt: { gte: new Date(now.getTime() - 60 * 60 * 1000) } },
    }),
    db.hospitalPasswordReset.count({
      where: { ipHash, createdAt: { gte: new Date(now.getTime() - 60 * 60 * 1000) } },
    }),
  ]);
  if (emailAttempts >= 3 || ipAttempts >= 10) {
    return NextResponse.json(genericResponse);
  }

  const hospital = await db.hospital.findUnique({
    where: { email },
    select: { id: true, email: true },
  });
  if (!hospital) {
    await db.hospitalPasswordReset.create({
      data: { emailHash, ipHash },
    });
    return NextResponse.json(genericResponse);
  }

  await db.hospitalPasswordReset.updateMany({
    where: { hospitalId: hospital.id, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });

  const token = createResetToken();
  const expiresAt = new Date(now.getTime() + PASSWORD_RESET_TTL_MS);
  await db.hospitalPasswordReset.create({
    data: {
      hospitalId: hospital.id,
      emailHash,
      ipHash,
      tokenHash: hashResetToken(token),
      expiresAt,
    },
  });

  const resetUrl = new URL("/hospital/reset", appUrl);
  resetUrl.searchParams.set("token", token);
  try {
    await sendPasswordResetEmail(hospital.email, resetUrl.toString());
  } catch (error) {
    console.error("Unable to deliver hospital password reset email.", error);
    return NextResponse.json(
      { error: "Password reset email could not be sent. Contact your hospital administrator." },
      { status: 503 },
    );
  }

  return NextResponse.json(genericResponse);
}
