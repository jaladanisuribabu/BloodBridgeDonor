import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hospitalForRequest } from "@/lib/auth";
import { db } from "@/lib/db";

const updateSchema = z.object({
  unitsIssued: z.number().int().min(0).optional(),
  status: z.enum(["OPEN", "FULFILLED", "CANCELLED"]).optional(),
  notes: z.string().trim().max(500).nullable().optional(),
}).refine((value) => Object.keys(value).length > 0);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ caseId: string }> },
) {
  const hospital = await hospitalForRequest();
  if (!hospital) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const { caseId } = await params;
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid patient case update." }, { status: 400 });
  }
  try {
    const patientCase = await db.$transaction(async (tx) => {
      const existing = await tx.patientCase.findFirst({
        where: { id: caseId, hospitalId: hospital.id },
      });
      if (!existing) throw new Error("PATIENT_CASE_NOT_FOUND");
      const unitsIssued = parsed.data.unitsIssued ?? existing.unitsIssued;
      if (unitsIssued > existing.unitsRequired) throw new Error("ISSUED_UNITS_EXCEED_REQUEST");

      const delta = unitsIssued - existing.unitsIssued;
      if (existing.status === "CANCELLED" && delta > 0) {
        throw new Error("PATIENT_CASE_CANCELLED");
      }
      if (delta > 0) {
        const stock = await tx.bloodInventory.updateMany({
          where: {
            hospitalId: hospital.id,
            bloodGroup: existing.bloodGroup,
            unitsAvailable: { gte: delta },
          },
          data: { unitsAvailable: { decrement: delta } },
        });
        if (stock.count !== 1) throw new Error("INSUFFICIENT_BLOOD_STOCK");
        await tx.inventoryChange.create({
          data: {
            hospitalId: hospital.id,
            bloodGroup: existing.bloodGroup,
            unitsDelta: -delta,
            reason: "PATIENT_CASE_ISSUE",
            patientCaseId: existing.id,
          },
        });
      } else if (delta < 0) {
        await tx.bloodInventory.upsert({
          where: {
            hospitalId_bloodGroup: {
              hospitalId: hospital.id,
              bloodGroup: existing.bloodGroup,
            },
          },
          create: {
            hospitalId: hospital.id,
            bloodGroup: existing.bloodGroup,
            unitsAvailable: -delta,
          },
          update: { unitsAvailable: { increment: -delta } },
        });
        await tx.inventoryChange.create({
          data: {
            hospitalId: hospital.id,
            bloodGroup: existing.bloodGroup,
            unitsDelta: -delta,
            reason: "PATIENT_CASE_CORRECTION",
            patientCaseId: existing.id,
          },
        });
      }

      const requestedStatus = parsed.data.status ?? existing.status;
      const status = requestedStatus === "CANCELLED"
        ? "CANCELLED"
        : unitsIssued >= existing.unitsRequired
          ? "FULFILLED"
          : requestedStatus === "FULFILLED"
            ? "OPEN"
            : requestedStatus;
      const updated = await tx.patientCase.updateMany({
        where: {
          id: existing.id,
          hospitalId: hospital.id,
          unitsIssued: existing.unitsIssued,
        },
        data: { ...parsed.data, ...(status ? { status } : {}) },
      });
      if (updated.count !== 1) throw new Error("PATIENT_CASE_CHANGED");
      return tx.patientCase.findUniqueOrThrow({ where: { id: existing.id } });
    });
    return NextResponse.json({ case: patientCase });
  } catch (error) {
    if (error instanceof Error && error.message === "PATIENT_CASE_NOT_FOUND") {
      return NextResponse.json({ error: "Patient case not found." }, { status: 404 });
    }
    if (error instanceof Error && error.message === "ISSUED_UNITS_EXCEED_REQUEST") {
      return NextResponse.json({ error: "Issued units cannot exceed requested units." }, { status: 400 });
    }
    if (error instanceof Error && error.message === "INSUFFICIENT_BLOOD_STOCK") {
      return NextResponse.json({ error: "There is not enough blood stock to issue those additional units. Update the inventory after verifying stock." }, { status: 409 });
    }
    if (error instanceof Error && error.message === "PATIENT_CASE_CANCELLED") {
      return NextResponse.json({ error: "Cancelled cases cannot issue additional blood units." }, { status: 409 });
    }
    if (error instanceof Error && error.message === "PATIENT_CASE_CHANGED") {
      return NextResponse.json({ error: "This patient case changed in another update. Refresh and retry." }, { status: 409 });
    }
    console.error("Patient case update failed.", error);
    return NextResponse.json({ error: "Could not update the patient case." }, { status: 503 });
  }
}
