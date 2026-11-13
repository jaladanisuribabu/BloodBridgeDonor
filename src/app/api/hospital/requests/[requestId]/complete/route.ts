import { NextRequest, NextResponse } from "next/server";
import { hospitalForRequest } from "@/lib/auth";
import { completeAcceptedDonors } from "@/lib/dispatch";
import { db } from "@/lib/db";

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ requestId: string }> },
) {
  const hospital = await hospitalForRequest();
  if (!hospital) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const { requestId } = await context.params;
  const emergencyRequest = await db.emergencyRequest.findFirst({
    where: { id: requestId, hospitalId: hospital.id },
    select: { id: true },
  });
  if (!emergencyRequest) {
    return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }
  await completeAcceptedDonors(requestId);
  return NextResponse.json({ ok: true });
}
