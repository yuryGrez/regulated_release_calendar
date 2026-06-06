-- Dev seed data
INSERT INTO tenants (id, name, jurisdiction, plan)
VALUES ('00000000-0000-0000-0000-000000000001', 'Test Bank UK', 'FCA', 'enterprise')
ON CONFLICT (id) DO NOTHING;

INSERT INTO regulatory_windows (jurisdiction, type, name, start_date, end_date, is_manual)
VALUES
  ('FCA', 'BLACKOUT',        'FCA Q3 2026 Change Freeze',    '2026-07-01', '2026-07-14', true),
  ('FCA', 'FREEZE',          'FCA Pre-Budget Freeze Oct 26', '2026-10-20', '2026-11-01', true),
  ('FCA', 'AUDIT_PROXIMITY', 'FCA Annual Compliance Audit',  '2026-09-15', '2026-09-15', true)
ON CONFLICT DO NOTHING;

INSERT INTO releases (tenant_id, name, planned_date, owner_id, status)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'Payments v2.3',    '2026-07-08', gen_random_uuid(), 'scheduled'),
  ('00000000-0000-0000-0000-000000000001', 'Auth Service v1.1','2026-08-15', gen_random_uuid(), 'draft');
