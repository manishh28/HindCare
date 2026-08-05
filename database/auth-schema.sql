-- HindCare Authentication & Profile Management Schema
-- Production-ready normalized schema for PostgreSQL 14+

-- ============================================================
-- CORE IDENTITY & ACCESS CONTROL
-- ============================================================

CREATE TABLE roles (
  id SMALLSERIAL PRIMARY KEY,
  slug VARCHAR(40) NOT NULL UNIQUE,
  name VARCHAR(80) NOT NULL,
  description TEXT,
  mfa_required BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE permissions (
  id SERIAL PRIMARY KEY,
  slug VARCHAR(80) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  module VARCHAR(60) NOT NULL,
  description TEXT
);

CREATE TABLE role_permissions (
  role_id SMALLINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  role_id SMALLINT NOT NULL REFERENCES roles(id),
  employee_id VARCHAR(40) UNIQUE,
  email VARCHAR(160) UNIQUE,
  phone VARCHAR(20) UNIQUE,
  password_hash TEXT,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
  mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  mfa_secret TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'pending', 'locked', 'suspended', 'deleted')),
  failed_login_attempts SMALLINT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  password_changed_at TIMESTAMPTZ,
  google_id VARCHAR(120) UNIQUE,
  preferred_language VARCHAR(10) NOT NULL DEFAULT 'en',
  theme VARCHAR(10) NOT NULL DEFAULT 'light' CHECK (theme IN ('light', 'dark', 'system')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ,
  CONSTRAINT users_contact_check CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

CREATE TABLE user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash TEXT NOT NULL,
  device_name VARCHAR(120),
  ip_address INET,
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE otp_verifications (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  channel VARCHAR(10) NOT NULL CHECK (channel IN ('email', 'phone')),
  destination VARCHAR(160) NOT NULL,
  purpose VARCHAR(30) NOT NULL
    CHECK (purpose IN ('login', 'signup', 'reset_password', 'verify_email', 'verify_phone', 'mfa')),
  otp_hash TEXT NOT NULL,
  attempts SMALLINT NOT NULL DEFAULT 0,
  max_attempts SMALLINT NOT NULL DEFAULT 5,
  expires_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE password_reset_tokens (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE audit_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(80) NOT NULL,
  resource_type VARCHAR(60),
  resource_id VARCHAR(80),
  ip_address INET,
  user_agent TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE login_history (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  success BOOLEAN NOT NULL,
  method VARCHAR(20) NOT NULL,
  ip_address INET,
  user_agent TEXT,
  failure_reason VARCHAR(120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- PROFILE TABLES (ROLE-SPECIFIC EXTENSIONS)
-- ============================================================

CREATE TABLE customer_profiles (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  full_name VARCHAR(120) NOT NULL,
  gender VARCHAR(20) CHECK (gender IN ('male', 'female', 'other', 'prefer_not_to_say')),
  date_of_birth DATE,
  blood_group VARCHAR(5),
  height_cm DECIMAL(5, 2),
  weight_kg DECIMAL(5, 2),
  profile_photo_url TEXT,
  language_preference VARCHAR(10) NOT NULL DEFAULT 'en',
  notification_email BOOLEAN NOT NULL DEFAULT TRUE,
  notification_sms BOOLEAN NOT NULL DEFAULT TRUE,
  notification_push BOOLEAN NOT NULL DEFAULT TRUE,
  privacy_share_location BOOLEAN NOT NULL DEFAULT TRUE,
  privacy_share_medical BOOLEAN NOT NULL DEFAULT FALSE,
  wallet_balance DECIMAL(12, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE driver_profiles (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  full_name VARCHAR(120) NOT NULL,
  license_number VARCHAR(40) NOT NULL,
  license_expiry DATE NOT NULL,
  ambulance_id BIGINT REFERENCES ambulances(id),
  vehicle_number VARCHAR(40),
  availability_status VARCHAR(20) NOT NULL DEFAULT 'offline'
    CHECK (availability_status IN ('available', 'busy', 'on_break', 'offline')),
  experience_years SMALLINT NOT NULL DEFAULT 0,
  languages TEXT[] NOT NULL DEFAULT '{en,hi}',
  rating DECIMAL(3, 2) NOT NULL DEFAULT 0,
  completed_trips INT NOT NULL DEFAULT 0,
  profile_photo_url TEXT,
  emergency_contact_name VARCHAR(120),
  emergency_contact_phone VARCHAR(20),
  current_shift_start TIMESTAMPTZ,
  current_shift_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE dispatcher_profiles (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  full_name VARCHAR(120) NOT NULL,
  department VARCHAR(80) NOT NULL DEFAULT 'Call Center',
  assigned_region VARCHAR(120),
  shift_start TIME,
  shift_end TIME,
  live_status VARCHAR(20) NOT NULL DEFAULT 'offline'
    CHECK (live_status IN ('online', 'busy', 'break', 'offline')),
  calls_handled INT NOT NULL DEFAULT 0,
  avg_response_seconds INT,
  profile_photo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE hospital_admin_profiles (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  admin_name VARCHAR(120) NOT NULL,
  hospital_id BIGINT REFERENCES hospitals(id),
  phone VARCHAR(20),
  profile_photo_url TEXT,
  gst_number VARCHAR(20),
  license_number VARCHAR(40),
  license_expiry DATE,
  notification_email BOOLEAN NOT NULL DEFAULT TRUE,
  notification_sms BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE super_admin_profiles (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  full_name VARCHAR(120) NOT NULL,
  organization_name VARCHAR(160) NOT NULL DEFAULT 'HindCare Enterprise',
  profile_photo_url TEXT,
  api_keys_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- SHARED PROFILE DATA
-- ============================================================

CREATE TABLE addresses (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label VARCHAR(40) NOT NULL DEFAULT 'home',
  line1 TEXT NOT NULL,
  line2 TEXT,
  city VARCHAR(80) NOT NULL,
  state VARCHAR(80) NOT NULL,
  pincode VARCHAR(10) NOT NULL,
  country VARCHAR(60) NOT NULL DEFAULT 'India',
  lat DECIMAL(10, 7),
  lng DECIMAL(10, 7),
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE emergency_contacts (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  relationship VARCHAR(60) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE medical_information (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  condition_name VARCHAR(160) NOT NULL,
  severity VARCHAR(20) CHECK (severity IN ('mild', 'moderate', 'severe')),
  notes TEXT,
  diagnosed_at DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE allergies (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  allergen VARCHAR(120) NOT NULL,
  reaction TEXT,
  severity VARCHAR(20) CHECK (severity IN ('mild', 'moderate', 'severe', 'life_threatening')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE insurance_details (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_name VARCHAR(120) NOT NULL,
  policy_number VARCHAR(80) NOT NULL,
  valid_until DATE,
  coverage_amount DECIMAL(14, 2),
  is_primary BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE saved_locations (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label VARCHAR(60) NOT NULL,
  address TEXT NOT NULL,
  lat DECIMAL(10, 7),
  lng DECIMAL(10, 7),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE payment_methods (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL CHECK (type IN ('card', 'upi', 'wallet', 'netbanking')),
  label VARCHAR(80) NOT NULL,
  last_four VARCHAR(4),
  upi_id VARCHAR(80),
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE user_documents (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doc_type VARCHAR(40) NOT NULL,
  file_name VARCHAR(160) NOT NULL,
  file_url TEXT NOT NULL,
  mime_type VARCHAR(80),
  file_size_bytes INT,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at DATE,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE favourite_hospitals (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hospital_id BIGINT NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, hospital_id)
);

CREATE TABLE driver_bank_details (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  account_holder VARCHAR(120) NOT NULL,
  bank_name VARCHAR(120) NOT NULL,
  account_number_encrypted TEXT NOT NULL,
  ifsc_code VARCHAR(11) NOT NULL,
  upi_id VARCHAR(80),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE notification_preferences (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  booking_updates BOOLEAN NOT NULL DEFAULT TRUE,
  promotions BOOLEAN NOT NULL DEFAULT FALSE,
  security_alerts BOOLEAN NOT NULL DEFAULT TRUE,
  shift_reminders BOOLEAN NOT NULL DEFAULT TRUE,
  system_maintenance BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE api_keys (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(80) NOT NULL,
  key_prefix VARCHAR(12) NOT NULL,
  key_hash TEXT NOT NULL,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_users_role ON users(role_id);
CREATE INDEX idx_users_email ON users(email) WHERE email IS NOT NULL;
CREATE INDEX idx_users_phone ON users(phone) WHERE phone IS NOT NULL;
CREATE INDEX idx_users_employee_id ON users(employee_id) WHERE employee_id IS NOT NULL;
CREATE INDEX idx_user_sessions_user ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_expires ON user_sessions(expires_at);
CREATE INDEX idx_otp_destination ON otp_verifications(destination, purpose);
CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at);
CREATE INDEX idx_login_history_user ON login_history(user_id);
CREATE INDEX idx_addresses_user ON addresses(user_id);
CREATE INDEX idx_emergency_contacts_user ON emergency_contacts(user_id);
CREATE INDEX idx_user_documents_user ON user_documents(user_id);

-- ============================================================
-- SEED ROLES & PERMISSIONS
-- ============================================================

INSERT INTO roles (slug, name, description, mfa_required) VALUES
  ('customer', 'Customer / Patient', 'Books ambulances and manages personal health profile', FALSE),
  ('driver', 'Ambulance Driver', 'Operates assigned ambulance and updates trip status', FALSE),
  ('dispatcher', 'Dispatcher / Call Center', 'Handles emergency calls and dispatches ambulances', FALSE),
  ('hospital_admin', 'Hospital Admin', 'Manages hospital operations and staff', TRUE),
  ('super_admin', 'Super Admin', 'Enterprise system administrator', TRUE);

INSERT INTO permissions (slug, name, module) VALUES
  ('bookings.create', 'Create Bookings', 'bookings'),
  ('bookings.read', 'View Bookings', 'bookings'),
  ('bookings.update', 'Update Bookings', 'bookings'),
  ('bookings.dispatch', 'Dispatch Ambulances', 'bookings'),
  ('hospitals.manage', 'Manage Hospitals', 'hospitals'),
  ('ambulances.manage', 'Manage Ambulances', 'ambulances'),
  ('users.manage', 'Manage Users', 'users'),
  ('audit.read', 'View Audit Logs', 'audit'),
  ('system.configure', 'System Configuration', 'system'),
  ('profile.read', 'View Own Profile', 'profile'),
  ('profile.update', 'Update Own Profile', 'profile');
