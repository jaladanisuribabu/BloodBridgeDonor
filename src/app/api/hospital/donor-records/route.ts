import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hospitalForRequest } from "@/lib/auth";
import { db } from "@/lib/db";
import { bloodGroupSchema } from "@/lib/validation";

const donorSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().regex(/^\+[1-9]\d{7,14}$/),
  address: z.string().trim().min(2).max(300),
  bloodGroup: bloodGroupSchema,
  callConsent: z.boolean(),
  trackingConsent: z.boolean(),
  smsConsent: z.boolean(),
  latitude: z.number().finite().min(-90).max(90).nullable(),
  longitude: z.number().finite().min(-180).max(180).nullable(),
}).superRefine((donor, context) => {
  if ((donor.latitude === null) !== (donor.longitude === null)) {
    context.addIssue({
      code: "custom",
      message: "Select both latitude and longitude for the donor's preferred location.",
      path: ["latitude"],
    });
  }
  if (!donor.trackingConsent && donor.latitude !== null) {
    context.addIssue({
      code: "custom",
      message: "A donor location cannot be saved without location consent.",
      path: ["trackingConsent"],
    });
  }
});

export async function GET() {
  const hospital = await hospitalForRequest();
  if (!hospital) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const donors = await db.donor.findMany({
    where: { registeredByHospitalId: hospital.id },
    orderBy: [{ createdAt: "desc" }],
    take: 200,
    select: {
      id: true,
      name: true,
      phone: true,
      address: true,
      bloodGroup: true,
      available: true,
      callConsent: true,
      trackingConsent: true,
      smsConsent: true,
      latitude: true,
      longitude: true,
      nextEligibleAt: true,
      createdAt: true,
    },
  });

  return NextResponse.json(
    {
      donors: donors.map(({ latitude, longitude, ...donor }) => ({
        ...donor,
        hasLocation: latitude !== null && longitude !== null,
      })),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(request: NextRequest) {
  const hospital = await hospitalForRequest();
  if (!hospital) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const parsed = donorSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid donor record." },
      { status: 400 },
    );
  }

  const locationToken = randomBytes(32).toString("base64url");
  const locationTokenHash = createHash("sha256").update(locationToken).digest("hex");

  try {
    const donor = await db.donor.create({
      data: {
        ...parsed.data,
        address: parsed.data.address,
        registeredByHospitalId: hospital.id,
        available: true,
        locationTokenHash,
      },
      select: {
        id: true,
        name: true,
        phone: true,
        address: true,
        bloodGroup: true,
        available: true,
        callConsent: true,
        trackingConsent: true,
        smsConsent: true,
        latitude: true,
        longitude: true,
        nextEligibleAt: true,
        createdAt: true,
      },
    });

    return NextResponse.json(
      {
        donor: {
          ...donor,
          hasLocation: donor.latitude !== null && donor.longitude !== null,
        },
        activationToken: parsed.data.trackingConsent ? locationToken : null,
      },
      { status: 201, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "A donor with this phone number is already registered." },
        { status: 409 },
      );
    }
    console.error("Hospital donor record could not be saved.", error);
    return NextResponse.json(
      { error: "Could not save this donor record." },
      { status: 503 },
    );
  }
}
