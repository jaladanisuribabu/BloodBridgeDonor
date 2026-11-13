import { NextResponse } from "next/server";
import { patientForRequest } from "@/lib/auth";

export async function GET() {
  const patient = await patientForRequest();
  if (!patient) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  return NextResponse.json({ patient });
}
