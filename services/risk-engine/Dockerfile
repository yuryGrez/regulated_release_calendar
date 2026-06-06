FROM python:3.12-slim AS base
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

FROM base AS dev
COPY . .
# Dev: run the SQS worker (primary path); FastAPI available separately
CMD ["python", "-m", "src.worker"]

FROM base AS production
COPY . .
# Production: run worker (SQS consumer) + expose FastAPI for /evaluate endpoint
# Use a shell script to run both processes
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
CMD ["/entrypoint.sh"]
