-- External discovery listings are deliberately separate from the verified
-- HindCare hospital-partner registry and cannot be used for booking.
CREATE TABLE IF NOT EXISTS facility_directory (
  id BIGSERIAL PRIMARY KEY,
  external_place_id VARCHAR(200) NOT NULL UNIQUE,
  source_pin_codes VARCHAR(6)[] NOT NULL,
  resolved_pin_code VARCHAR(6) NOT NULL,
  pin_confidence VARCHAR(10) NOT NULL CHECK (pin_confidence IN ('address', 'source')),
  name VARCHAR(180) NOT NULL,
  facility_type VARCHAR(20) NOT NULL CHECK (facility_type IN ('hospital', 'clinic', 'other')),
  address TEXT NOT NULL,
  phone VARCHAR(40),
  website TEXT,
  latitude DECIMAL(9, 6) NOT NULL,
  longitude DECIMAL(9, 6) NOT NULL,
  verification_status VARCHAR(20) NOT NULL DEFAULT 'unverified' CHECK (verification_status = 'unverified'),
  imported_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_facility_directory_pin_type
  ON facility_directory (resolved_pin_code, facility_type);
