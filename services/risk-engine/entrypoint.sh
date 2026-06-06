#!/bin/sh
# Run FastAPI (HTTP) and SQS worker in parallel
set -e

echo "Starting Risk Engine..."

# Start FastAPI for /evaluate endpoint
uvicorn src.main:app --host 0.0.0.0 --port "${RISK_ENGINE_PORT:-8082}" &
UVICORN_PID=$!

# Start SQS worker
python -m src.worker &
WORKER_PID=$!

# If either process dies, kill the other and exit non-zero
wait_and_fail() {
  wait -n
  echo "A process exited unexpectedly. Shutting down."
  kill "$UVICORN_PID" "$WORKER_PID" 2>/dev/null || true
  exit 1
}

# Wait for both; exit if either dies
wait "$UVICORN_PID" "$WORKER_PID"
