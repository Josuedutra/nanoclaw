import { afterEach, describe, it, expect, beforeEach } from 'vitest';

import { _initTestDatabase } from './db.js';
import {
  createGovTask,
  createProduct,
  getGovActivities,
  getGovActivitiesForContext,
  getGovApprovals,
  getGovTaskById,
  getGovTaskExecutionSummary,
  getGovTasksByProduct,
  getGovTasksByScope,
  getProductById,
  listProducts,
  logGovActivity,
  updateProduct,
} from './gov-db.js';
import { processGovIpc } from './gov-ipc.js';

beforeEach(() => {
  _initTestDatabase();
});

// --- Helper ---

function seedTask(overrides?: Record<string, unknown>) {
  const now = new Date().toISOString();
  const defaults = {
    id: 'task-1',
    title: 'Test task',
    description: null,
    task_type: 'BUG',
    state: 'INBOX',
    priority: 'P2',
    product: null,
    product_id: null,
    scope: 'PRODUCT' as const,
    assigned_group: 'developer',
    executor: null,
    created_by: 'main',
    gate: 'None',
    dod_required: 0,
    metadata: null,
    created_at: now,
    updated_at: now,
  };
  createGovTask({ ...defaults, ...overrides } as Parameters<typeof createGovTask>[0]);
}

// --- gov_create ---

describe('gov_create', () => {
  it('main creates a task in INBOX', async () => {
    await processGovIpc(
      { type: 'gov_create', title: 'Fix login', task_type: 'BUG', priority: 'P1' },
      'main',
      true,
    );

    // Find task (id is auto-generated)
    const tasks = (await import('./gov-db.js')).getAllGovTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('Fix login');
    expect(tasks[0].state).toBe('INBOX');
    expect(tasks[0].task_type).toBe('BUG');
    expect(tasks[0].priority).toBe('P1');
    expect(tasks[0].created_by).toBe('main');
  });

  it('non-main cannot create', async () => {
    await processGovIpc(
      { type: 'gov_create', title: 'Nope', task_type: 'BUG' },
      'developer',
      false,
    );

    const tasks = (await import('./gov-db.js')).getAllGovTasks();
    expect(tasks).toHaveLength(0);
  });

  it('rejects invalid task_type', async () => {
    await processGovIpc(
      { type: 'gov_create', title: 'Bad type', task_type: 'INVALID' },
      'main',
      true,
    );

    const tasks = (await import('./gov-db.js')).getAllGovTasks();
    expect(tasks).toHaveLength(0);
  });

  it('rejects invalid gate', async () => {
    await processGovIpc(
      { type: 'gov_create', title: 'Bad gate', task_type: 'BUG', gate: 'FakeGate' },
      'main',
      true,
    );

    const tasks = (await import('./gov-db.js')).getAllGovTasks();
    expect(tasks).toHaveLength(0);
  });

  it('rejects missing title', async () => {
    await processGovIpc(
      { type: 'gov_create', task_type: 'BUG' },
      'main',
      true,
    );

    const tasks = (await import('./gov-db.js')).getAllGovTasks();
    expect(tasks).toHaveLength(0);
  });

  it('creates with default priority P2 and gate None', async () => {
    await processGovIpc(
      { type: 'gov_create', title: 'Defaults', task_type: 'FEATURE' },
      'main',
      true,
    );

    const tasks = (await import('./gov-db.js')).getAllGovTasks();
    expect(tasks[0].priority).toBe('P2');
    expect(tasks[0].gate).toBe('None');
  });

  it('creates with assigned_group and Security gate', async () => {
    await processGovIpc(
      {
        type: 'gov_create',
        title: 'With gate',
        task_type: 'SECURITY',
        assigned_group: 'developer',
        gate: 'Security',
      },
      'main',
      true,
    );

    const tasks = (await import('./gov-db.js')).getAllGovTasks();
    expect(tasks[0].assigned_group).toBe('developer');
    expect(tasks[0].gate).toBe('Security');
  });

  it('logs activity on create', async () => {
    await processGovIpc(
      { type: 'gov_create', id: 'task-log', title: 'Log me', task_type: 'BUG' },
      'main',
      true,
    );

    const activities = getGovActivities('task-log');
    expect(activities).toHaveLength(1);
    expect(activities[0].action).toBe('create');
    expect(activities[0].to_state).toBe('INBOX');
    expect(activities[0].actor).toBe('main');
  });
});

// --- gov_transition ---

