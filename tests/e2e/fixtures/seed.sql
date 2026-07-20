-- These reserved records make rendered tests deterministic without importing
-- or deleting any real workspace data from a developer's local D1 database.
DELETE FROM contacts WHERE id = 'e2e-contact-001';
DELETE FROM projects
WHERE client_id = 'e2e-client-001'
  OR id = 'e2e-project-001'
  OR project_number = 'CF-2026-E2E00001';
DELETE FROM clients WHERE id = 'e2e-client-001' OR client_code = 'E2E-CLIENT';

INSERT INTO clients (
  id,
  client_code,
  name,
  status,
  industry,
  created_by,
  created_at,
  updated_at
) VALUES (
  'e2e-client-001',
  'E2E-CLIENT',
  'E2E Regression Client',
  'active',
  'Commercial',
  'e2e-admin@example.test',
  1783900800000,
  1783900800000
);

INSERT INTO contacts (
  id,
  client_id,
  name,
  email,
  role,
  is_primary,
  created_at,
  updated_at
) VALUES (
  'e2e-contact-001',
  'e2e-client-001',
  'E2E Primary Contact',
  'contact@example.test',
  'Facilities manager',
  1,
  1783900800000,
  1783900800000
);

INSERT INTO projects (
  id,
  project_number,
  client_id,
  name,
  status,
  site,
  project_manager,
  estimated_value,
  flooring_category,
  square_feet,
  contract_value,
  created_by,
  created_at,
  updated_at
) VALUES (
  'e2e-project-001',
  'CF-2026-E2E00001',
  'e2e-client-001',
  'E2E Mobile Metadata Project',
  'mobilizing',
  '201 E2E Test Ave, Cherry Hill, NJ',
  'e2e-admin@example.test',
  125000,
  'luxury-vinyl',
  5000,
  132500,
  'e2e-admin@example.test',
  1783900800000,
  1783900800000
);
