const fs = require("fs");
const path = require("path");
const pool = require("../backend/db");
const { normalizeFacility } = require("../backend/facility-directory");

const sourceDirectory = process.argv[2];
if (!sourceDirectory) {
  console.error("Usage: node scripts/import-facility-directory.js <json-directory>");
  process.exit(1);
}

const upsertFacility = `
  INSERT INTO facility_directory (
    external_place_id, source_pin_codes, resolved_pin_code, pin_confidence,
    name, facility_type, address, phone, website, latitude, longitude
  ) VALUES ($1, ARRAY[$2], $3, $4, $5, $6, $7, $8, $9, $10, $11)
  ON CONFLICT (external_place_id) DO UPDATE SET
    source_pin_codes = CASE
      WHEN $2 = ANY(facility_directory.source_pin_codes) THEN facility_directory.source_pin_codes
      ELSE array_append(facility_directory.source_pin_codes, $2)
    END,
    resolved_pin_code = EXCLUDED.resolved_pin_code,
    pin_confidence = EXCLUDED.pin_confidence,
    name = EXCLUDED.name,
    facility_type = EXCLUDED.facility_type,
    address = EXCLUDED.address,
    phone = EXCLUDED.phone,
    website = EXCLUDED.website,
    latitude = EXCLUDED.latitude,
    longitude = EXCLUDED.longitude,
    imported_at = CURRENT_TIMESTAMP
`;

async function run() {
  const files = fs.readdirSync(sourceDirectory)
    .filter(file => /^\d{6}\.json$/.test(file))
    .sort();
  if (!files.length) throw new Error("No six-digit PIN JSON files were found.");

  const client = await pool.connect();
  let imported = 0;
  let skipped = 0;
  try {
    await client.query("BEGIN");
    for (const file of files) {
      const sourcePinCode = path.basename(file, ".json");
      const records = JSON.parse(fs.readFileSync(path.join(sourceDirectory, file), "utf8"));
      if (!Array.isArray(records)) throw new Error(`${file} must contain a JSON array.`);
      for (const record of records) {
        const facility = normalizeFacility(sourcePinCode, record || {});
        if (!facility) { skipped += 1; continue; }
        await client.query(upsertFacility, [
          facility.externalPlaceId, facility.sourcePinCode, facility.resolvedPinCode,
          facility.pinConfidence, facility.name, facility.facilityType, facility.address,
          facility.phone, facility.website, facility.latitude, facility.longitude
        ]);
        imported += 1;
      }
    }
    await client.query("COMMIT");
    console.log(`Imported ${imported} listings; skipped ${skipped} incomplete records.`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(error => {
  console.error(`Facility import failed: ${error.message}`);
  process.exitCode = 1;
});
