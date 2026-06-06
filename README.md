# Regulated Release Calendar (RRC)

Multi-tenant SaaS platform for banks and government agencies to schedule software releases against regulatory change windows (FCA, PRA, APRA, EBA/DORA).

---

## Architecture

| Service | Port | Tech | Responsibility |
|---|---|---|---|
| **Gateway** | 8080 | Node.js + Express | JWT validation, rate limiting, proxy |
| **Release Service** | 8081 | Node.js + Express | Release CRUD, SQS publish |
| **Risk Engine** | 8082 | Python + FastAPI | Risk scoring, SQS consumer |
| **Calendar Service** | 8083 | Python + FastAPI | Regulatory windows, scrapers |
| **Audit Service** | 8084 | Node.js + Express | Audit trail, PDF/CSV export |
| **Notification Service** | 8085 | Node.js + Express | Email, Slack, Jira write-back |
| **Frontend** | 3000 | React + Vite + Tailwind | SPA dashboard |

---

## Quick Start (Local Development)

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) 4.x+
- [Node.js 20 LTS](https://nodejs.org/) (for running tests outside Docker)
- [Python 3.12](https://www.python.org/) (for running tests outside Docker)

### 1. Configure environment

```bash
cp .env.example .env
# Edit .env — fill in AUTH0_DOMAIN, AUTH0_AUDIENCE at minimum
```

### 2. Start everything (first time)

```bash
docker-compose up --build
```

This will:
- Start Postgres 16, Redis 7, LocalStack (SQS + S3), MinIO
- Auto-run all SQL migrations via `docker-entrypoint-initdb.d`
- Create SQS FIFO queues via `infra/scripts/init-localstack.sh`
- Load seed data (test tenant + FCA windows + sample releases)
- Build and start all 7 services + frontend

**First boot takes ~3 minutes** (Docker image builds). Subsequent starts: ~30s.

### 3. Verify it works

```bash
# Health checks
curl http://localhost:8080/health    # Gateway
curl http://localhost:8081/health    # Release Service
curl http://localhost:8083/health    # Calendar Service
curl http://localhost:8084/health    # Audit Service

# Full smoke test
./infra/scripts/smoke-test.sh
```

### 4. Development mode (hot reload)

```bash
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up
```

Frontend dev server runs on port **5173** with HMR.

---

## Running Tests

### All services (outside Docker)

```bash
# Node services
cd services/release      && npm test
cd services/audit        && npm test
cd services/gateway      && npm test
cd services/notifications && npm test

# Python services (requires Python 3.12 + test deps)
cd services/risk-engine  && pip install -r requirements-test.txt && pytest
cd services/calendar     && pip install -r requirements-test.txt && pytest

# Frontend
cd frontend && npm test -- --run

# E2E (requires docker-compose stack running)
cd tests/e2e && npm install && npm test
```

**Test scorecard:** 83 tests, all green ✓

---

## Deployment (Production)

### Option A — Railway (recommended for MVP)

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and initialise project (first time)
railway login
railway init

# Add Railway PostgreSQL + Redis plugins via dashboard, then:
cp .env.production.example .env.production
# Fill in DATABASE_URL, REDIS_URL from Railway dashboard

# Deploy all services
chmod +x deploy/railway-deploy.sh
./deploy/railway-deploy.sh
```

See [Railway docs](https://docs.railway.app/) for custom domains.

### Option B — Any Docker host (VPS / ECS / Fly.io)

```bash
# Build all images
docker-compose build

# Push to your registry (e.g. Docker Hub)
docker tag rrc-release-svc:latest <registry>/rrc-release-svc:latest
# ... repeat for each service

# On the server — use .env.production
docker-compose --env-file .env.production up -d
```

### AWS setup (SQS + S3)

Replace LocalStack with real AWS queues:

```bash
# Configure AWS CLI
aws configure --profile rrc-deploy

# Provision queues and S3 Object Lock bucket
AWS_PROFILE=rrc-deploy ./infra/scripts/provision-aws.sh

# Update .env.production with the output URLs
```

### Auth0 setup

See `infra/auth0/setup-guide.md` for:
- Creating the API and SPA application
- Deploying the post-login Action (custom `tenant_id` claim)
- Provisioning users for your first design partner

---

## Key Concepts

### Risk Scoring Algorithm

| Condition | Points |
|---|---|
| Release date inside a BLACKOUT window | +40 |
| Release date inside a FREEZE window | +30 |
| Release date inside an AUDIT_PROXIMITY window | +20 |
| Release date on a single-day BLACKOUT | +10 |

| Total Score | Classification |
|---|---|
| ≥ 70 | **BLOCKED** — must reschedule |
| 31–69 | **AT_RISK** — review required |
| 0–30 | **SAFE** |

### Multi-tenancy

All data is isolated via PostgreSQL Row Level Security. Every query runs with:
```sql
SET LOCAL app.tenant_id = '<uuid>';
```
This policy prevents any tenant from seeing another's data, even on shared infrastructure.

### Audit Compliance

Every risk evaluation is:
1. Written to `audit_log` (append-only via PostgreSQL RULE — no UPDATE/DELETE possible)
2. Copied to S3 with **Object Lock COMPLIANCE mode, 7-year retention** (FCA requirement)
3. Exportable as PDF (PDFKit) or CSV on demand

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✓ | PostgreSQL connection string |
| `REDIS_URL` | ✓ | Redis connection string |
| `SQS_QUEUE_URL_RELEASES` | ✓ | SQS FIFO queue for ReleaseCreated events |
| `SQS_QUEUE_URL_NOTIFICATIONS` | ✓ | SQS FIFO queue for RiskScoreComputed events |
| `AWS_REGION` | ✓ | `eu-west-2` |
| `AUTH0_DOMAIN` | ✓ | e.g. `rrc-prod.eu.auth0.com` |
| `AUTH0_AUDIENCE` | ✓ | e.g. `https://api.rrc.dev` |
| `JIRA_WEBHOOK_SECRET` | ✓ | HMAC-SHA256 shared secret for Jira webhooks |
| `SENDGRID_API_KEY` | optional | Email notifications |
| `SLACK_WEBHOOK_URL` | optional | Slack notifications |
| `S3_AUDIT_BUCKET` | optional | S3 bucket for WORM audit storage |

Copy `.env.example` → `.env` for local dev.  
Copy `.env.production.example` → `.env.production` for production.

**Never commit `.env` or `.env.production`.**

---

## Security

- All secrets via environment variables — no hardcoded values anywhere
- JWT RS256 (Auth0) validated at the gateway; downstream services trust `X-Tenant-ID` header
- Jira webhooks validated with HMAC-SHA256 (`timingSafeEqual`)
- Error responses never expose stack traces: always `{ error: { code, message } }`
- PostgreSQL RLS enforces tenant isolation at the database level
- S3 Object Lock prevents audit log tampering for 7 years
