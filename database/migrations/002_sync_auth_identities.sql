-- Synchronize the persisted application-auth users with the relational users
-- table used by ambulance and booking foreign keys.
-- Safe to run more than once: rows are upserted by their stable auth ID.

WITH auth_users AS (
  SELECT
    (entry->>'id')::BIGINT AS id,
    COALESCE(entry->>'email', '') AS email,
    COALESCE(entry->>'phone', '') AS phone,
    COALESCE(entry->>'roleSlug', '') AS role_slug,
    COALESCE(entry->>'createdAt', CURRENT_TIMESTAMP::text)::TIMESTAMP AS created_at,
    COALESCE(entry->>'profile', '') AS profile_json
  FROM app_auth_state state
  CROSS JOIN LATERAL jsonb_array_elements(state.data) AS entry
  WHERE state.collection = 'users'
),
mapped_users AS (
  SELECT
    id,
    email,
    phone,
    CASE
      WHEN role_slug = 'customer' THEN 'patient'
      WHEN role_slug IN ('driver', 'dispatcher', 'hospital_admin', 'fleet_owner', 'super_admin') THEN role_slug
      ELSE NULL
    END AS role,
    created_at
  FROM auth_users
  WHERE role_slug IN ('customer', 'driver', 'dispatcher', 'hospital_admin', 'fleet_owner', 'super_admin')
)
INSERT INTO users (id, full_name, phone, email, role, password_hash, created_at)
SELECT
  id,
  COALESCE(NULLIF(split_part(email, '@', 1), ''), 'HindCare user'),
  phone,
  NULLIF(email, ''),
  role,
  NULL,
  created_at
FROM mapped_users
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  phone = EXCLUDED.phone,
  role = EXCLUDED.role;

SELECT setval(
  pg_get_serial_sequence('users', 'id'),
  GREATEST((SELECT COALESCE(MAX(id), 1) FROM users), 1),
  true
);

-- Relink legacy demo records to the matching persisted driver identity.
WITH driver_links AS (
  SELECT
    db_user.id AS driver_id,
    profile_entry->>'fullName' AS full_name
  FROM app_auth_state auth_state
  CROSS JOIN LATERAL jsonb_array_elements(auth_state.data) AS auth_entry
  JOIN users db_user
    ON lower(db_user.email) = lower(auth_entry->>'email')
   AND db_user.role = 'driver'
  JOIN app_auth_state profile_state
    ON profile_state.collection = 'driverProfiles'
  CROSS JOIN LATERAL jsonb_array_elements(profile_state.data) AS profile_entry
  WHERE auth_state.collection = 'users'
    AND profile_entry->>'userId' = auth_entry->>'id'
)
UPDATE ambulances ambulance
SET driver_id = driver_links.driver_id
FROM driver_links
WHERE lower(ambulance.driver_name) = lower(driver_links.full_name)
  AND ambulance.driver_id IS DISTINCT FROM driver_links.driver_id;

UPDATE bookings booking
SET assigned_driver_id = ambulance.driver_id
FROM ambulances ambulance
WHERE booking.ambulance_id = ambulance.id
  AND ambulance.driver_id IS NOT NULL
  AND (
    booking.assigned_driver_id IS NULL
    OR booking.assigned_driver_id = 1
  );
