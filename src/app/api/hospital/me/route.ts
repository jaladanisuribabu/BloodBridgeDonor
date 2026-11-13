import { NextResponse } from "next/server";
import { hospitalForRequest } from "@/lib/auth";

export async function GET() {
  const hospital = await hospitalForRequest();
  if (!hospital) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  return NextResponse.json({ hospital });
}
