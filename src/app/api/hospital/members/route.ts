import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hospitalForRequest } from "@/lib/auth";
import { db } from "@/lib/db";
import { bloodGroupSchema } from "@/lib/validation";

const importSchema = z.object({
  consentConfirmed: z.literal(true),
  donors: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        phone: z.string().regex(/^\+[1-9]\d{7,14}$/),
        bloodGroup: bloodGroupSchema,
        latitude: z.number().finite().min(-90).max(90),
        longitude: z.number().finite().min(-180).max(180),
      }).strict(),
    )
    .min(1)
    .max(150),
}).superRefine(({ donors }, context) => {
  if (new Set(donors.map((donor) => donor.phone)).size !== donors.length) {
    context.addIssue({
      code: "custom",
      message: "The import contains duplicate phone numbers.",
      path: ["donors"],
    });
  }
});

export async function GET() {
  const hospital = await hospitalForRequest();
  if (!hospital) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const [total, callable, groups] = await Promise.all([
    db.donor.count(),
    db.donor.count({
      where: {
        available: true,
        callConsent: true,
        trackingConsent: true,
        latitude: { not: null },
        longitude: { not: null },
        OR: [
          { nextEligibleAt: null },
          { nextEligibleAt: { lte: new Date() } },
        ],
      },
    }),
    db.donor.groupBy({
      by: ["bloodGroup"],
      _count: { _all: true },
      orderBy: { bloodGroup: "asc" },
    }),
  ]);
  return NextResponse.json({
    total,
    callable,
    groups: groups.map((group) => ({
      bloodGroup: group.bloodGroup,
      count: group._count._all,
    })),
  });
}

export async function POST(request: NextRequest) {
  const hospital = await hospitalForRequest();
  if (!hospital) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const parsed = importSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid donor import." },
      { status: 400 },
    );
  }

  const phones = parsed.data.donors.map((donor) => donor.phone);
  const existing = await db.donor.findMany({
    where: { phone: { in: phones } },
    select: { phone: true },
  });
  if (existing.length) {
    return NextResponse.json(
      {
        error: `${existing.length} phone number(s) already exist in the donor network. Remove duplicates and retry.`,
      },
      { status: 409 },
    );
  }

  const tokenRows = parsed.data.donors.map((donor) => {
    const locationToken = randomBytes(32).toString("base64url");
    return {
      donor,
      locationToken,
      locationTokenHash: createHash("sha256").update(locationToken).digest("hex"),
    };
  });

  try {
    await db.$transaction(
      tokenRows.map(({ donor, locationTokenHash }) =>
        db.donor.create({
          data: {
            ...donor,
            registeredByHospitalId: hospital.id,
            available: true,
            callConsent: true,
            trackingConsent: true,
            locationTokenHash,
          },
          select: { id: true },
        }),
      ),
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "A donor phone number was added by another request. Refresh and retry." },
        { status: 409 },
      );
    }
    console.error("Hospital donor import failed.", error);
    return NextResponse.json(
      { error: "Could not import donor records right now. Please try again later." },
      { status: 503 },
    );
  }

  return NextResponse.json(
    {
      imported: tokenRows.length,
      activationTokens: tokenRows.map(({ donor, locationToken }) => ({
        name: donor.name,
        phone: donor.phone,
        token: locationToken,
      })),
    },
    { status: 201 },
  );
}
