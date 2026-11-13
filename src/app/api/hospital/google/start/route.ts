import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

const STATE_COOKIE = "hospital-google-state";
const NONCE_COOKIE = "hospital-google-nonce";
const VERIFIER_COOKIE = "hospital-google-verifier";
const COOKIE_TTL_SECONDS = 10 * 60;

function configuredUrl(path: string): URL | null {
  const appUrl = process.env.APP_URL;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!appUrl || !clientId) return null;

  const base = new URL(appUrl);
  if (
    (base.protocol !== "https:" && base.hostname !== "localhost") ||
    base.username ||
    base.password
  ) {
    throw new Error("APP_URL must be a trusted HTTPS application URL.");
  }
  return new URL(path, base);
}

function oauthCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/api/hospital/google",
    maxAge: COOKIE_TTL_SECONDS,
  };
}

export async function GET(request: NextRequest) {
  const appUrl = process.env.APP_URL;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!appUrl || !clientId || !clientSecret) {
    const destination = new URL("/hospital", appUrl ?? request.nextUrl.origin);
    destination.searchParams.set("google_error", "not_configured");
    return NextResponse.redirect(destination);
  }

  const redirectUri = configuredUrl("/api/hospital/google/callback");
  if (!redirectUri) {
    return NextResponse.json({ error: "Google sign-in is unavailable." }, { status: 503 });
  }

  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const authorizeUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorizeUrl.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri.toString(),
    response_type: "code",
    scope: "openid email",
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();

  const response = NextResponse.redirect(authorizeUrl);
  const options = oauthCookieOptions();
  response.cookies.set(STATE_COOKIE, state, options);
  response.cookies.set(NONCE_COOKIE, nonce, options);
  response.cookies.set(VERIFIER_COOKIE, verifier, options);
  return response;
}
