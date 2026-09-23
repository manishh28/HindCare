const PIN_CODE_PATTERN = /\b([1-9]\d{5})\b/;

function cleanText(value, maxLength) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  return text ? text.slice(0, maxLength) : null;
}

function validCoordinate(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function normalizeFacilityType(record) {
  const primaryType = String(record.type || "").toLowerCase();
  if (/(pharmacy|medical store|diagnostic|pathology|laboratory|\blab\b)/.test(primaryType)) return "other";
  if (/(hospital|nursing home)/.test(primaryType)) return "hospital";
  if (/clinic/.test(primaryType)) return "clinic";

  const labels = (Array.isArray(record.types) ? record.types : [])
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (/(hospital|nursing home)/.test(labels)) return "hospital";
  if (/clinic/.test(labels)) return "clinic";
  return "other";
}

function normalizeWebsite(value) {
  const website = cleanText(value, 500);
  if (!website) return null;
  try {
    const url = new URL(website);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function normalizeFacility(sourcePinCode, record) {
  const externalPlaceId = cleanText(record.place_id, 200);
  const name = cleanText(record.title, 180);
  const address = cleanText(record.address, 500);
  const latitude = validCoordinate(record.gps_coordinates?.latitude, -90, 90);
  const longitude = validCoordinate(record.gps_coordinates?.longitude, -180, 180);
  if (!/^\d{6}$/.test(sourcePinCode) || !externalPlaceId || !name || !address || latitude === null || longitude === null) {
    return null;
  }

  const addressPin = address.match(PIN_CODE_PATTERN)?.[1] || null;
  return {
    externalPlaceId,
    sourcePinCode,
    resolvedPinCode: addressPin || sourcePinCode,
    pinConfidence: addressPin ? "address" : "source",
    name,
    facilityType: normalizeFacilityType(record),
    address,
    phone: cleanText(record.phone, 40),
    website: normalizeWebsite(record.website),
    latitude,
    longitude
  };
}

function mergeFacilities(facilities) {
  const merged = new Map();
  for (const facility of facilities) {
    const existing = merged.get(facility.externalPlaceId);
    if (!existing) {
      merged.set(facility.externalPlaceId, { ...facility, sourcePinCodes: [facility.sourcePinCode] });
      continue;
    }
    const sourcePinCodes = new Set(existing.sourcePinCodes);
    sourcePinCodes.add(facility.sourcePinCode);
    const preferred = existing.pinConfidence === "source" && facility.pinConfidence === "address" ? facility : existing;
    merged.set(facility.externalPlaceId, { ...preferred, sourcePinCodes: [...sourcePinCodes] });
  }
  return [...merged.values()];
}

module.exports = { normalizeFacility, mergeFacilities };
