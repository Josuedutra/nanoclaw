import { describe, it, expect } from 'vitest';

import type { TaskState } from './constants.js';
import { validateTransition, type TaskLike } from './policy.js';

// --- Helper ---

function makeTask(overrides?: Partial<TaskLike>): TaskLike {
  return {
    type: 'FEATURE',
    priority: 'P2',
    owner: 'developer',
    gate: 'None',
    evidenceRequired: false,
    docsUpdated: false,
    dodChecklist: [{ label: 'Tests pass', done: true }],
    approvals: [],
    ...overrides,
  };
}

// --- Graph validation (non-strict) ---

describe('validateTransition (graph only)', () => {
  const validTransitions: [TaskState, TaskState][] = [
    ['INBOX', 'TRIAGED'],
    ['INBOX', 'BLOCKED'],
    ['TRIAGED', 'READY'],
    ['TRIAGED', 'BLOCKED'],
    ['READY', 'DOING'],
    ['READY', 'BLOCKED'],
    ['DOING', 'REVIEW'],
    ['DOING', 'BLOCKED'],
    ['REVIEW', 'APPROVAL'],
    ['REVIEW', 'DOING'],    // rework
    ['REVIEW', 'BLOCKED'],
    ['APPROVAL', 'DONE'],
    ['APPROVAL', 'REVIEW'], // changes requested
    ['APPROVAL', 'BLOCKED'],
    ['BLOCKED', 'INBOX'],
    ['BLOCKED', 'TRIAGED'],
    ['BLOCKED', 'READY'],
    ['BLOCKED', 'DOING'],
  ];

  for (const [from, to] of validTransitions) {
    it(`allows ${from} → ${to}`, () => {
      const result = validateTransition(from, to);
      expect(result.ok).toBe(true);
    });
  }

  const invalidTransitions: [TaskState, TaskState][] = [
    ['INBOX', 'DOING'],
    ['INBOX', 'DONE'],
    ['TRIAGED', 'DOING'],
    ['READY', 'REVIEW'],
    ['DOING', 'DONE'],        // must go through REVIEW
    ['REVIEW', 'DONE'],       // must go through APPROVAL
    ['DONE', 'INBOX'],        // terminal
    ['DONE', 'BLOCKED'],      // terminal
    ['BLOCKED', 'REVIEW'],
    ['BLOCKED', 'APPROVAL'],
    ['BLOCKED', 'DONE'],
  ];

  for (const [from, to] of invalidTransitions) {
    it(`rejects ${from} → ${to}`, () => {
      const result = validateTransition(from, to);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors[0]).toContain('INVALID_TRANSITION');
      }
    });
  }

  it('rejects unknown source state', () => {
    const result = validateTransition('NOPE' as TaskState, 'DOING');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toContain('UNKNOWN_STATE');
    }
  });
});

// --- Strict validation ---

describe('validateTransition (strict)', () => {
  it('requires priority and owner', () => {
    const task = makeTask({ priority: '', owner: '' });
    const result = validateTransition('INBOX', 'TRIAGED', task, true);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain('MISSING_PRIORITY');
      expect(result.errors).toContain('MISSING_OWNER');
    }
  });

  it('entering DOING requires DoD checklist', () => {
    const task = makeTask({ dodChecklist: [] });
    const result = validateTransition('READY', 'DOING', task, true);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain('MISSING_DOD_CHECKLIST');
    }
  });

  it('entering DOING requires evidenceRequired boolean', () => {
    const task = makeTask({ evidenceRequired: undefined as unknown as boolean });
    const result = validateTransition('READY', 'DOING', task, true);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain('MISSING_EVIDENCE_REQUIRED');
    }
  });

  it('DONE requires all DoD items completed', () => {
    const task = makeTask({
      dodChecklist: [
        { label: 'Tests', done: true },
        { label: 'Docs', done: false },
      ],
    });
    const result = validateTransition('APPROVAL', 'DONE', task, true);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain('DOD_INCOMPLETE');
    }
  });

  it('DONE for SECURITY type requires docs updated', () => {
    const task = makeTask({
      type: 'SECURITY',
      docsUpdated: false,
    });
    const result = validateTransition('APPROVAL', 'DONE', task, true);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain('DOCS_NOT_UPDATED');
    }
  });

  it('DONE with gate requires approval or override', () => {
    const task = makeTask({ gate: 'Security' });
    const result = validateTransition('APPROVAL', 'DONE', task, true);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain('GATE_NOT_APPROVED');
    }
  });

  it('DONE with gate passes when approval exists', () => {
    const task = makeTask({
      gate: 'Security',
      docsUpdated: true,
      approvals: [{
        gate: 'Security',
        approvedBy: 'security',
        timestampUtc: Date.now(),
      }],
    });
    const result = validateTransition('APPROVAL', 'DONE', task, true);
    expect(result.ok).toBe(true);
  });

  it('DONE with gate passes when override is used', () => {
    const task = makeTask({
      gate: 'Security',
      docsUpdated: true,
      override: {
        used: true,
        by: 'cto',
        reason: 'Urgent hotfix',
        acceptedRisk: 'Low',
        reviewDeadlineIso: '2026-02-28',
      },
    });
    const result = validateTransition('APPROVAL', 'DONE', task, true);
    expect(result.ok).toBe(true);
  });

  it('override requires all fields', () => {
    const task = makeTask({
      gate: 'Security',
      override: {
        used: true,
        by: '',
        reason: '',
        acceptedRisk: '',
        reviewDeadlineIso: '',
      },
    });
    const result = validateTransition('APPROVAL', 'DONE', task, true);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain('OVERRIDE_MISSING_BY');
      expect(result.errors).toContain('OVERRIDE_MISSING_REASON');
      expect(result.errors).toContain('OVERRIDE_MISSING_ACCEPTED_RISK');
      expect(result.errors).toContain('OVERRIDE_MISSING_REVIEW_DEADLINE');
    }
  });

  it('evidence required when transitioning out of REVIEW', () => {
    const task = makeTask({ evidenceRequired: true });
    const result = validateTransition('REVIEW', 'APPROVAL', task, true);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain('MISSING_EVIDENCE_LINK');
    }
  });

  it('evidence satisfied via auditLink', () => {
    const task = makeTask({
      evidenceRequired: true,
      auditLink: 'https://github.com/test/pr/1',
    });
    const result = validateTransition('REVIEW', 'APPROVAL', task, true);
    expect(result.ok).toBe(true);
  });

  it('evidence satisfied via approval evidenceLink', () => {
    const task = makeTask({
      evidenceRequired: true,
      approvals: [{
        gate: 'Security',
        approvedBy: 'security',
        timestampUtc: Date.now(),
        evidenceLink: 'https://github.com/test/pr/1',
      }],
    });
    const result = validateTransition('REVIEW', 'APPROVAL', task, true);
    expect(result.ok).toBe(true);
  });

  it('non-strict ignores all task fields', () => {
    const task = makeTask({ priority: '', owner: '', dodChecklist: [] });
    const result = validateTransition('READY', 'DOING', task, false);
    expect(result.ok).toBe(true);
  });
});
