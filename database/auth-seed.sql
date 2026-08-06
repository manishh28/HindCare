-- HindCare Auth Seed Data (demo credentials — change in production)
-- Password for all demo users: HindCare@2026

INSERT INTO users (role_id, employee_id, email, phone, password_hash, email_verified, phone_verified, status)
SELECT r.id, 'DRV-1001', 'rahul.singh@fleet.hindcare.in', '+919111111111',
  '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.G2oX.Q3KqH8K2i', TRUE, TRUE, 'active'
FROM roles r WHERE r.slug = 'driver';

INSERT INTO users (role_id, employee_id, email, phone, password_hash, email_verified, phone_verified, status)
SELECT r.id, 'DSP-2001', 'dispatch@hindcare.in', '+919222222222',
  '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.G2oX.Q3KqH8K2i', TRUE, TRUE, 'active'
FROM roles r WHERE r.slug = 'dispatcher';

INSERT INTO users (role_id, employee_id, email, phone, password_hash, email_verified, phone_verified, mfa_enabled, status)
SELECT r.id, 'HAD-3001', 'admin@hindcare-hospital.in', '+919333333333',
  '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.G2oX.Q3KqH8K2i', TRUE, TRUE, TRUE, 'active'
FROM roles r WHERE r.slug = 'hospital_admin';

INSERT INTO users (role_id, employee_id, email, phone, password_hash, email_verified, phone_verified, mfa_enabled, status)
SELECT r.id, 'SA-0001', 'superadmin@hindcare.in', '+919444444444',
  '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.G2oX.Q3KqH8K2i', TRUE, TRUE, TRUE, 'active'
FROM roles r WHERE r.slug = 'super_admin';

INSERT INTO driver_profiles (user_id, full_name, license_number, license_expiry, vehicle_number, availability_status, experience_years, rating, completed_trips)
SELECT u.id, 'Rahul Singh', 'UP-DL-2019-884521', '2028-03-15', 'UP32 AB 1001', 'available', 6, 4.7, 1240
FROM users u JOIN roles r ON u.role_id = r.id WHERE r.slug = 'driver' AND u.employee_id = 'DRV-1001';

INSERT INTO dispatcher_profiles (user_id, full_name, department, assigned_region, shift_start, shift_end, live_status, calls_handled)
SELECT u.id, 'Anita Verma', 'Emergency Call Center', 'Lucknow Metro', '08:00', '20:00', 'online', 8420
FROM users u JOIN roles r ON u.role_id = r.id WHERE r.slug = 'dispatcher' AND u.employee_id = 'DSP-2001';

INSERT INTO hospital_admin_profiles (user_id, admin_name, phone, gst_number, license_number)
SELECT u.id, 'Dr. Vikram Mehta', '+919333333333', '09AABCH1234A1Z5', 'HOS-LKO-2018-001'
FROM users u JOIN roles r ON u.role_id = r.id WHERE r.slug = 'hospital_admin' AND u.employee_id = 'HAD-3001';

INSERT INTO super_admin_profiles (user_id, full_name, organization_name)
SELECT u.id, 'Rajesh Kapoor', 'HindCare MedTech Pvt Ltd'
FROM users u JOIN roles r ON u.role_id = r.id WHERE r.slug = 'super_admin' AND u.employee_id = 'SA-0001';
