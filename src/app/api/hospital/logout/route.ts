import { NextResponse } from "next/server";
import { clearHospitalSession } from "@/lib/auth";

export async function POST() {
  await clearHospitalSession();
  return NextResponse.json({ ok: true });
}
