import { NextResponse } from "next/server";
import { clearPatientSession } from "@/lib/auth";

export async function POST() {
  await clearPatientSession();
  return NextResponse.json({ ok: true });
}
