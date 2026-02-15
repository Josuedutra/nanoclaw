import { describe, it, expect, beforeEach } from 'vitest';

import { _initTestDatabase } from './db.js';
import {
  cleanupStaleExtCalls,
  countPendingExtCalls,
  getAllActiveCapabilities,
  getAllCapabilities,
  getCapability,
  getExtCallByIdempotencyKey,
  getExtCallByRequestId,
  getExtCalls,
  grantCapability,
  logExtCall,
  revokeCapability,
  updateExtCallStatus,
  type ExtCall,
  type ExtCapability,
} from './ext-broker-db.js';

beforeEach(() => {
  _initTestDatabase();
});

// --- Helper ---

function makeCap(overrides?: Partial<Omit<ExtCapability, 'id'>>): Omit<ExtCapability, 'id'> {
  return {
    group_folder: 'developer',
    provider: 'github',
    access_level: 1,
    allowed_actions: null,
    denied_actions: null,
    requires_task_gate: null,
    granted_by: 'main',
    granted_at: '2026-02-14T00:00:00.000Z',
    expires_at: null,
    active: 1,
    ...overrides,
  };
}

function makeCall(overrides?: Partial<ExtCall>): ExtCall {
  return {
    request_id: `ext-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    group_folder: 'developer',
    provider: 'github',
    action: 'list_repos',
    access_level: 1,
    params_hmac: 'abc123',
    params_summary: 'List repos',
    status: 'authorized',
    denial_reason: null,
    result_summary: null,
    response_data: null,
    task_id: null,
    idempotency_key: null,
    duration_ms: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

// --- Capabilities CRUD ---

describe('ext_capabilities CRUD', () => {
  it('grants and retrieves a capability', () => {
    grantCapability(makeCap());

    const cap = getCapability('developer', 'github');
    expect(cap).toBeDefined();
    expect(cap!.group_folder).toBe('developer');
    expect(cap!.provider).toBe('github');
    expect(cap!.access_level).toBe(1);
    expect(cap!.active).toBe(1);
  });

  it('upserts on same group+provider', () => {
    grantCapability(makeCap({ access_level: 1 }));
    grantCapability(makeCap({ access_level: 2 }));

    const cap = getCapability('developer', 'github');
    expect(cap!.access_level).toBe(2);

    // Should be only 1 record, not 2
    const all = getAllCapabilities('developer');
    expect(all).toHaveLength(1);
  });

  it('returns undefined for missing capability', () => {
    expect(getCapability('developer', 'github')).toBeUndefined();
  });

  it('getAllCapabilities returns only active', () => {
    grantCapability(makeCap({ provider: 'github' }));
    grantCapability(makeCap({ provider: 'cloud-logs' }));

    expect(getAllCapabilities('developer')).toHaveLength(2);
  });

  it('getAllActiveCapabilities spans groups', () => {
    grantCapability(makeCap({ group_folder: 'developer' }));
    grantCapability(makeCap({ group_folder: 'security' }));

    const all = getAllActiveCapabilities();
    expect(all).toHaveLength(2);
  });

  it('revokeCapability soft-deletes (active=0)', () => {
    grantCapability(makeCap());
    revokeCapability('developer', 'github');

    // getCapability only returns active
    expect(getCapability('developer', 'github')).toBeUndefined();

    // getAllCapabilities also filtered
    expect(getAllCapabilities('developer')).toHaveLength(0);
  });

  it('re-granting after revoke reactivates', () => {
    grantCapability(makeCap({ access_level: 1 }));
    revokeCapability('developer', 'github');
    grantCapability(makeCap({ access_level: 2 }));

    const cap = getCapability('developer', 'github');
    expect(cap).toBeDefined();
    expect(cap!.access_level).toBe(2);
    expect(cap!.active).toBe(1);
  });

  it('stores allowed_actions and denied_actions as JSON strings', () => {
    grantCapability(makeCap({
      allowed_actions: '["list_repos","get_repo"]',
      denied_actions: '["merge_pr"]',
    }));

    const cap = getCapability('developer', 'github')!;
    const allowed = JSON.parse(cap.allowed_actions!);
    const denied = JSON.parse(cap.denied_actions!);
    expect(allowed).toEqual(['list_repos', 'get_repo']);
    expect(denied).toEqual(['merge_pr']);
  });

  it('stores expires_at', () => {
    const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
    grantCapability(makeCap({ expires_at: expiresAt }));

    const cap = getCapability('developer', 'github')!;
    expect(cap.expires_at).toBe(expiresAt);
  });
});

// --- Ext Calls (evidence) ---

describe('ext_calls logging', () => {
  it('logs a call and retrieves by request_id', () => {
    const call = makeCall({ request_id: 'ext-test-1' });
    const ok = logExtCall(call);
    expect(ok).toBe(true);

    const retrieved = getExtCallByRequestId('ext-test-1');
    expect(retrieved).toBeDefined();
    expect(retrieved!.provider).toBe('github');
    expect(retrieved!.action).toBe('list_repos');
    expect(retrieved!.status).toBe('authorized');
  });

  it('returns false on duplicate request_id', () => {
    const call = makeCall({ request_id: 'ext-dup-1' });
    expect(logExtCall(call)).toBe(true);
    expect(logExtCall(call)).toBe(false); // UNIQUE constraint
  });

  it('updateExtCallStatus updates status + fields', () => {
    logExtCall(makeCall({ request_id: 'ext-update-1', status: 'processing' }));

    updateExtCallStatus('ext-update-1', 'executed', {
      result_summary: 'Listed 5 repos',
      response_data: '{"repos":[]}',
      duration_ms: 150,
    });

    const call = getExtCallByRequestId('ext-update-1')!;
    expect(call.status).toBe('executed');
    expect(call.result_summary).toBe('Listed 5 repos');
    expect(call.response_data).toBe('{"repos":[]}');
    expect(call.duration_ms).toBe(150);
  });

  it('getExtCalls returns calls for a group ordered by created_at DESC', () => {
    logExtCall(makeCall({
      request_id: 'ext-a',
      created_at: '2026-02-14T00:00:00.000Z',
    }));
    logExtCall(makeCall({
      request_id: 'ext-b',
      created_at: '2026-02-14T01:00:00.000Z',
    }));

    const calls = getExtCalls('developer');
    expect(calls).toHaveLength(2);
    expect(calls[0].request_id).toBe('ext-b'); // most recent first
    expect(calls[1].request_id).toBe('ext-a');
  });

  it('getExtCalls respects limit', () => {
    for (let i = 0; i < 5; i++) {
      logExtCall(makeCall({ request_id: `ext-lim-${i}` }));
    }
    const calls = getExtCalls('developer', 3);
    expect(calls).toHaveLength(3);
  });
});

// --- Idempotency ---

describe('idempotency cache', () => {
  it('finds cached response by idempotency_key + provider + action', () => {
    logExtCall(makeCall({
      request_id: 'ext-idemp-1',
      idempotency_key: 'create-issue-42',
      status: 'executed',
      response_data: '{"issue":42}',
    }));

    const cached = getExtCallByIdempotencyKey('create-issue-42', 'github', 'list_repos');
    expect(cached).toBeDefined();
    expect(cached!.response_data).toBe('{"issue":42}');
  });

  it('returns undefined for non-executed status', () => {
    logExtCall(makeCall({
      request_id: 'ext-idemp-2',
      idempotency_key: 'create-issue-43',
      status: 'failed',
    }));

    const cached = getExtCallByIdempotencyKey('create-issue-43', 'github', 'list_repos');
    expect(cached).toBeUndefined();
  });

  it('returns undefined for different provider', () => {
    logExtCall(makeCall({
      request_id: 'ext-idemp-3',
      idempotency_key: 'k1',
      provider: 'github',
      status: 'executed',
      response_data: '{}',
    }));

    const cached = getExtCallByIdempotencyKey('k1', 'cloud-logs', 'list_repos');
    expect(cached).toBeUndefined();
  });

  it('returns most recent executed call', () => {
    logExtCall(makeCall({
      request_id: 'ext-idemp-old',
      idempotency_key: 'k2',
      status: 'executed',
      response_data: '{"v":1}',
      created_at: '2026-02-14T00:00:00.000Z',
    }));
    logExtCall(makeCall({
      request_id: 'ext-idemp-new',
      idempotency_key: 'k2',
      status: 'executed',
      response_data: '{"v":2}',
      created_at: '2026-02-14T01:00:00.000Z',
    }));

    const cached = getExtCallByIdempotencyKey('k2', 'github', 'list_repos');
    expect(cached!.response_data).toBe('{"v":2}');
  });
});

// --- Backpressure ---

describe('backpressure (countPendingExtCalls)', () => {
  it('counts authorized + processing calls', () => {
    logExtCall(makeCall({ request_id: 'r1', status: 'authorized' }));
    logExtCall(makeCall({ request_id: 'r2', status: 'processing' }));
    logExtCall(makeCall({ request_id: 'r3', status: 'executed' })); // not pending
    logExtCall(makeCall({ request_id: 'r4', status: 'denied' })); // not pending

    expect(countPendingExtCalls('developer')).toBe(2);
  });

  it('counts per group', () => {
    logExtCall(makeCall({ request_id: 'r5', group_folder: 'developer', status: 'processing' }));
    logExtCall(makeCall({ request_id: 'r6', group_folder: 'security', status: 'processing' }));

    expect(countPendingExtCalls('developer')).toBe(1);
    expect(countPendingExtCalls('security')).toBe(1);
  });

  it('returns 0 for empty group', () => {
    expect(countPendingExtCalls('nonexistent')).toBe(0);
  });
});

// --- Cleanup ---

describe('cleanupStaleExtCalls', () => {
  it('deletes old executed/denied/failed/timeout calls', () => {
    const oldDate = new Date(Date.now() - 2 * 86_400_000).toISOString(); // 2 days ago
    logExtCall(makeCall({ request_id: 'old-1', status: 'executed', created_at: oldDate }));
    logExtCall(makeCall({ request_id: 'old-2', status: 'denied', created_at: oldDate }));
    logExtCall(makeCall({ request_id: 'fresh', status: 'executed', created_at: new Date().toISOString() }));

    const deleted = cleanupStaleExtCalls(86_400_000); // 1 day max age
    expect(deleted).toBe(2);
    expect(getExtCallByRequestId('fresh')).toBeDefined();
  });

  it('preserves processing calls regardless of age', () => {
    const oldDate = new Date(Date.now() - 2 * 86_400_000).toISOString();
    logExtCall(makeCall({ request_id: 'still-processing', status: 'processing', created_at: oldDate }));

    const deleted = cleanupStaleExtCalls(86_400_000);
    expect(deleted).toBe(0);
    expect(getExtCallByRequestId('still-processing')).toBeDefined();
  });
});
