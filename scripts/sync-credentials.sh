#!/bin/bash
# Sync Claude credentials to keep agent tokens fresh
# Root's credentials are refreshed by active Claude Code sessions
# The agent process (nanoclaw user) reads from /root/.claude/ via docker group

# Ensure permissions are correct
chmod 770 /root/.claude/ 2>/dev/null
chmod 660 /root/.claude/.credentials.json 2>/dev/null

# Also keep a backup copy for the nanoclaw user's home
if [ -f /root/.claude/.credentials.json ]; then
  cp /root/.claude/.credentials.json /home/nanoclaw/.claude/.credentials.json 2>/dev/null
  chown nanoclaw:nanoclaw /home/nanoclaw/.claude/.credentials.json 2>/dev/null
  chmod 600 /home/nanoclaw/.claude/.credentials.json 2>/dev/null
fi
