CREATE TABLE regulatory_windows (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jurisdiction TEXT NOT NULL CHECK (jurisdiction IN ('FCA','PRA','APRA','EBA','DORA')),
  type         TEXT NOT NULL CHECK (type IN ('BLACKOUT','FREEZE','AUDIT_PROXIMITY')),
  name         TEXT NOT NULL,
  start_date   DATE NOT NULL,
  end_date     DATE NOT NULL,
  source_url   TEXT,
  is_manual    BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT valid_date_range CHECK (end_date >= start_date)
);

CREATE INDEX idx_windows_jurisdiction_dates
  ON regulatory_windows(jurisdiction, start_date, end_date);
