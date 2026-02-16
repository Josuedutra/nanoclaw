# Runbook: Worker Offline

## Symptoms

- Telegram alert: "Worker X has been offline for >120s"
- Cockpit workers page shows worker status red/offline
- SSE event `worker:status` with `status: offline`
- Tasks stuck in READY (no worker available for dispatch)

## Triage Steps

1. **Check tunnel status from CP:**
   ```bash
   curl -H "X-OS-SECRET: $SECRET" http://127.0.0.1:7700/ops/workers/$WORKER_ID/tunnels
   ```

2. **Check SSH tunnel process:**
   ```bash
   ps aux | grep "ssh.*$WORKER_HOST"
   journalctl -u nanoclaw-worker-tunnel@$WORKER_ID --since "10 min ago"
   ```

3. **Test SSH connectivity:**
   ```bash
   ssh -o ConnectTimeout=5 -o BatchMode=yes $SSH_USER@$WORKER_HOST echo ok
   ```

4. **Check worker health endpoint (through tunnel):**
   ```bash
   curl -s http://127.0.0.1:$LOCAL_PORT/worker/health
   ```

5. **Check worker service on remote host:**
   ```bash
   ssh $SSH_USER@$WORKER_HOST "systemctl status nanoclaw-worker"
   ssh $SSH_USER@$WORKER_HOST "journalctl -u nanoclaw-worker --since '10 min ago'"
   ```

## Resolution

| Root Cause | Action |
|-----------|--------|
| SSH key auth failure | Verify `~/.ssh/authorized_keys` on worker, check key permissions |
| Worker process crashed | `ssh $HOST "systemctl restart nanoclaw-worker"` |
| Network unreachable | Check firewall rules, VPN status, DNS resolution |
| Port conflict | `ssh $HOST "ss -tlnp | grep $WORKER_PORT"` |
| Tunnel reconnect exhausted | Restart tunnel: `systemctl restart nanoclaw-worker-tunnel@$WORKER_ID` |

## Prevention

- Monitor tunnel systemd units with `Restart=always` + `StartLimitBurst=10`
- Set up SSH keep-alive: `ServerAliveInterval=15`, `ServerAliveCountMax=3`
- Use ed25519 keys with passphrase-less deploy keys
- Firewall: only allow SSH from CP IP

## Escalation

If worker cannot be restored within 15 minutes:
1. Remove worker from rotation: update `workers.status = 'offline'` in DB
2. Tasks will fall back to remaining workers or local dispatch
3. Investigate root cause and restore during maintenance window
