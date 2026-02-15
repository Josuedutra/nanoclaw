# NanoClaw OS v1.0 — Definition of Done

> Internal, Multi-Product Company Ready. Fail-closed by default, repeatable evidence.

**Goal:** The OS can run a multi-product B2B company with one founder, enforcing governance, security, and auditability by default, with repeatable evidence.

---

## 1. Kernel Governance

### 1.1 State machine enforced (host-side, deterministic)

- [x] Valid transitions enforced by policy (graph-based)
- [x] Invalid transitions are DENY with explicit reason code
- [x] Strict mode supported and used for production runs

**Evidence:**
- [ ] Policy tests cover all valid transitions + invalid cases
- [ ] One E2E pipeline test: `INBOX → TRIAGED → READY → DOING → REVIEW → APPROVAL → DONE`

### 1.2 Idempotency + crash safety

- [x] Dispatch is idempotent (no duplicate enqueue on retries/restarts)
- [x] Optimistic locking prevents lost updates (version check)
- [x] Dispatch loop restart does not corrupt state nor duplicate work

**Evidence:**
- [ ] Tests cover: "loop rerun 10x", "version conflict", "restart simulation"

### 1.3 Separation of powers

- [x] Gate approver mapping enforced
- [x] Approver ≠ executor enforced
- [ ] Override path exists and is audit-tracked (reason + accepted risk + deadline)

**Evidence:**
- [ ] `gates` tests + `ipc` tests + one manual run recorded in `gov_activities`

---

## 2. Multi-Product Company Readiness

### 2.1 Product is first-class

- [x] `products` table exists with `status` + `risk_level`
- [x] Governance tasks support `scope = COMPANY | PRODUCT`
- [x] Invariants enforced:
  - [x] COMPANY tasks cannot have `product_id`
  - [ ] PRODUCT tasks must reference a `product_id` (or explicit rule allowing null with reason)

**Evidence:**
- [ ] Schema + CRUD tests
- [ ] Policy tests for scope/product invariants

### 2.2 Portfolio isolation (logical)

- [x] Tasks, approvals, activities are queryable by `product_id` and `scope`
- [ ] Dispatch prompts include product context when applicable
- [x] Minimum "portfolio views" exist (CLI queries / snapshots) without requiring UI

**Evidence:**
- [ ] `gov-db` query tests + snapshot test

---

## 3. External Access Broker

### 3.1 Capability model enforced

- [x] Capability grants are per-group, per-provider, per-level (L0–L3)
- [x] Deny-wins precedence
- [x] L2/L3 have mandatory expiry (≤ 7 days)
- [x] L3 requires two-man rule (approvals from different groups)

**Evidence:**
- [ ] Broker tests cover deny-wins, expiry, two-man rule, idempotency

### 3.2 Governance coupling (no "out-of-band" actions)

- [x] `ext_call` requires `task_id`
- [x] Broker validates:
  - [x] Task exists
  - [x] `task.state ∈ {DOING, APPROVAL}`
  - [x] `task.assigned_group` matches caller group (main can override)
  - [ ] (if PRODUCT scope) product context is present and logged
- [x] Every external call writes an audit record with:
  - [x] HMAC-SHA256 of params (never raw)
  - [x] Sanitized summary
  - [x] Status + duration
  - [x] Linked `task_id`
  - [ ] Linked `product_id` if applicable

**Evidence:**
- [ ] Tests: `ext_call` denied for INBOX/DONE and allowed for DOING
- [ ] DB audit tests verify "no raw params stored"

### 3.3 Secure IPC request/response

- [x] Requests are signed per-group (HMAC)
- [x] Response delivery is atomic (`tmp` + `rename`)
- [x] Backpressure enforced (max pending requests)
- [x] Inflight lock prevents double execution

**Evidence:**
- [ ] Tests cover signing failure, backpressure, inflight lock

---

## 4. Observability + Audit

### 4.1 Append-only audit trail

- [x] `gov_activities` is append-only in practice (no updates/deletes in code paths)
- [x] `ext_calls` is append-only
- [x] Every mutation logs: actor, action, timestamps, reason codes

**Evidence:**
- [ ] Unit tests assert audit entries created for create/transition/approve/override/ext_call

### 4.2 No secrets / no PII in logs

- [x] Logs do not emit tokens, raw payloads, or sensitive text
- [x] Any deny logs store only reason + hashes (never raw)

**Evidence:**
- [ ] Tests that scan log payloads / stored summaries for forbidden patterns

---

## 5. Operational Model

### 5.1 Single-host explicit ops model

- [ ] Documented RPO/RTO targets for v1
- [ ] Backup & restore runbooks exist and are executable:
  - [ ] SQLite backup
  - [ ] `conversations/` backup
  - [ ] Restore procedure
- [ ] Disaster recovery steps are written and tested at least once

**Evidence:**
- [ ] `docs/OPS_MODEL.md` + `scripts/backup*.sh` + a dated "DR drill" note

### 5.2 Safe change process

- [ ] Policy/schema changes follow a process: proposal → tests → review → merge
- [ ] Branch protection expectations documented
- [ ] "Stop-the-line" rule: no hotpatching dist artifacts; changes must be versioned

**Evidence:**
- [ ] `docs/POLICY_CHANGE_PROCESS.md` + branch protection checklist

---

## 6. Agent Operating Standard

### 6.1 Core groups present and correct

- [x] `groups/main/CLAUDE.md` includes governance + broker usage + triage rules
- [x] `groups/developer/CLAUDE.md` includes delivery discipline + transition rules
- [x] `groups/security/CLAUDE.md` includes gate review + veto rules
- [x] `groups/global/` contains shared operating facts (incl. `USER.md`)

**Evidence:**
- [ ] Repo contains files + quick "smoke task" run showing tools available

### 6.2 Cross-agent context (minimum viable)

- [x] When a task moves DOING → REVIEW/APPROVAL, dispatch prompt includes:
  - [x] Recent `gov_activities`
  - [ ] Execution summary / last N output lines
  - [ ] Evidence links
- [x] Approver can review without needing chat history

**Evidence:**
- [ ] `gov-loop` test validating prompt contains context block

---

## 7. Acceptance Proof — Final "OS GO" Checklist

To declare OS v1.0 DONE, run this playbook and confirm each step:

- [ ] Create Product "Ritmo"
- [ ] Create PRODUCT task, assign developer, move to READY
- [ ] Auto-dispatch to developer (DOING)
- [ ] Developer transitions to REVIEW with evidence
- [ ] Auto-dispatch to security, approve gate, move to DONE
- [ ] Perform one L2 `ext_call` (GitHub issue/PR) tied to the task
- [ ] Verify audit in `gov_activities` + `ext_calls`
- [ ] Run backup scripts and verify files exist

**Evidence:**
- [ ] A dated "OS v1.0 acceptance run" record (output snippets + commit SHA)

---

## Scope Note (explicit)

Memory embedding guard (L0–L3 + PII sanitization) is **not required** for OS v1.0 if embeddings are not enabled. It becomes required before handling real client PII or enabling embedding-based memory search.
