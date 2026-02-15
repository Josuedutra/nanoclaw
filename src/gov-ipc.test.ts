import { describe, it, expect, beforeEach } from 'vitest';

import { _initTestDatabase } from './db.js';
import {
  createGovTask,
  getGovActivities,
  getGovApprovals,
  getGovTaskById,
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
