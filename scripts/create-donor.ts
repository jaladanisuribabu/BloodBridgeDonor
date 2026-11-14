import { createHash, randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { BloodGroup } from "@prisma/client";
import { db } from "../src/lib/db";

const groups = Object.values(BloodGroup);
const phonePattern = /^\+[1-9]\d{7,14}$/;

async function main() {
  const input = createInterface({ input: stdin, output: stdout });
  try {
    const name = (await input.question("Donor name: ")).trim();
    const phone = (await input.question("Phone (E.164, e.g. +14155550123): ")).trim();
    const bloodGroup = (await input.question(`Blood group (${groups.join(", ")}): `))
      .trim()
      .toUpperCase() as BloodGroup;
    const latitudeText = (await input.question("Current latitude: ")).trim();
    const longitudeText = (await input.question("Current longitude: ")).trim();
    const trackingConsent =
      (await input.question("Has the donor explicitly consented to location tracking? (yes/no): "))
        .trim()
        .toLowerCase() === "yes";
    const callConsent =
      (await input.question("Has the donor explicitly consented to emergency calls? (yes/no): "))
        .trim()
        .toLowerCase() === "yes";

    const latitude = Number(latitudeText);
    const longitude = Number(longitudeText);
    if (!name || name.length > 120) throw new Error("Enter a donor name of 1-120 characters.");
    if (!phonePattern.test(phone)) throw new Error("Phone number must be E.164 formatted.");
    if (!groups.includes(bloodGroup)) throw new Error("Choose a supported blood group.");
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      throw new Error("Latitude must be between -90 and 90.");
    }
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new Error("Longitude must be between -180 and 180.");
    }

    const locationToken = randomBytes(32).toString("base64url");
    const locationTokenHash = createHash("sha256").update(locationToken).digest("hex");
    await db.donor.create({
      data: {
        name,
        phone,
        bloodGroup,
        callConsent,
        trackingConsent,
        locationTokenHash,
        latitude,
        longitude,
      },
    });

    console.info(
      `Donor ${name} created. Call consent: ${callConsent}; location consent: ${trackingConsent}.`,
    );
    if (trackingConsent) {
      console.info("Deliver this location token to the donor over a secure channel (shown once):");
      console.info(locationToken);
    } else {
      console.info("This donor will not be matched until location consent is recorded.");
    }
  } finally {
    input.close();
  }
}

main()
  .catch((error: unknown) => {
    console.error("Donor creation failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
