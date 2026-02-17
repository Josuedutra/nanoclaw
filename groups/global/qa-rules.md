# Shared Rules (All Agents)

Read this file at session start. These rules apply to every agent in the system.

---

## Runtime Environment

You run on a **Linux VPS** (Ubuntu) as user `nanoclaw` (uid=999, gid=987). The service is managed by **systemd** (`systemctl restart nanoclaw`). There is NO Apple Container, NO Docker on the host, NO `launchctl`. This is process-runner mode.

**Key constraint**: Source files in `src/` are owned by root. You CANNOT edit them directly. When you need code changes, describe the exact changes needed (file, line, old text, new text) and the coordinator/admin will apply them. Do NOT create shell scripts with sed/python patches — they are fragile and error-prone.

### Workspace Paths

| Path | Purpose | Access |
|------|---------|--------|
| `/root/nanoclaw/groups/{your-folder}/` | Your workspace | read-write |
| `/root/nanoclaw/groups/global/` | Shared across agents | read-write |
| `/root/nanoclaw/data/ipc/{your-folder}/` | IPC files | read-write |
| `/root/nanoclaw/src/` | Source code | **read-only** (root-owned) |

---

## Quality Assurance Rules

Before delivering any code, scripts, patches, or review results:

1. **Test before delivering**: Run `bash -n script.sh` for shell scripts. Execute code in your sandbox before claiming it works. If you can't test it (e.g., needs root), say so explicitly.

2. **Verify platform**: You are on Linux VPS with systemd. Never reference macOS (`launchctl`, `open -a`), Apple Container (`container run/stop/rm`), or Docker unless explicitly asked.

3. **No fragile patches**: Do NOT create shell scripts that use `sed -i` or Python heredocs to patch source files. Instead, describe the exact change: file path, the old text to find, the new text to replace it with.

4. **Check your assumptions**: Before writing code that interacts with the system, read the relevant source files first. Don't assume APIs, paths, or command names.

5. **Declare limitations**: If you can't do something (e.g., edit root-owned files, restart services), say so clearly. Don't create workarounds that you haven't tested.

6. **Self-review checklist** before delivering:
   - [ ] Did I test this? If not, did I say so?
   - [ ] Does this match the actual platform (Linux VPS, systemd)?
   - [ ] Are file paths correct and verified?
   - [ ] Will this break if the source code has been updated since I last read it?

---

## Compaction & Session End Protocol

**CRITICAL**: Before your context is compacted or your session ends, you MUST preserve your work:

1. **Update `working.md`** — current task status, what you were doing, what's left
2. **Store lessons learned** — use `store_memory()` with:
   - Decisions made and why (alternative approaches considered)
   - Problems encountered and how they were resolved
   - Gotchas or surprises (things that didn't work as expected)
   - Patterns discovered (reusable solutions)
   - Always include `source_ref` with the task ID
3. **Update `memory.md`** — add key facts, decisions, and outcomes from this session

### What to extract before compaction

| Category | Where to save | Example |
|----------|--------------|---------|
| Task progress | `working.md` | "Task GOV-42: implemented auth middleware, tests passing, needs review" |
| Decisions | `store_memory()` + `memory.md` | "Chose JWT over sessions because stateless scales better" |
| Lessons | `store_memory()` + `memory.md` | "Node spawn() with uid/gid doesn't set supplementary groups" |
| Blockers | `working.md` | "Blocked on: need OPENAI_API_KEY in .env" |
| Ideas for later | `memory.md` | "Consider adding rate limiting to the broker" |

### Memory tags convention

- `["pattern", "topic"]` — reusable solution
- `["gotcha", "topic"]` — unexpected behavior
- `["decision", "topic"]` — why one approach over another
- `["finding", "topic"]` — security or code quality finding
