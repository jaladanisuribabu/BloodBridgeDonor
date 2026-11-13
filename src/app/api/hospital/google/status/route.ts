import { NextResponse } from "next/server";

export async function GET() {
  const configured = Boolean(
    process.env.APP_URL &&
      process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET,
  );
  return NextResponse.json({ configured }, { headers: { "Cache-Control": "no-store" } });
}
