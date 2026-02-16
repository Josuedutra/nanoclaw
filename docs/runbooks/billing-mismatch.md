# Runbook: Billing / Quota Mismatch

## Symptoms

- `limits:denial` SSE events with `code: DAILY_QUOTA_EXCEEDED`
- Unexpected API charges from external providers
- Agents reporting "quota exceeded" errors
- Mismatch between expected and actual API usage

## Triage Steps

1. **Check current usage from ext_calls table:**
   ```bash
   sqlite3 store/messages.db "
     SELECT provider, action, status, COUNT(*) as count
     FROM ext_calls
     WHERE created_at > datetime('now', '-24 hours')
     GROUP BY provider, action, status
     ORDER BY count DESC;
   "
   ```

2. **Check rate limit state:**
   ```bash
   sqlite3 store/messages.db "
     SELECT scope_key, op, count, window_start
     FROM rate_limits
     WHERE op IN ('ext_call', 'ext_daily')
     ORDER BY count DESC;
   "
   ```

3. **Check limits configuration:**
   ```bash
   # View current limits
   grep -E 'LIMIT|QUOTA|RATE' .env
   ```

4. **Check breaker state:**
   ```bash
   sqlite3 store/messages.db "
     SELECT provider, state, fail_count, opened_at
     FROM breaker_state;
   "
   ```

5. **Check for runaway tasks:**
   ```bash
   sqlite3 store/messages.db "
     SELECT id, title, state, assigned_group, executor
     FROM gov_tasks
     WHERE state = 'DOING'
     ORDER BY updated_at DESC;
   "
   ```

## Resolution

| Root Cause | Action |
|-----------|--------|
| Runaway task making excessive API calls | Transition task to BLOCKED, investigate agent behavior |
| Rate limits too generous | Tighten `EXT_RATE_LIMIT_*` env vars, restart |
| Daily quota too high | Lower `EXT_DAILY_QUOTA_*` env vars, restart |
| Breaker not triggering | Lower `BREAKER_OPEN_AFTER_FAILS`, reduce `BREAKER_FAIL_WINDOW_SEC` |
| Unauthorized ext_calls | Rotate `EXT_CALL_HMAC_SECRET`, audit capabilities |
| Duplicate calls (idempotency failure) | Check `idempotency_key` column in ext_calls |

### Adjust Limits

```bash
# Example: tighten GitHub rate limit
echo "EXT_RATE_LIMIT_PER_MINUTE=10" >> .env
echo "EXT_DAILY_QUOTA_GITHUB=100" >> .env
systemctl restart nanoclaw
```

### Reset Breaker (if stuck)

```bash
sqlite3 store/messages.db "
  UPDATE breaker_state SET state='CLOSED', fail_count=0, opened_at=NULL
  WHERE provider='$PROVIDER';
"
```

## Prevention

- Set conservative daily quotas per provider
- Enable breaker with low threshold (3-5 failures)
- Monitor `ext_calls` counts daily
- Review ext_capabilities grants quarterly
- L2/L3 capabilities auto-expire in 7 days

## Escalation

1. If charges exceed budget: immediately revoke provider tokens
2. If unauthorized calls detected: follow `incident-leak.md`
3. Contact provider support for refund/investigation if needed
