-- Repair role metadata for the existing HindCare demo accounts. The previous
-- ERP role selector could submit the first option when roleSlug was missing,
-- which allowed persisted role metadata to drift from the account identity.

UPDATE app_auth_state
SET data = (
  SELECT jsonb_agg(
    CASE
      WHEN entry->>'email' = 'rahul.singh@fleet.hindcare.in'
        THEN jsonb_set(jsonb_set(entry, '{roleSlug}', '"driver"'), '{roleId}', '1')
      WHEN entry->>'email' = 'suresh@yadavambulance.in'
        THEN jsonb_set(jsonb_set(entry, '{roleSlug}', '"fleet_owner"'), '{roleId}', '6')
      WHEN entry->>'email' = 'dispatch@hindcare.in'
        THEN jsonb_set(jsonb_set(entry, '{roleSlug}', '"dispatcher"'), '{roleId}', '2')
      WHEN entry->>'email' = 'admin@hindcare-hospital.in'
        THEN jsonb_set(jsonb_set(entry, '{roleSlug}', '"hospital_admin"'), '{roleId}', '3')
      WHEN entry->>'email' = 'doctor@hindcare-hospital.in'
        THEN jsonb_set(jsonb_set(entry, '{roleSlug}', '"hospital_doctor"'), '{roleId}', '7')
      WHEN entry->>'email' = 'reception@hindcare-hospital.in'
        THEN jsonb_set(jsonb_set(entry, '{roleSlug}', '"hospital_reception"'), '{roleId}', '8')
      WHEN entry->>'email' = 'superadmin@hindcare.in'
        THEN jsonb_set(jsonb_set(entry, '{roleSlug}', '"super_admin"'), '{roleId}', '4')
      ELSE entry
    END
  )
  FROM jsonb_array_elements(data) AS entry
)
WHERE collection = 'users';

-- Keep the relational identity table aligned with the same role decisions.
UPDATE users
SET role = CASE email
  WHEN 'rahul.singh@fleet.hindcare.in' THEN 'driver'
  WHEN 'suresh@yadavambulance.in' THEN 'fleet_owner'
  WHEN 'dispatch@hindcare.in' THEN 'dispatcher'
  WHEN 'admin@hindcare-hospital.in' THEN 'hospital_admin'
  WHEN 'superadmin@hindcare.in' THEN 'super_admin'
  ELSE role
END
WHERE email IN (
  'rahul.singh@fleet.hindcare.in',
  'suresh@yadavambulance.in',
  'dispatch@hindcare.in',
  'admin@hindcare-hospital.in',
  'superadmin@hindcare.in'
);

-- The role repair makes the persisted Rahul identity (ID 6) the actual
-- ambulance/booking driver identity rather than the legacy ID 1.
UPDATE ambulances
SET driver_id = 6
WHERE lower(driver_name) = 'rahul singh';

UPDATE bookings
SET assigned_driver_id = 6
WHERE ambulance_id IN (SELECT id FROM ambulances WHERE driver_id = 6)
  AND (assigned_driver_id IS NULL OR assigned_driver_id = 1);
