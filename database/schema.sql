CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  full_name VARCHAR(120) NOT NULL,
  phone VARCHAR(20) NOT NULL UNIQUE,
  email VARCHAR(160) UNIQUE,
  role VARCHAR(30) NOT NULL CHECK (role IN ('patient', 'hospital_admin', 'fleet_owner', 'admin')),
  password_hash TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE hospitals (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(180) NOT NULL,
  city VARCHAR(100) NOT NULL,
  address TEXT NOT NULL,
  phone VARCHAR(20) NOT NULL,
  emergency_available BOOLEAN NOT NULL DEFAULT TRUE,
  total_beds INTEGER NOT NULL DEFAULT 0,
  available_beds INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ambulances (
  id BIGSERIAL PRIMARY KEY,
  registration_number VARCHAR(40) NOT NULL UNIQUE,
  type VARCHAR(40) NOT NULL CHECK (type IN ('basic', 'advanced', 'icu', 'neonatal')),
  driver_name VARCHAR(120) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  current_lat DECIMAL(10, 7),
  current_lng DECIMAL(10, 7),
  status VARCHAR(30) NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'busy', 'maintenance', 'offline')),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE bookings (
  id BIGSERIAL PRIMARY KEY,
  patient_name VARCHAR(120) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  pickup TEXT NOT NULL,
  destination TEXT NOT NULL,
  emergency_type VARCHAR(80),
  ambulance_id BIGINT REFERENCES ambulances(id),
  hospital_id BIGINT REFERENCES hospitals(id),
  status VARCHAR(30) NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'assigned', 'on_route', 'completed', 'cancelled')),
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE chatbot_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id),
  session_id VARCHAR(80),
  message TEXT NOT NULL,
  intent VARCHAR(80),
  reply TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_hospitals_city ON hospitals(city);
CREATE INDEX idx_ambulances_status ON ambulances(status);
CREATE INDEX idx_bookings_status ON bookings(status);
CREATE INDEX idx_bookings_created_at ON bookings(created_at);
CREATE INDEX idx_chatbot_logs_session_id ON chatbot_logs(session_id);