describe('gov_transition', () => {
  beforeEach(() => {
    seedTask({ id: 'task-1', state: 'INBOX', assigned_group: 'developer' });
  });

  it('valid transition INBOX → TRIAGED by main', async () => {
    await processGovIpc(
      { type: 'gov_transition', taskId: 'task-1', toState: 'TRIAGED', reason: 'Triaged' },
      'main',
      true,
    );

    const task = getGovTaskById('task-1');
    expect(task!.state).toBe('TRIAGED');
  });

  it('logs activity on transition', async () => {
    await processGovIpc(
      { type: 'gov_transition', taskId: 'task-1', toState: 'TRIAGED', reason: 'OK' },
      'main',
      true,
    );

    const activities = getGovActivities('task-1');
    expect(activities).toHaveLength(1);
    expect(activities[0].action).toBe('transition');
    expect(activities[0].from_state).toBe('INBOX');
    expect(activities[0].to_state).toBe('TRIAGED');
    expect(activities[0].reason).toBe('OK');
  });

  it('assigned group can transition own task', async () => {
    await processGovIpc(
      { type: 'gov_transition', taskId: 'task-1', toState: 'BLOCKED', reason: 'Stuck' },
      'developer',
      false,
    );

    expect(getGovTaskById('task-1')!.state).toBe('BLOCKED');
  });

  it('non-assigned non-main group cannot transition', async () => {
    await processGovIpc(
      { type: 'gov_transition', taskId: 'task-1', toState: 'TRIAGED' },
      'security',
      false,
    );

    expect(getGovTaskById('task-1')!.state).toBe('INBOX');
  });

  it('rejects invalid transition (INBOX → DONE)', async () => {
    await processGovIpc(
      { type: 'gov_transition', taskId: 'task-1', toState: 'DONE' },
      'main',
      true,
    );

    expect(getGovTaskById('task-1')!.state).toBe('INBOX');
  });

  it('no-op when already in target state', async () => {
    await processGovIpc(
      { type: 'gov_transition', taskId: 'task-1', toState: 'INBOX' },
      'main',
      true,
    );

    // Should remain INBOX, no error, no activity
    expect(getGovTaskById('task-1')!.state).toBe('INBOX');
    expect(getGovActivities('task-1')).toHaveLength(0);
  });

  it('increments version on successful transition', async () => {
    const before = getGovTaskById('task-1')!.version;

    await processGovIpc(
      { type: 'gov_transition', taskId: 'task-1', toState: 'TRIAGED' },
      'main',
      true,
    );

    expect(getGovTaskById('task-1')!.version).toBe(before + 1);
  });

  it('rejects stale version (expectedVersion mismatch)', async () => {
    await processGovIpc(
      { type: 'gov_transition', taskId: 'task-1', toState: 'TRIAGED', expectedVersion: 999 },
      'main',
      true,
    );

    expect(getGovTaskById('task-1')!.state).toBe('INBOX');
  });

  it('rejects missing taskId', async () => {
    await processGovIpc(
      { type: 'gov_transition', toState: 'TRIAGED' },
      'main',
      true,
    );
    // no crash
  });

  it('rejects nonexistent task', async () => {
    await processGovIpc(
      { type: 'gov_transition', taskId: 'nonexistent', toState: 'TRIAGED' },
      'main',
      true,
    );
    // no crash
  });

  it('rejects invalid target state', async () => {
    await processGovIpc(
      { type: 'gov_transition', taskId: 'task-1', toState: 'BOGUS' },
      'main',
      true,
    );

    expect(getGovTaskById('task-1')!.state).toBe('INBOX');
  });
});

// --- gov_approve ---

