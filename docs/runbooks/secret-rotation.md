# Runbook: Secret Rotation

## Symptoms

- Scheduled rotation (quarterly recommended)
- Suspected compromise (see `incident-leak.md`)
- Secret length below minimum (preflight warning)

## Triage Steps

Before rotating, verify current state:

1. **Check which secrets are in use:**
   ```bash
   grep -E '^[A-Z_]+=.' .env | cut -d= -f1
   ```

2. **Verify cockpit is operational:**
   ```bash
   curl -s http://127.0.0.1:7700/ops/stats -H "X-OS-SECRET: $OS_HTTP_SECRET"
   ```

## Resolution

### Rotate OS_HTTP_SECRET

```bash
# 1. Generate new secret
NEW_SECRET=$(openssl rand -hex 32)

# 2. Update .env
sed -i "s/^OS_HTTP_SECRET=.*/OS_HTTP_SECRET=$NEW_SECRET/" .env

# 3. Restart service
systemctl restart nanoclaw

# 4. Update cockpit config (OPS_SECRET in cockpit/.env)
# 5. Restart cockpit
```

### Rotate COCKPIT_WRITE_SECRET (zero-downtime)

```bash
# 1. Generate new secret
NEW_SECRET=$(openssl rand -hex 32)

# 2. Set PREVIOUS to current value
echo "COCKPIT_WRITE_SECRET_PREVIOUS=$(grep COCKPIT_WRITE_SECRET_CURRENT .env | cut -d= -f2)" >> .env

# 3. Set CURRENT to new value
sed -i "s/^COCKPIT_WRITE_SECRET_CURRENT=.*/COCKPIT_WRITE_SECRET_CURRENT=$NEW_SECRET/" .env

# 4. Restart CP — both old and new secrets accepted
systemctl restart nanoclaw

# 5. Update cockpit .env with new write secret
# 6. Restart cockpit

# 7. After all clients updated, remove PREVIOUS
sed -i '/^COCKPIT_WRITE_SECRET_PREVIOUS=/d' .env
systemctl restart nanoclaw
```

### Rotate WORKER_SHARED_SECRET

```bash
# 1. Generate new secret
NEW_SECRET=$(openssl rand -hex 32)

# 2. Update on BOTH CP and worker
# CP: update workers table
sqlite3 store/messages.db "UPDATE workers SET shared_secret='$NEW_SECRET' WHERE id='$WORKER_ID';"

# Worker: update .env
ssh $WORKER_HOST "sed -i 's/^WORKER_SHARED_SECRET=.*/WORKER_SHARED_SECRET=$NEW_SECRET/' /opt/nanoclaw/.env"

# 3. Restart worker first, then CP
ssh $WORKER_HOST "systemctl restart nanoclaw-worker"
systemctl restart nanoclaw
```

## Prevention

- Rotate all secrets quarterly
- Use `openssl rand -hex 32` (256-bit) minimum
- Never reuse secrets across environments
- `.env` file: `chmod 600`, owned by service user
- Backup does NOT include raw secrets (verified)

## Escalation

If rotation causes auth failures:
1. Check logs: `journalctl -u nanoclaw --since "5 min ago" | grep -i auth`
2. Verify secret matches between `.env` and running process
3. If dual-secret rotation: ensure PREVIOUS is set correctly
4. Last resort: restart all services simultaneously
