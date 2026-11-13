import { compare } from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { db } from "@/lib/db";

const COOKIE_NAME = "hospital-session";
const SESSION_TTL_SECONDS = 60 * 60 * 8;

function sessionKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters.");
  }
  return new TextEncoder().encode(secret);
}

export async function createHospitalSession(hospitalId: string): Promise<void> {
  const token = await new SignJWT({ role: "hospital" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(hospitalId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(sessionKey());

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearHospitalSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export async function currentHospitalId(): Promise<string | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, sessionKey());
    return payload.role === "hospital" && typeof payload.sub === "string"
      ? payload.sub
      : null;
  } catch {
    return null;
  }
}

export async function authenticateHospital(
  email: string,
  password: string,
): Promise<string | null> {
  const hospital = await db.hospital.findUnique({
    where: { email: email.toLowerCase() },
    select: { id: true, passwordHash: true },
  });

  if (!hospital || !(await compare(password, hospital.passwordHash))) return null;
  return hospital.id;
}

export async function hospitalForRequest() {
  const hospitalId = await currentHospitalId();
  if (!hospitalId) return null;
  return db.hospital.findUnique({
    where: { id: hospitalId },
    select: {
      id: true,
      name: true,
      email: true,
      address: true,
      latitude: true,
      longitude: true,
    },
  });
}