describe('gov_approve', () => {
  beforeEach(() => {
    seedTask({
      id: 'task-review',
      state: 'APPROVAL',
      assigned_group: 'developer',
      executor: 'developer',
      gate: 'Security',
    });
  });

  it('security group can approve Security gate', async () => {
    await processGovIpc(
      { type: 'gov_approve', taskId: 'task-review', gate_type: 'Security', notes: 'LGTM' },
      'security',
      false,
    );

    const approvals = getGovApprovals('task-review');
    expect(approvals).toHaveLength(1);
    expect(approvals[0].gate_type).toBe('Security');
    expect(approvals[0].approved_by).toBe('security');
    expect(approvals[0].notes).toBe('LGTM');
  });

  it('main group can approve any gate', async () => {
    await processGovIpc(
      { type: 'gov_approve', taskId: 'task-review', gate_type: 'Security' },
      'main',
      true,
    );

    const approvals = getGovApprovals('task-review');
    expect(approvals).toHaveLength(1);
  });

  it('developer cannot approve (wrong gate group)', async () => {
    await processGovIpc(
      { type: 'gov_approve', taskId: 'task-review', gate_type: 'Security' },
      'developer',
      false,
    );

    expect(getGovApprovals('task-review')).toHaveLength(0);
  });

  it('approver cannot be the executor (separation of powers)', async () => {
    // Task assigned_group and executor are both 'developer'
    // Even if main approves, let's test the executor check with security trying
    // to approve a task where it is the executor
    seedTask({
      id: 'task-selfapprove',
      state: 'APPROVAL',
      assigned_group: 'security',
      executor: 'security',
      gate: 'Security',
    });

    await processGovIpc(
      { type: 'gov_approve', taskId: 'task-selfapprove', gate_type: 'Security' },
      'security',
      false,
    );

    expect(getGovApprovals('task-selfapprove')).toHaveLength(0);
  });

  it('rejects invalid gate_type', async () => {
    await processGovIpc(
      { type: 'gov_approve', taskId: 'task-review', gate_type: 'FakeGate' },
      'main',
      true,
    );

    expect(getGovApprovals('task-review')).toHaveLength(0);
  });

  it('rejects missing taskId', async () => {
    await processGovIpc(
      { type: 'gov_approve', gate_type: 'Security' },
      'main',
      true,
    );
    // no crash
  });

  it('rejects nonexistent task', async () => {
    await processGovIpc(
      { type: 'gov_approve', taskId: 'nonexistent', gate_type: 'Security' },
      'main',
      true,
    );
    // no crash, no approval
  });

  it('logs activity on approval', async () => {
    await processGovIpc(
      { type: 'gov_approve', taskId: 'task-review', gate_type: 'Security', notes: 'ok' },
      'security',
      false,
    );

    const activities = getGovActivities('task-review');
    expect(activities).toHaveLength(1);
    expect(activities[0].action).toBe('approve');
    expect(activities[0].reason).toContain('Security');
  });

  it('idempotent: second approval for same gate replaces', async () => {
    await processGovIpc(
      { type: 'gov_approve', taskId: 'task-review', gate_type: 'Security', notes: 'first' },
      'security',
      false,
    );
    await processGovIpc(
      { type: 'gov_approve', taskId: 'task-review', gate_type: 'Security', notes: 'second' },
      'main',
      true,
    );

    const approvals = getGovApprovals('task-review');
    expect(approvals).toHaveLength(1);
    expect(approvals[0].notes).toBe('second');
  });
});

// --- gov_assign ---

describe('gov_assign', () => {
  beforeEach(() => {
    seedTask({ id: 'task-assign', state: 'TRIAGED' });
  });

  it('main can assign task to a group', async () => {
    await processGovIpc(
      { type: 'gov_assign', taskId: 'task-assign', assigned_group: 'security' },
      'main',
      true,
    );

    const task = getGovTaskById('task-assign');
    expect(task!.assigned_group).toBe('security');
  });

  it('main can assign with executor', async () => {
    await processGovIpc(
      {
        type: 'gov_assign',
        taskId: 'task-assign',
        assigned_group: 'developer',
        executor: 'friday',
      },
      'main',
      true,
    );

    const task = getGovTaskById('task-assign');
    expect(task!.assigned_group).toBe('developer');
    expect(task!.executor).toBe('friday');
  });

  it('non-main cannot assign', async () => {
    await processGovIpc(
      { type: 'gov_assign', taskId: 'task-assign', assigned_group: 'security' },
      'developer',
      false,
    );

    // assigned_group should be unchanged
    const task = getGovTaskById('task-assign');
    expect(task!.assigned_group).toBe('developer');
  });

  it('increments version on assign', async () => {
    const before = getGovTaskById('task-assign')!.version;

    await processGovIpc(
      { type: 'gov_assign', taskId: 'task-assign', assigned_group: 'security' },
      'main',
      true,
    );

    expect(getGovTaskById('task-assign')!.version).toBe(before + 1);
  });

  it('logs activity on assign', async () => {
    await processGovIpc(
      { type: 'gov_assign', taskId: 'task-assign', assigned_group: 'security' },
      'main',
      true,
    );

    const activities = getGovActivities('task-assign');
    expect(activities).toHaveLength(1);
    expect(activities[0].action).toBe('assign');
    expect(activities[0].reason).toContain('security');
  });

  it('rejects missing taskId', async () => {
    await processGovIpc(
      { type: 'gov_assign', assigned_group: 'security' },
      'main',
      true,
    );
    // no crash
  });

  it('rejects nonexistent task', async () => {
    await processGovIpc(
      { type: 'gov_assign', taskId: 'nonexistent', assigned_group: 'security' },
      'main',
      true,
    );
    // no crash
  });
});

