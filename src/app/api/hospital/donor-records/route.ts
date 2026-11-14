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
  latitude: z.number().finite().min(-90).max(90).nullable().optional(),
  longitude: z.number().finite().min(-180).max(180).nullable().optional(),
});

function resolveCoordinates(address: string, fallbackLat?: number | null, fallbackLng?: number | null): { lat: number; lng: number } {
  const normalized = address.toLowerCase();
  const knownLocations: Record<string, [number, number]> = {
    kphb: [17.4933, 78.3995],
    kukatpally: [17.4849, 78.4138],
    ameerpet: [17.4375, 78.4482],
    madhapur: [17.4483, 78.3915],
    gachibowli: [17.4401, 78.3489],
    hitech: [17.4474, 78.3762],
    secunderabad: [17.4399, 78.4983],
    begumpet: [17.4447, 78.4664],
    banjara: [17.4156, 78.4357],
    jubilee: [17.4319, 78.4074],
    miyapur: [17.4969, 78.3562],
    dilsukhnagar: [17.3688, 78.5247],
    charminar: [17.3616, 78.4747],
    hyderabad: [17.3850, 78.4867],
    bangalore: [12.9716, 77.5946],
    delhi: [28.6139, 77.2090],
    mumbai: [19.0760, 72.8777],
    chennai: [13.0827, 80.2707],
  };

  for (const [key, coords] of Object.entries(knownLocations)) {
    if (normalized.includes(key)) {
      return { lat: coords[0], lng: coords[1] };
    }
  }

  const baseLat = fallbackLat ?? 17.3850;
  const baseLng = fallbackLng ?? 78.4867;
  let hash = 0;
  for (let i = 0; i < address.length; i++) {
    hash = (hash << 5) - hash + address.charCodeAt(i);
    hash |= 0;
  }
  const offsetLat = ((Math.abs(hash) % 100) - 50) * 0.001;
  const offsetLng = ((Math.abs(hash >> 3) % 100) - 50) * 0.001;
  return {
    lat: Number((baseLat + offsetLat).toFixed(5)),
    lng: Number((baseLng + offsetLng).toFixed(5)),
  };
}

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

  let lat = parsed.data.latitude ?? null;
  let lng = parsed.data.longitude ?? null;
  if (lat === null && parsed.data.address) {
    const resolved = resolveCoordinates(parsed.data.address, hospital.latitude, hospital.longitude);
    lat = resolved.lat;
    lng = resolved.lng;
  }

  try {
    const donor = await db.donor.create({
      data: {
        ...parsed.data,
        address: parsed.data.address,
        registeredByHospitalId: hospital.id,
        available: true,
        locationTokenHash,
        latitude: lat,
        longitude: lng,
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
