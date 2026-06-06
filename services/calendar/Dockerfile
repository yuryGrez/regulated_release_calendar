FROM python:3.12-slim AS base
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

FROM base AS dev
COPY . .
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8083", "--reload"]

FROM base AS production
COPY . .
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8083"]
