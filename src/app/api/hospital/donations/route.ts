import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hospitalForRequest } from "@/lib/auth";
import { db } from "@/lib/db";

const createSchema = z.object({
  donorId: z.string().min(1),
  donatedAt: z.coerce.date(),
});

function addMonths(date: Date, months: number) {
  const result = new Date(date);
  const day = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(day, lastDay));
  return result;
}

export async function GET() {
  const hospital = await hospitalForRequest();
  if (!hospital) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const [donors, donations] = await Promise.all([
    db.donor.findMany({
      where: { registeredByHospitalId: hospital.id },
      orderBy: [{ name: "asc" }],
      select: { id: true, name: true, bloodGroup: true, nextEligibleAt: true },
    }),
    db.donorDonation.findMany({
      where: { hospitalId: hospital.id },
      orderBy: { donatedAt: "desc" },
      take: 100,
      include: { donor: { select: { name: true, bloodGroup: true } } },
    }),
  ]);
  return NextResponse.json({ donors, donations });
}

export async function POST(request: NextRequest) {
  const hospital = await hospitalForRequest();
  if (!hospital) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (hospital.donationIntervalMonths === null) {
    return NextResponse.json(
      { error: "Set your hospital-approved donation interval in Settings before recording donations." },
      { status: 409 },
    );
  }
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || parsed.data.donatedAt > new Date()) {
    return NextResponse.json({ error: "Choose a donor and a valid donation date/time in the past." }, { status: 400 });
  }

  const donor = await db.donor.findFirst({
    where: {
      id: parsed.data.donorId,
      registeredByHospitalId: hospital.id,
    },
    select: { id: true },
  });
  if (!donor) return NextResponse.json({ error: "Donor not found." }, { status: 404 });

  const nextEligibleAt = addMonths(
    parsed.data.donatedAt,
    hospital.donationIntervalMonths,
  );
  try {
    const donation = await db.$transaction(async (tx) => {
      const record = await tx.donorDonation.create({
        data: {
          donorId: donor.id,
          hospitalId: hospital.id,
          donatedAt: parsed.data.donatedAt,
          nextEligibleAt,
        },
      });
      const latest = await tx.donorDonation.findFirst({
        where: { donorId: donor.id },
        orderBy: [{ donatedAt: "desc" }, { createdAt: "desc" }],
        select: { nextEligibleAt: true },
      });
      await tx.donor.update({
        where: { id: donor.id },
        data: { nextEligibleAt: latest?.nextEligibleAt ?? nextEligibleAt },
      });
      return record;
    });
    return NextResponse.json({ donation }, { status: 201 });
  } catch (error) {
    console.error("Donor donation record could not be saved.", error);
    return NextResponse.json({ error: "Could not save this donation record." }, { status: 503 });
  }
}
