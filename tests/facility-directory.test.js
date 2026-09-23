const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeFacility, mergeFacilities } = require("../backend/facility-directory");

const baseRecord = {
  place_id: "place-123",
  title: "Example Hospital",
  type: "Private hospital",
  address: "Example Road, Lucknow, Uttar Pradesh 226002, India",
  gps_coordinates: { latitude: 26.85, longitude: 80.95 }
};

test("uses an address PIN instead of the source filename PIN", () => {
  const facility = normalizeFacility("226001", baseRecord);

  assert.equal(facility.resolvedPinCode, "226002");
  assert.equal(facility.pinConfidence, "address");
  assert.equal(facility.facilityType, "hospital");
});

test("falls back to the source PIN when an address has no PIN", () => {
  const facility = normalizeFacility("226001", { ...baseRecord, address: "Example Road, Lucknow" });

  assert.equal(facility.resolvedPinCode, "226001");
  assert.equal(facility.pinConfidence, "source");
});

test("does not publish medical stores as hospitals", () => {
  const facility = normalizeFacility("226001", {
    ...baseRecord,
    title: "Example Medical Store",
    type: "Medical store",
    types: ["Medical center", "Pharmacy", "Clinic"]
  });

  assert.equal(facility.facilityType, "other");
});

test("merges duplicate place IDs and retains every source PIN", () => {
  const merged = mergeFacilities([
    normalizeFacility("226001", { ...baseRecord, address: "Example Road, Lucknow" }),
    normalizeFacility("226002", baseRecord)
  ]);

  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].sourcePinCodes, ["226001", "226002"]);
  assert.equal(merged[0].resolvedPinCode, "226002");
  assert.equal(merged[0].pinConfidence, "address");
});

test("rejects incomplete external records", () => {
  assert.equal(normalizeFacility("226001", { ...baseRecord, place_id: "" }), null);
  assert.equal(normalizeFacility("226001", { ...baseRecord, gps_coordinates: { latitude: 99, longitude: 80.95 } }), null);
});
