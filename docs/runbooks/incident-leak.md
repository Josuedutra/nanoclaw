# Runbook: Secret/Credential Leak Incident

## Symptoms

- Secret found in git history, logs, or external service
- Unauthorized API calls detected in `ext_calls` table
- Unexpected cockpit logins or write operations
- Third-party notification of leaked credential

## Triage Steps

1. **Assess scope — which secret was leaked:**
   ```bash
   # Check ext_calls for unauthorized activity
   sqlite3 store/messages.db "SELECT provider, action, status, created_at FROM ext_calls ORDER BY created_at DESC LIMIT 20;"

   # Check gov_activities for unauthorized transitions
   sqlite3 store/messages.db "SELECT action, actor, created_at FROM gov_activities ORDER BY created_at DESC LIMIT 20;"
   ```

2. **Determine exposure timeline:**
   - When was the secret first exposed?
   - What systems had access?
   - Was it committed to a public repository?

3. **Check for active exploitation:**
   ```bash
   # Recent auth failures (may indicate probing)
   journalctl -u nanoclaw --since "24 hours ago" | grep -i "401\|auth\|denied"
   ```

## Resolution

### Immediate (within 15 minutes)

1. **Rotate ALL potentially compromised secrets:**
   ```bash
   # Generate new secrets
   NEW_OS=$(openssl rand -hex 32)
   NEW_WRITE=$(openssl rand -hex 32)
   NEW_SESSION=$(openssl rand -hex 32)
   NEW_CSRF=$(openssl rand -hex 32)

   # Update .env
   sed -i "s/^OS_HTTP_SECRET=.*/OS_HTTP_SECRET=$NEW_OS/" .env
   sed -i "s/^COCKPIT_WRITE_SECRET_CURRENT=.*/COCKPIT_WRITE_SECRET_CURRENT=$NEW_WRITE/" .env
   sed -i "s/^COCKPIT_SESSION_SECRET=.*/COCKPIT_SESSION_SECRET=$NEW_SESSION/" .env
   sed -i "s/^COCKPIT_CSRF_SECRET=.*/COCKPIT_CSRF_SECRET=$NEW_CSRF/" .env

   # Restart immediately
   systemctl restart nanoclaw
   ```

2. **If GitHub token leaked:**
   ```bash
   # Revoke immediately at github.com/settings/tokens
   # Generate new token with minimal scopes
   # Update .env and restart
   ```

3. **If worker shared secret leaked:**
   ```bash
   # Update on CP and ALL workers simultaneously
   # See secret-rotation.md for procedure
   ```

### Short-term (within 1 hour)

4. **Audit ext_calls table:**
   ```bash
   sqlite3 store/messages.db "
     SELECT provider, action, group_folder, status, created_at
     FROM ext_calls
     WHERE created_at > datetime('now', '-24 hours')
     ORDER BY created_at;
   "
   ```

5. **Check for data exfiltration:**
   - Review GitHub activity (commits, PRs, issues)
   - Review any external API calls made

6. **If secret was in git:**
   ```bash
   # Remove from history (if not yet pushed)
   git filter-branch --force --index-filter \
     "git rm --cached --ignore-unmatch .env" HEAD

   # If pushed to public repo: treat as fully compromised
   ```

### Long-term (within 24 hours)

7. **Postmortem:**
   - How did the leak happen?
   - What controls failed?
   - What changes prevent recurrence?

8. **Notification:**
   - Notify affected parties if user data was exposed
   - Document incident timeline

## Prevention

- `.env` in `.gitignore` (verified: already present)
- `chmod 600 .env` on production
- Backup script sanitizes secrets (verified: `scripts/backup-os.ts`)
- SSE events sanitized via `FORBIDDEN_KEYS` (verified: `src/ops-events.ts`)
- Worker responses strip `shared_secret` and `ssh_identity_file`
- Never log secrets — use structured logging with filtered fields
- Pre-commit hook to scan for secret patterns

## Escalation

1. If user data was potentially accessed: consult legal/compliance
2. If GitHub token was used maliciously: contact GitHub support
3. If the leak originated from a compromised worker: isolate the worker, rotate all secrets, audit all dispatches from that worker