// --- Full pipeline flow ---

describe('full pipeline flow', () => {
  it('INBOX → TRIAGED → READY → DOING → REVIEW → APPROVAL → DONE', async () => {
    // Create
    await processGovIpc(
      {
        type: 'gov_create',
        id: 'pipeline-1',
        title: 'Pipeline test',
        task_type: 'FEATURE',
        gate: 'Security',
        assigned_group: 'developer',
      },
      'main',
      true,
    );
    expect(getGovTaskById('pipeline-1')!.state).toBe('INBOX');

    // INBOX → TRIAGED
    await processGovIpc(
      { type: 'gov_transition', taskId: 'pipeline-1', toState: 'TRIAGED' },
      'main',
      true,
    );
    expect(getGovTaskById('pipeline-1')!.state).toBe('TRIAGED');

    // TRIAGED → READY
    await processGovIpc(
      { type: 'gov_transition', taskId: 'pipeline-1', toState: 'READY' },
      'main',
      true,
    );
    expect(getGovTaskById('pipeline-1')!.state).toBe('READY');

    // READY → DOING
    await processGovIpc(
      { type: 'gov_transition', taskId: 'pipeline-1', toState: 'DOING' },
      'developer',
      false,
    );
    expect(getGovTaskById('pipeline-1')!.state).toBe('DOING');

    // DOING → REVIEW
    await processGovIpc(
      { type: 'gov_transition', taskId: 'pipeline-1', toState: 'REVIEW', reason: 'Done implementing' },
      'developer',
      false,
    );
    expect(getGovTaskById('pipeline-1')!.state).toBe('REVIEW');

    // REVIEW → APPROVAL
    await processGovIpc(
      { type: 'gov_transition', taskId: 'pipeline-1', toState: 'APPROVAL' },
      'main',
      true,
    );
    expect(getGovTaskById('pipeline-1')!.state).toBe('APPROVAL');

    // Approve Security gate
    await processGovIpc(
      { type: 'gov_approve', taskId: 'pipeline-1', gate_type: 'Security', notes: 'Reviewed' },
      'security',
      false,
    );
    expect(getGovApprovals('pipeline-1')).toHaveLength(1);

    // APPROVAL → DONE
    await processGovIpc(
      { type: 'gov_transition', taskId: 'pipeline-1', toState: 'DONE' },
      'main',
      true,
    );
    expect(getGovTaskById('pipeline-1')!.state).toBe('DONE');

    // Verify full activity trail
    const activities = getGovActivities('pipeline-1');
    expect(activities.length).toBeGreaterThanOrEqual(7); // create + 6 transitions + 1 approval
    expect(activities[0].action).toBe('create');
    expect(activities[activities.length - 1].to_state).toBe('DONE');
  });

  it('rework flow: REVIEW → DOING → REVIEW', async () => {
    seedTask({ id: 'rework-1', state: 'REVIEW', assigned_group: 'developer' });

    // REVIEW → DOING (rework)
    await processGovIpc(
      { type: 'gov_transition', taskId: 'rework-1', toState: 'DOING', reason: 'Needs changes' },
      'main',
      true,
    );
    expect(getGovTaskById('rework-1')!.state).toBe('DOING');

    // DOING → REVIEW again
    await processGovIpc(
      { type: 'gov_transition', taskId: 'rework-1', toState: 'REVIEW', reason: 'Fixed' },
      'developer',
      false,
    );
    expect(getGovTaskById('rework-1')!.state).toBe('REVIEW');
  });

  it('blocked flow: DOING → BLOCKED → DOING', async () => {
    seedTask({ id: 'blocked-1', state: 'DOING', assigned_group: 'developer' });

    // DOING → BLOCKED
    await processGovIpc(
      { type: 'gov_transition', taskId: 'blocked-1', toState: 'BLOCKED', reason: 'Waiting on API' },
      'developer',
      false,
    );
    expect(getGovTaskById('blocked-1')!.state).toBe('BLOCKED');

    // BLOCKED → DOING
    await processGovIpc(
      { type: 'gov_transition', taskId: 'blocked-1', toState: 'DOING', reason: 'Unblocked' },
      'main',
      true,
    );
    expect(getGovTaskById('blocked-1')!.state).toBe('DOING');
  });
});

