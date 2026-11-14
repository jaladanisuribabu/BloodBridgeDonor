import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hospitalForRequest } from "@/lib/auth";
import { db } from "@/lib/db";
import { cancelDonorCalls } from "@/lib/dispatch";

const consentSchema = z
  .object({
    callConsent: z.boolean().optional(),
    smsConsent: z.boolean().optional(),
  })
  .strict()
  .refine(
    (consent) =>
      consent.callConsent !== undefined || consent.smsConsent !== undefined,
  );

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ donorId: string }> },
) {
  const hospital = await hospitalForRequest();
  if (!hospital) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { donorId } = await context.params;
  const parsed = consentSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "A valid call or SMS consent status is required." },
      { status: 400 },
    );
  }

  const data: { callConsent?: boolean; smsConsent?: boolean } = {};
  if (parsed.data.callConsent !== undefined) {
    data.callConsent = parsed.data.callConsent;
  }
  if (parsed.data.smsConsent !== undefined) {
    data.smsConsent = parsed.data.smsConsent;
  }
  const updated = await db.donor.updateMany({
    where: { id: donorId, registeredByHospitalId: hospital.id },
    data,
  });
  if (updated.count === 0) {
    return NextResponse.json({ error: "Donor record not found." }, { status: 404 });
  }
  if (parsed.data.callConsent === false) {
    await cancelDonorCalls(donorId);
  }

  return NextResponse.json(
    { id: donorId, ...data },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
