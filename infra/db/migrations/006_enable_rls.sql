ALTER TABLE releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_releases ON releases
  USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

CREATE POLICY tenant_risk_scores ON risk_scores
  USING (
    release_id IN (
      SELECT id FROM releases
      WHERE tenant_id = current_setting('app.tenant_id', true)::UUID
    )
  );
