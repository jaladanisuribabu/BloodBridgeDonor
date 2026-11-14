import assert from "node:assert/strict";
import test from "node:test";
import { buildEligibleDonorQuery } from "@/lib/proximity";

test("matches call-consented donors nationwide without requiring GPS or tracking consent", () => {
  const query = buildEligibleDonorQuery({
    bloodGroup: "A_POSITIVE",
    latitude: null,
    longitude: null,
    limit: 5,
  });

  assert.match(query.sql, /d\."callConsent" = true/);
  assert.doesNotMatch(query.sql, /trackingConsent/);
  assert.doesNotMatch(query.sql, /d\."latitude" IS NOT NULL/);
  assert.doesNotMatch(query.sql, /<=\s*5/);
  assert.match(query.sql, /LIMIT/);
});

test("known coordinates only sort eligible donors; they do not impose a radius", () => {
  const query = buildEligibleDonorQuery({
    bloodGroup: "O_POSITIVE",
    latitude: 40.7,
    longitude: -73.9,
    limit: 5,
  });

  assert.match(query.sql, /distanceKm/);
  assert.doesNotMatch(query.sql, /<=\s*5/);
  assert.doesNotMatch(query.sql, /d\."latitude" BETWEEN/);
});
