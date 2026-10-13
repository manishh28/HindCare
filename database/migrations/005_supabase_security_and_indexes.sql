-- Keep external discovery data behind the HindCare server API. No anon or
-- authenticated Supabase Data API policy is intentionally created.
ALTER TABLE facility_directory ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE facility_directory FROM anon, authenticated;
REVOKE ALL ON SEQUENCE facility_directory_id_seq FROM anon, authenticated;

-- Current HindCare query paths. Guard each index for fresh or older schemas
-- where a later application column has not been created yet.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ambulances' AND column_name = 'owner_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_ambulances_owner_id ON ambulances (owner_id)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ambulances' AND column_name = 'driver_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_ambulances_driver_id ON ambulances (driver_id)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'bookings' AND column_name = 'ambulance_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_bookings_ambulance_id ON bookings (ambulance_id)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'bookings' AND column_name = 'assigned_driver_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_bookings_assigned_driver_id ON bookings (assigned_driver_id)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'bookings' AND column_name = 'hospital_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_bookings_hospital_id ON bookings (hospital_id)';
  END IF;
END $$;
