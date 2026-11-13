import { hash } from "bcryptjs";
import { db } from "../src/lib/db";

async function main() {
  const {
    SEED_HOSPITAL_NAME,
    SEED_HOSPITAL_ADDRESS,
    SEED_HOSPITAL_EMAIL,
    SEED_HOSPITAL_PASSWORD,
  } = process.env;
  if (
    !SEED_HOSPITAL_NAME ||
    !SEED_HOSPITAL_ADDRESS ||
    !SEED_HOSPITAL_EMAIL ||
    !SEED_HOSPITAL_PASSWORD
  ) {
    throw new Error(
      "Set SEED_HOSPITAL_NAME, SEED_HOSPITAL_ADDRESS, SEED_HOSPITAL_EMAIL, and SEED_HOSPITAL_PASSWORD before seeding.",
    );
  }
  if (SEED_HOSPITAL_PASSWORD.length < 12) {
    throw new Error("SEED_HOSPITAL_PASSWORD must contain at least 12 characters.");
  }

  const latitude = Number(process.env.SEED_HOSPITAL_LATITUDE);
  const longitude = Number(process.env.SEED_HOSPITAL_LONGITUDE);
  if (
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new Error("Set valid SEED_HOSPITAL_LATITUDE and SEED_HOSPITAL_LONGITUDE values.");
  }

  const email = SEED_HOSPITAL_EMAIL.toLowerCase();
  const passwordHash = await hash(SEED_HOSPITAL_PASSWORD, 12);
  await db.hospital.upsert({
    where: { email },
    create: {
      name: SEED_HOSPITAL_NAME,
      address: SEED_HOSPITAL_ADDRESS,
      email,
      passwordHash,
      latitude,
      longitude,
    },
    update: {
      name: SEED_HOSPITAL_NAME,
      address: SEED_HOSPITAL_ADDRESS,
      passwordHash,
      latitude,
      longitude,
    },
  });
  console.info(`Hospital account ready for ${email}.`);
}

main()
  .catch((error: unknown) => {
    console.error("Hospital seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