// --- Sprint 2: Strict review summary enforcement ---

describe('DOING→REVIEW strict summary enforcement', () => {
  const origStrict = process.env.GOV_STRICT;

  beforeEach(() => {
    seedTask({ id: 'strict-1', state: 'DOING', assigned_group: 'developer' });
  });

  afterEach(() => {
    if (origStrict !== undefined) {
      process.env.GOV_STRICT = origStrict;
    } else {
      delete process.env.GOV_STRICT;
    }
  });

  it('strict mode denies DOING→REVIEW without reason', async () => {
    process.env.GOV_STRICT = '1';

    await processGovIpc(
      { type: 'gov_transition', taskId: 'strict-1', toState: 'REVIEW' },
      'developer',
      false,
    );

    expect(getGovTaskById('strict-1')!.state).toBe('DOING'); // not transitioned
  });

  it('strict mode denies DOING→REVIEW with empty reason', async () => {
    process.env.GOV_STRICT = '1';

    await processGovIpc(
      { type: 'gov_transition', taskId: 'strict-1', toState: 'REVIEW', reason: '   ' },
      'developer',
      false,
    );

    expect(getGovTaskById('strict-1')!.state).toBe('DOING');
  });

  it('strict mode accepts DOING→REVIEW with summary', async () => {
    process.env.GOV_STRICT = '1';

    await processGovIpc(
      { type: 'gov_transition', taskId: 'strict-1', toState: 'REVIEW', reason: 'Implemented auth flow' },
      'developer',
      false,
    );

    expect(getGovTaskById('strict-1')!.state).toBe('REVIEW');
  });

  it('strict mode logs execution_summary activity on DOING→REVIEW', async () => {
    process.env.GOV_STRICT = '1';

    await processGovIpc(
      { type: 'gov_transition', taskId: 'strict-1', toState: 'REVIEW', reason: 'Built login page' },
      'developer',
      false,
    );

    const activities = getGovActivities('strict-1');
    const summaryAct = activities.find(a => a.action === 'execution_summary');
    expect(summaryAct).toBeDefined();
    expect(summaryAct!.reason).toBe('Built login page');
    expect(summaryAct!.from_state).toBe('DOING');
    expect(summaryAct!.to_state).toBe('REVIEW');
  });

  it('non-strict mode allows DOING→REVIEW without reason', async () => {
    delete process.env.GOV_STRICT;

    await processGovIpc(
      { type: 'gov_transition', taskId: 'strict-1', toState: 'REVIEW' },
      'developer',
      false,
    );

    expect(getGovTaskById('strict-1')!.state).toBe('REVIEW');
  });

  it('non-strict mode also logs execution_summary when reason provided', async () => {
    delete process.env.GOV_STRICT;

    await processGovIpc(
      { type: 'gov_transition', taskId: 'strict-1', toState: 'REVIEW', reason: 'Done with work' },
      'developer',
      false,
    );

    const activities = getGovActivities('strict-1');
    const summaryAct = activities.find(a => a.action === 'execution_summary');
    expect(summaryAct).toBeDefined();
    expect(summaryAct!.reason).toBe('Done with work');
  });

  it('strict mode does NOT enforce summary for other transitions', async () => {
    process.env.GOV_STRICT = '1';

    // DOING→BLOCKED should work without reason
    await processGovIpc(
      { type: 'gov_transition', taskId: 'strict-1', toState: 'BLOCKED' },
      'developer',
      false,
    );

    expect(getGovTaskById('strict-1')!.state).toBe('BLOCKED');
  });
});

// --- Sprint 1: Products CRUD ---

