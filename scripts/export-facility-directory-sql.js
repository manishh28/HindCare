const fs = require("fs");
const path = require("path");
const { normalizeFacility, mergeFacilities } = require("../backend/facility-directory");

const [sourceDirectory, outputFile] = process.argv.slice(2);
if (!sourceDirectory || !outputFile) {
  console.error("Usage: node scripts/export-facility-directory-sql.js <json-directory> <output-file>");
  process.exit(1);
}

function sqlText(value) {
  return value === null ? "NULL" : `'${String(value).replace(/'/g, "''")}'`;
}

function rowSql(facility) {
  return `(${[
    sqlText(facility.externalPlaceId),
    `ARRAY[${facility.sourcePinCodes.map(sqlText).join(", ")}]`,
    sqlText(facility.resolvedPinCode),
    sqlText(facility.pinConfidence),
    sqlText(facility.name),
    sqlText(facility.facilityType),
    sqlText(facility.address),
    sqlText(facility.phone),
    sqlText(facility.website),
    facility.latitude,
    facility.longitude
  ].join(", ")})`;
}

const upsertTail = `
ON CONFLICT (external_place_id) DO UPDATE SET
  source_pin_codes = CASE
  source_pin_codes = ARRAY(
    SELECT DISTINCT pin
    FROM unnest(facility_directory.source_pin_codes || EXCLUDED.source_pin_codes) AS pin
  ),
  resolved_pin_code = EXCLUDED.resolved_pin_code,
  pin_confidence = EXCLUDED.pin_confidence,
  name = EXCLUDED.name,
  facility_type = EXCLUDED.facility_type,
  address = EXCLUDED.address,
  phone = EXCLUDED.phone,
  website = EXCLUDED.website,
  latitude = EXCLUDED.latitude,
  longitude = EXCLUDED.longitude,
  imported_at = CURRENT_TIMESTAMP;`;

const files = fs.readdirSync(sourceDirectory).filter(file => /^\d{6}\.json$/.test(file)).sort();
const facilities = [];
let skipped = 0;
for (const file of files) {
  const sourcePinCode = path.basename(file, ".json");
  const records = JSON.parse(fs.readFileSync(path.join(sourceDirectory, file), "utf8"));
  if (!Array.isArray(records)) throw new Error(`${file} must contain a JSON array.`);
  for (const record of records) {
    const facility = normalizeFacility(sourcePinCode, record || {});
    if (facility) facilities.push(facility);
    else skipped += 1;
  }
}

const rows = mergeFacilities(facilities).map(rowSql);
const statements = ["BEGIN;"];
for (let index = 0; index < rows.length; index += 250) {
  statements.push(`INSERT INTO facility_directory (
  external_place_id, source_pin_codes, resolved_pin_code, pin_confidence,
  name, facility_type, address, phone, website, latitude, longitude
) VALUES\n${rows.slice(index, index + 250).join(",\n")}${upsertTail}`);
}
statements.push("COMMIT;");
fs.writeFileSync(outputFile, `${statements.join("\n\n")}\n`, "utf8");
console.log(`Created ${outputFile} with ${rows.length} unique listings from ${facilities.length} source records; skipped ${skipped} incomplete records.`);
