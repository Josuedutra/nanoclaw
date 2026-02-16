# Runbook: Tunnel Flapping

## Symptoms

- Repeated `tunnel:status` SSE events alternating `up`/`down`
- Worker status oscillating between online/offline in cockpit
- `gov_activities` shows multiple `DISPATCH_DEFERRED_TUNNEL_DOWN` entries
- systemd logs show rapid restart cycles for tunnel unit

## Triage Steps

1. **Check tunnel restart count:**
   ```bash
   journalctl -u nanoclaw-worker-tunnel@$WORKER_ID --since "1 hour ago" | grep -c "Started"
   ```

2. **Check systemd rate limiting:**
   ```bash
   systemctl status nanoclaw-worker-tunnel@$WORKER_ID
   # Look for: "start request repeated too quickly"
   ```

3. **Test SSH connection stability:**
   ```bash
   ssh -v -o ConnectTimeout=10 $SSH_USER@$WORKER_HOST "sleep 30 && echo ok"
   # Watch for premature disconnect
   ```

4. **Check worker host load:**
   ```bash
   ssh $SSH_USER@$WORKER_HOST "uptime; free -h; df -h"
   ```

5. **Check network quality:**
   ```bash
   mtr --report --count 10 $WORKER_HOST
   ```

## Resolution

| Root Cause | Action |
|-----------|--------|
| Unstable network | Increase `ServerAliveCountMax` to 5, reduce check frequency |
| Worker host overloaded | Reduce `max_wip`, scale out to another worker |
| SSH config issue | Verify `ExitOnForwardFailure=yes`, check `sshd_config` on worker |
| systemd rate limit hit | `systemctl reset-failed nanoclaw-worker-tunnel@$WORKER_ID` then restart |
| Port forwarding conflict | Ensure `local_port` is unique per worker, check for stale SSH processes |

## Prevention

- systemd config: `StartLimitIntervalSec=120`, `StartLimitBurst=10`
- SSH config: `StrictHostKeyChecking=yes` (prevent MITM-induced disconnects)
- Monitor tunnel uptime as a metric
- Set `WORKER_TUNNEL_RECONNECT_MAX=10` (stop after 10 attempts, alert)

## Escalation

If flapping persists after SSH and network investigation:
1. Stop the tunnel: `systemctl stop nanoclaw-worker-tunnel@$WORKER_ID`
2. Set worker status to offline in DB
3. Investigate network path between CP and worker
4. Consider alternative network path (VPN, different route)