describe('products CRUD', () => {
  it('creates and retrieves a product', () => {
    const now = new Date().toISOString();
    createProduct({
      id: 'ritmo',
      name: 'Ritmo',
      status: 'active',
      risk_level: 'normal',
      created_at: now,
      updated_at: now,
    });

    const product = getProductById('ritmo');
    expect(product).toBeDefined();
    expect(product!.name).toBe('Ritmo');
    expect(product!.status).toBe('active');
    expect(product!.risk_level).toBe('normal');
  });

  it('lists products by status', () => {
    const now = new Date().toISOString();
    createProduct({ id: 'p1', name: 'Active', status: 'active', risk_level: 'normal', created_at: now, updated_at: now });
    createProduct({ id: 'p2', name: 'Paused', status: 'paused', risk_level: 'low', created_at: now, updated_at: now });
    createProduct({ id: 'p3', name: 'Also Active', status: 'active', risk_level: 'high', created_at: now, updated_at: now });

    expect(listProducts('active')).toHaveLength(2);
    expect(listProducts('paused')).toHaveLength(1);
    expect(listProducts()).toHaveLength(3);
  });

  it('updates a product', () => {
    const now = new Date().toISOString();
    createProduct({ id: 'upd', name: 'Before', status: 'active', risk_level: 'normal', created_at: now, updated_at: now });

    const updated = updateProduct('upd', { name: 'After', risk_level: 'high' });
    expect(updated).toBe(true);

    const product = getProductById('upd')!;
    expect(product.name).toBe('After');
    expect(product.risk_level).toBe('high');
  });

  it('update returns false for nonexistent product', () => {
    expect(updateProduct('nonexistent', { name: 'Nope' })).toBe(false);
  });

  it('upserts product on conflict (preserves created_at)', () => {
    const now = new Date().toISOString();
    createProduct({ id: 'dup', name: 'First', status: 'active', risk_level: 'normal', created_at: now, updated_at: now });
    createProduct({ id: 'dup', name: 'Second', status: 'paused', risk_level: 'high', created_at: now, updated_at: now });

    const product = getProductById('dup')!;
    expect(product.name).toBe('Second');
    expect(product.status).toBe('paused');
  });
});

// --- Sprint 1: gov_create with scope + product_id ---

describe('gov_create with scope and product_id', () => {
  it('creates task with PRODUCT scope and product_id', async () => {
    const now = new Date().toISOString();
    createProduct({ id: 'ritmo', name: 'Ritmo', status: 'active', risk_level: 'normal', created_at: now, updated_at: now });

    await processGovIpc(
      { type: 'gov_create', id: 'scoped-1', title: 'Ritmo bug', task_type: 'BUG', product_id: 'ritmo', scope: 'PRODUCT' },
      'main',
      true,
    );

    const task = getGovTaskById('scoped-1');
    expect(task).toBeDefined();
    expect(task!.product_id).toBe('ritmo');
    expect(task!.scope).toBe('PRODUCT');
  });

  it('creates task with COMPANY scope (no product_id)', async () => {
    await processGovIpc(
      { type: 'gov_create', id: 'company-1', title: 'Hire CTO', task_type: 'OPS', scope: 'COMPANY' },
      'main',
      true,
    );

    const task = getGovTaskById('company-1');
    expect(task).toBeDefined();
    expect(task!.scope).toBe('COMPANY');
    expect(task!.product_id).toBeNull();
  });

  it('defaults to COMPANY scope when no product_id', async () => {
    await processGovIpc(
      { type: 'gov_create', id: 'default-scope', title: 'Default', task_type: 'BUG' },
      'main',
      true,
    );

    const task = getGovTaskById('default-scope');
    expect(task!.scope).toBe('COMPANY');
    expect(task!.product_id).toBeNull();
  });

  it('defaults to PRODUCT scope when product_id provided', async () => {
    const now = new Date().toISOString();
    createProduct({ id: 'auto-scope', name: 'Auto', status: 'active', risk_level: 'normal', created_at: now, updated_at: now });

    await processGovIpc(
      { type: 'gov_create', id: 'auto-prod', title: 'Auto scope', task_type: 'BUG', product_id: 'auto-scope' },
      'main',
      true,
    );

    const task = getGovTaskById('auto-prod');
    expect(task!.scope).toBe('PRODUCT');
    expect(task!.product_id).toBe('auto-scope');
  });

  it('coerces PRODUCT scope to COMPANY when no product_id + logs activity', async () => {
    await processGovIpc(
      { type: 'gov_create', id: 'coerced-1', title: 'Orphan', task_type: 'BUG', scope: 'PRODUCT' },
      'main',
      true,
    );

    const task = getGovTaskById('coerced-1');
    expect(task).toBeDefined();
    expect(task!.scope).toBe('COMPANY');
    expect(task!.product_id).toBeNull();

    // Verify coercion audit activity was logged
    const activities = getGovActivities('coerced-1');
    const coerceAct = activities.find(a => a.action === 'coerce_scope');
    expect(coerceAct).toBeDefined();
    expect(coerceAct!.reason).toBe('PRODUCT_SCOPE_WITHOUT_PRODUCT_ID');
    expect(coerceAct!.actor).toBe('system');
  });

  it('rejects invalid scope', async () => {
    await processGovIpc(
      { type: 'gov_create', title: 'Bad scope', task_type: 'BUG', scope: 'INVALID' },
      'main',
      true,
    );

    const tasks = (await import('./gov-db.js')).getAllGovTasks();
    expect(tasks).toHaveLength(0);
  });

  it('rejects nonexistent product_id', async () => {
    await processGovIpc(
      { type: 'gov_create', title: 'Bad FK', task_type: 'BUG', product_id: 'nonexistent' },
      'main',
      true,
    );

    const tasks = (await import('./gov-db.js')).getAllGovTasks();
    expect(tasks).toHaveLength(0);
  });

  it('rejects COMPANY scope with product_id', async () => {
    const now = new Date().toISOString();
    createProduct({ id: 'ritmo', name: 'Ritmo', status: 'active', risk_level: 'normal', created_at: now, updated_at: now });

    await processGovIpc(
      { type: 'gov_create', title: 'Invalid combo', task_type: 'OPS', scope: 'COMPANY', product_id: 'ritmo' },
      'main',
      true,
    );

    const tasks = (await import('./gov-db.js')).getAllGovTasks();
    expect(tasks).toHaveLength(0);
  });

  it('denies task creation for killed product', async () => {
    const now = new Date().toISOString();
    createProduct({ id: 'dead', name: 'Dead Product', status: 'killed', risk_level: 'normal', created_at: now, updated_at: now });

    await processGovIpc(
      { type: 'gov_create', title: 'Zombie task', task_type: 'BUG', product_id: 'dead' },
      'main',
      true,
    );

    const tasks = (await import('./gov-db.js')).getAllGovTasks();
    expect(tasks).toHaveLength(0);
  });

  it('allows task creation for paused product', async () => {
    const now = new Date().toISOString();
    createProduct({ id: 'paused-p', name: 'Paused Product', status: 'paused', risk_level: 'normal', created_at: now, updated_at: now });

    await processGovIpc(
      { type: 'gov_create', id: 'paused-task', title: 'Paused product task', task_type: 'BUG', product_id: 'paused-p' },
      'main',
      true,
    );

    const task = getGovTaskById('paused-task');
    expect(task).toBeDefined();
    expect(task!.product_id).toBe('paused-p');
  });
});

