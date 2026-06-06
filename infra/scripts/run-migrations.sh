#!/bin/bash
set -e

DB_URL="${DATABASE_URL:-postgresql://rrc_user:password@localhost:5432/rrc_db}"

echo "Running migrations..."
for f in $(ls infra/db/migrations/*.sql | sort); do
  echo "  Applying $f"
  psql "$DB_URL" -f "$f"
done
echo "Migrations complete."
