import { timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createHospitalSession } from "@/lib/auth";
import { db } from "@/lib/db";

const STATE_COOKIE = "hospital-google-state";
const NONCE_COOKIE = "hospital-google-nonce";
const VERIFIER_COOKIE = "hospital-google-verifier";
const googleKeys = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);

const tokenResponseSchema = z.object({
  id_token: z.string().min(1),
});

function sameValue(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function appDestination(request: NextRequest, error?: string): URL {
  const destination = new URL("/hospital", process.env.APP_URL ?? request.nextUrl.origin);
  if (error) destination.searchParams.set("google_error", error);
  return destination;
}

function clearOAuthCookies(response: NextResponse): void {
  for (const name of [STATE_COOKIE, NONCE_COOKIE, VERIFIER_COOKIE]) {
    response.cookies.set(name, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/hospital/google",
      maxAge: 0,
    });
  }
}

export async function GET(request: NextRequest) {
  const appUrl = process.env.APP_URL;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const stateCookie = request.cookies.get(STATE_COOKIE)?.value;
  const nonce = request.cookies.get(NONCE_COOKIE)?.value;
  const verifier = request.cookies.get(VERIFIER_COOKIE)?.value;

  if (!appUrl || !clientId || !clientSecret) {
    return NextResponse.redirect(appDestination(request, "not_configured"));
  }
  if (
    request.nextUrl.searchParams.has("error") ||
    !code ||
    !state ||
    !stateCookie ||
    !nonce ||
    !verifier ||
    !sameValue(state, stateCookie)
  ) {
    const response = NextResponse.redirect(appDestination(request, "failed"));
    clearOAuthCookies(response);
    return response;
  }

  try {
    const redirectUri = new URL("/api/hospital/google/callback", appUrl).toString();
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!tokenResponse.ok) {
      throw new Error(`Google token exchange failed with status ${tokenResponse.status}.`);
    }

    const parsedToken = tokenResponseSchema.safeParse(await tokenResponse.json());
    if (!parsedToken.success) throw new Error("Google did not return an ID token.");

    const { payload } = await jwtVerify(parsedToken.data.id_token, googleKeys, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: clientId,
    });
    const email = payload.email;
    if (
      typeof email !== "string" ||
      payload.email_verified !== true ||
      typeof payload.nonce !== "string" ||
      !sameValue(payload.nonce, nonce)
    ) {
      throw new Error("Google identity claims were missing or unverified.");
    }

    const hospital = await db.hospital.findUnique({
      where: { email: email.toLowerCase() },
      select: { id: true },
    });
    if (!hospital) {
      const response = NextResponse.redirect(appDestination(request, "account"));
      clearOAuthCookies(response);
      return response;
    }

    await createHospitalSession(hospital.id);
    const response = NextResponse.redirect(appDestination(request));
    clearOAuthCookies(response);
    return response;
  } catch (error) {
    console.error("Google hospital sign-in failed.", error);
    const response = NextResponse.redirect(appDestination(request, "failed"));
    clearOAuthCookies(response);
    return response;
  }
}