// --- Sprint 1: query by product/scope ---

describe('query by product and scope', () => {
  beforeEach(() => {
    const now = new Date().toISOString();
    createProduct({ id: 'ritmo', name: 'Ritmo', status: 'active', risk_level: 'normal', created_at: now, updated_at: now });

    seedTask({ id: 'prod-1', product_id: 'ritmo', scope: 'PRODUCT' });
    seedTask({ id: 'prod-2', product_id: 'ritmo', scope: 'PRODUCT' });
    seedTask({ id: 'comp-1', product_id: null, scope: 'COMPANY' });
  });

  it('getGovTasksByProduct returns tasks for a product', () => {
    const tasks = getGovTasksByProduct('ritmo');
    expect(tasks).toHaveLength(2);
    expect(tasks.every(t => t.product_id === 'ritmo')).toBe(true);
  });

  it('getGovTasksByScope returns tasks by scope', () => {
    expect(getGovTasksByScope('PRODUCT')).toHaveLength(2);
    expect(getGovTasksByScope('COMPANY')).toHaveLength(1);
  });
});

// --- Sprint 2: Context helpers ---

describe('getGovActivitiesForContext', () => {
  beforeEach(() => {
    seedTask({ id: 'ctx-1', state: 'REVIEW', assigned_group: 'developer' });
    const now = new Date().toISOString();
    // Add various activities
    logGovActivity({ task_id: 'ctx-1', action: 'create', from_state: null, to_state: 'INBOX', actor: 'main', reason: null, created_at: now });
    logGovActivity({ task_id: 'ctx-1', action: 'transition', from_state: 'INBOX', to_state: 'TRIAGED', actor: 'main', reason: 'triaged', created_at: now });
    logGovActivity({ task_id: 'ctx-1', action: 'assign', from_state: 'TRIAGED', to_state: null, actor: 'main', reason: 'assigned dev', created_at: now });
    logGovActivity({ task_id: 'ctx-1', action: 'transition', from_state: 'TRIAGED', to_state: 'READY', actor: 'main', reason: null, created_at: now });
    logGovActivity({ task_id: 'ctx-1', action: 'transition', from_state: 'READY', to_state: 'DOING', actor: 'system', reason: 'Auto-dispatched', created_at: now });
    logGovActivity({ task_id: 'ctx-1', action: 'evidence', from_state: 'DOING', to_state: null, actor: 'developer', reason: 'PR #42 merged', created_at: now });
    logGovActivity({ task_id: 'ctx-1', action: 'execution_summary', from_state: 'DOING', to_state: null, actor: 'developer', reason: 'Implemented feature X', created_at: now });
    logGovActivity({ task_id: 'ctx-1', action: 'transition', from_state: 'DOING', to_state: 'REVIEW', actor: 'developer', reason: 'Done', created_at: now });
  });

  it('returns only context-useful actions (filters out create, assign)', () => {
    const activities = getGovActivitiesForContext('ctx-1');
    const actions = activities.map(a => a.action);
    expect(actions).not.toContain('create');
    expect(actions).not.toContain('assign');
    expect(actions).toContain('transition');
    expect(actions).toContain('evidence');
    expect(actions).toContain('execution_summary');
  });

  it('respects limit parameter', () => {
    const activities = getGovActivitiesForContext('ctx-1', 2);
    expect(activities).toHaveLength(2);
  });

  it('returns activities in descending order (newest first)', () => {
    const activities = getGovActivitiesForContext('ctx-1');
    // Last activity should be the most recent (DOING→REVIEW transition)
    expect(activities[0].action).toBe('transition');
    expect(activities[0].to_state).toBe('REVIEW');
  });

  it('returns empty array for task with no activities', () => {
    seedTask({ id: 'ctx-empty' });
    const activities = getGovActivitiesForContext('ctx-empty');
    expect(activities).toHaveLength(0);
  });

  it('includes approve actions', () => {
    logGovActivity({ task_id: 'ctx-1', action: 'approve', from_state: 'APPROVAL', to_state: null, actor: 'security', reason: 'Gate Security approved', created_at: new Date().toISOString() });
    const activities = getGovActivitiesForContext('ctx-1');
    expect(activities.some(a => a.action === 'approve')).toBe(true);
  });
});

