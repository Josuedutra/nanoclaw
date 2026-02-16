# Secrets Checklist

Pre-production checklist for all NanoClaw secrets and environment variables.

## Required Secrets

| Variable | Purpose | Where Used | Min Length |
|----------|---------|------------|------------|
| `OS_HTTP_SECRET` | Ops HTTP read endpoint auth | ops-http.ts | 16 chars |

These are validated at startup by `src/preflight.ts`. Missing secrets cause immediate exit.

## Recommended Secrets

| Variable | Purpose | Where Used |
|----------|---------|------------|
| `COCKPIT_WRITE_SECRET_CURRENT` | Write endpoint auth (active) | ops-actions.ts |
| `COCKPIT_WRITE_SECRET_PREVIOUS` | Write endpoint auth (rotation window) | ops-actions.ts |
| `COCKPIT_PASSWORD` | Cockpit login password | cockpit/lib/auth.ts |
| `COCKPIT_SESSION_SECRET` | Cookie signing key | cockpit/lib/auth.ts |
| `COCKPIT_CSRF_SECRET` | CSRF token signing | cockpit/lib/auth.ts |
| `EXT_CALL_HMAC_SECRET` | External access broker HMAC | ext-broker.ts |
| `GITHUB_TOKEN` | GitHub API access | ext-providers/github.ts |

## Worker Secrets (if multi-node enabled)

| Variable | Purpose | Where Used |
|----------|---------|------------|
| `WORKER_SHARED_SECRET` | Worker HMAC auth | worker-auth.ts |

## Alert Secrets (optional)

| Variable | Purpose | Where Used |
|----------|---------|------------|
| `ALERT_TELEGRAM_BOT_TOKEN` | Telegram Bot API token | ops-alerts.ts |
| `ALERT_TELEGRAM_CHAT_ID` | Telegram chat for alerts | ops-alerts.ts |

## Secret Generation

```bash
# Generate a strong 32-byte hex secret
openssl rand -hex 32

# Generate a 48-char base64 secret
openssl rand -base64 36
```

## Dual-Secret Rotation Procedure

NanoClaw supports zero-downtime secret rotation for write endpoints via `COCKPIT_WRITE_SECRET_CURRENT` and `COCKPIT_WRITE_SECRET_PREVIOUS`.

### Steps

1. **Generate new secret:**
   ```bash
   NEW_SECRET=$(openssl rand -hex 32)
   ```

2. **Set previous to current:**
   ```bash
   # In .env or systemd override:
   COCKPIT_WRITE_SECRET_PREVIOUS=<old-current-value>
   COCKPIT_WRITE_SECRET_CURRENT=<new-secret>
   ```

3. **Deploy and restart:**
   ```bash
   systemctl restart nanoclaw
   ```
   Both old and new secrets are accepted during the transition window.

4. **Update all clients** (cockpit, CI/CD) to use the new secret.

5. **Remove previous** after all clients are updated:
   ```bash
   # Remove COCKPIT_WRITE_SECRET_PREVIOUS from .env
   systemctl restart nanoclaw
   ```

## Go-Live Checklist

- [ ] `OS_HTTP_SECRET` set and >= 16 chars
- [ ] `COCKPIT_WRITE_SECRET_CURRENT` set (if cockpit writes enabled)
- [ ] `COCKPIT_PASSWORD` set (not the default)
- [ ] `COCKPIT_SESSION_SECRET` set (unique per deployment)
- [ ] `COCKPIT_CSRF_SECRET` set (unique per deployment)
- [ ] `EXT_CALL_HMAC_SECRET` set (if ext access broker enabled)
- [ ] `GITHUB_TOKEN` has minimal required scopes
- [ ] `WORKER_SHARED_SECRET` set (if multi-node)
- [ ] `.env` file has `chmod 600` permissions
- [ ] No secrets in git history
- [ ] No default/placeholder values in production
- [ ] Backup does NOT include raw secrets (verified: backup-os.ts sanitizes .env)
