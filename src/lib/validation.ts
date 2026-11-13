import { z } from "zod";

export const bloodGroupSchema = z.enum([
  "O_NEGATIVE",
  "O_POSITIVE",
  "A_NEGATIVE",
  "A_POSITIVE",
  "B_NEGATIVE",
  "B_POSITIVE",
  "AB_NEGATIVE",
  "AB_POSITIVE",
]);

export const emergencyRequestSchema = z.object({
  bloodGroup: bloodGroupSchema,
  unitsRequired: z.number().int().min(1).max(20),
});

export const locationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyMeters: z.number().min(0).max(100_000).optional(),
});