describe('getGovTaskExecutionSummary', () => {
  beforeEach(() => {
    seedTask({ id: 'sum-1', state: 'REVIEW', assigned_group: 'developer' });
  });

  it('returns execution_summary activity reason (preferred)', () => {
    const now = new Date().toISOString();
    logGovActivity({ task_id: 'sum-1', action: 'execution_summary', from_state: 'DOING', to_state: null, actor: 'developer', reason: 'Built the login page with OAuth2', created_at: now });
    // Also add a transition (fallback source) — should NOT be used
    logGovActivity({ task_id: 'sum-1', action: 'transition', from_state: 'DOING', to_state: 'REVIEW', actor: 'developer', reason: 'Done implementing', created_at: now });

    const summary = getGovTaskExecutionSummary('sum-1');
    expect(summary).toBe('Built the login page with OAuth2');
  });

  it('falls back to DOING→REVIEW transition reason when no execution_summary', () => {
    const now = new Date().toISOString();
    logGovActivity({ task_id: 'sum-1', action: 'transition', from_state: 'DOING', to_state: 'REVIEW', actor: 'developer', reason: 'Completed feature work', created_at: now });

    const summary = getGovTaskExecutionSummary('sum-1');
    expect(summary).toBe('Completed feature work');
  });

  it('returns null when no summary or transition exists', () => {
    const summary = getGovTaskExecutionSummary('sum-1');
    expect(summary).toBeNull();
  });

  it('returns null when DOING→REVIEW transition has no reason', () => {
    const now = new Date().toISOString();
    logGovActivity({ task_id: 'sum-1', action: 'transition', from_state: 'DOING', to_state: 'REVIEW', actor: 'developer', reason: null, created_at: now });

    const summary = getGovTaskExecutionSummary('sum-1');
    expect(summary).toBeNull();
  });

  it('returns latest execution_summary when multiple exist', () => {
    const t1 = '2026-02-15T10:00:00.000Z';
    const t2 = '2026-02-15T11:00:00.000Z';
    logGovActivity({ task_id: 'sum-1', action: 'execution_summary', from_state: 'DOING', to_state: null, actor: 'developer', reason: 'First attempt', created_at: t1 });
    logGovActivity({ task_id: 'sum-1', action: 'execution_summary', from_state: 'DOING', to_state: null, actor: 'developer', reason: 'Final summary after rework', created_at: t2 });

    const summary = getGovTaskExecutionSummary('sum-1');
    expect(summary).toBe('Final summary after rework');
  });
});
