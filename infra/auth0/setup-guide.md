# Auth0 Setup Guide

## 1. Create Auth0 Tenant

1. Sign up at https://auth0.com (free tier supports up to 7,500 MAUs)
2. Create a new tenant: `rrc-prod` (or `rrc-staging`)
3. Note your **Domain**: `rrc-prod.eu.auth0.com`

---

## 2. Create the API

**Dashboard → Applications → APIs → Create API**

| Field | Value |
|---|---|
| Name | RRC API |
| Identifier (Audience) | `https://api.rrc.dev` |
| Signing Algorithm | RS256 |

Copy the **Identifier** → set as `AUTH0_AUDIENCE` in `.env`

---

## 3. Create the SPA Application (Frontend)

**Dashboard → Applications → Create Application**

| Field | Value |
|---|---|
| Name | RRC Frontend |
| Application Type | Single Page Application |

**Settings tab:**

| Field | Value |
|---|---|
| Allowed Callback URLs | `https://app.rrc.dev/callback`, `http://localhost:3000/callback` |
| Allowed Logout URLs | `https://app.rrc.dev`, `http://localhost:3000` |
| Allowed Web Origins | `https://app.rrc.dev`, `http://localhost:3000` |
| Allowed Origins (CORS) | `https://app.rrc.dev`, `http://localhost:3000` |

Copy the **Client ID** → set as `VITE_AUTH0_CLIENT_ID` in `.env`

---

## 4. Deploy the Post-Login Action

**Dashboard → Actions → Library → Create Action**

- **Trigger:** Login / Post Login  
- **Name:** RRC Tenant ID Injection  
- **Runtime:** Node 18  
- Paste the contents of `infra/auth0/post-login-action.js`
- Click **Deploy**

**Dashboard → Actions → Flows → Login**  
Drag "RRC Tenant ID Injection" between `Start` and `Complete`.

---

## 5. Provision Your First Tenant

For each customer, set `app_metadata` on their Auth0 user:

```bash
# Using Auth0 Management API
curl -X PATCH "https://rrc-prod.eu.auth0.com/api/v2/users/auth0|USER_ID" \
  -H "Authorization: Bearer MANAGEMENT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "app_metadata": {
      "rrc_tenant_id": "UUID-FROM-TENANTS-TABLE",
      "rrc_role": "admin"
    }
  }'
```

The `rrc_tenant_id` must match a row in the `tenants` table in PostgreSQL.

---

## 6. Environment Variables

Add to your production `.env`:

```bash
AUTH0_DOMAIN=rrc-prod.eu.auth0.com
AUTH0_AUDIENCE=https://api.rrc.dev
VITE_AUTH0_DOMAIN=rrc-prod.eu.auth0.com
VITE_AUTH0_CLIENT_ID=<SPA client ID from step 3>
VITE_AUTH0_AUDIENCE=https://api.rrc.dev
```

---

## 7. Verify JWT Claims

After login, decode the access token at https://jwt.io — you should see:

```json
{
  "https://rrc.dev/tenant_id": "00000000-0000-0000-0000-000000000001",
  "https://rrc.dev/role": "admin",
  "aud": "https://api.rrc.dev",
  "iss": "https://rrc-prod.eu.auth0.com/",
  "alg": "RS256"
}
```
