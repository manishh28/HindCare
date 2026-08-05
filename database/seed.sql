INSERT INTO hospitals (name, city, address, phone, email, emergency_available, total_beds, available_beds, status)
VALUES
  ('HindCare Emergency Hospital', 'Lucknow', 'SGPGI Road, Lucknow', '+91-9000000001', 'contact@hindcare-hospital.example', TRUE, 120, 28, 'approved'),
  ('MedTech City Hospital', 'Lucknow', 'Gomti Nagar, Lucknow', '+91-9000000002', 'contact@medtechcity.example', TRUE, 80, 12, 'approved'),
  ('CarePlus Trauma Center', 'Kanpur', 'Mall Road, Kanpur', '+91-9000000003', 'contact@careplustrauma.example', TRUE, 60, 9, 'approved');

INSERT INTO ambulances (registration_number, type, driver_name, phone, email, current_lat, current_lng, status)
VALUES
  ('UP32 AB 1001', 'advanced', 'Rahul Singh', '+91-9111111111', 'rahul.singh@fleet.example', 26.8467, 80.9462, 'available'),
  ('UP32 AB 1002', 'basic', 'Amit Verma', '+91-9222222222', 'amit.verma@fleet.example', 26.8500, 80.9500, 'busy'),
  ('UP78 CD 2001', 'icu', 'Sana Khan', '+91-9333333333', 'sana.khan@fleet.example', 26.4499, 80.3319, 'available');
