CREATE TABLE risk_scores (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id   UUID NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  level        TEXT NOT NULL CHECK (level IN ('SAFE','AT_RISK','BLOCKED')),
  score        INT  NOT NULL CHECK (score BETWEEN 0 AND 100),
  reasons      JSONB NOT NULL DEFAULT '[]',
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_risk_scores_release ON risk_scores(release_id);

CREATE VIEW latest_risk_scores AS
  SELECT DISTINCT ON (release_id) *
  FROM risk_scores
  ORDER BY release_id, evaluated_at DESC;
