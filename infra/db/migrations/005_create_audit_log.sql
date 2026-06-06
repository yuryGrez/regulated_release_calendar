CREATE TABLE audit_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id        UUID NOT NULL,
  tenant_id         UUID NOT NULL,
  release_name      TEXT NOT NULL,
  planned_date      DATE NOT NULL,
  level             TEXT NOT NULL,
  score             INT  NOT NULL,
  reasons           JSONB NOT NULL DEFAULT '[]',
  windows_evaluated JSONB NOT NULL DEFAULT '[]',
  timestamp         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE RULE no_update_audit AS ON UPDATE TO audit_log DO INSTEAD NOTHING;
CREATE RULE no_delete_audit AS ON DELETE TO audit_log DO INSTEAD NOTHING;
