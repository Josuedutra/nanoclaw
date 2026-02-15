import { describe, it, expect } from 'vitest';

import { checkApprover, checkApproverNotExecutor, GATE_APPROVER } from './gates.js';
import type { GateType } from './gates.js';

describe('GATE_APPROVER mapping', () => {
  it('Security maps to security group', () => {
    expect(GATE_APPROVER.Security).toBe('security');
  });

  it('RevOps/Claims/Product delegate to main', () => {
    expect(GATE_APPROVER.RevOps).toBe('main');
    expect(GATE_APPROVER.Claims).toBe('main');
    expect(GATE_APPROVER.Product).toBe('main');
  });
});

describe('checkApprover', () => {
  it('main group can approve any gate', () => {
    const gates: GateType[] = ['Security', 'RevOps', 'Claims', 'Product'];
    for (const gate of gates) {
      expect(checkApprover(gate, 'main', true)).toBeNull();
    }
  });

  it('security group can approve Security gate', () => {
    expect(checkApprover('Security', 'security', false)).toBeNull();
  });

  it('security group cannot approve RevOps gate', () => {
    const err = checkApprover('RevOps', 'security', false);
    expect(err).not.toBeNull();
    expect(err).toContain('FORBIDDEN');
    expect(err).toContain('main');
  });

  it('developer group cannot approve Security gate', () => {
    const err = checkApprover('Security', 'developer', false);
    expect(err).not.toBeNull();
    expect(err).toContain('FORBIDDEN');
    expect(err).toContain('security');
  });

  it('developer group cannot approve Product gate', () => {
    const err = checkApprover('Product', 'developer', false);
    expect(err).not.toBeNull();
    expect(err).toContain('FORBIDDEN');
  });
});

describe('checkApproverNotExecutor', () => {
  it('allows approval when approver differs from executor', () => {
    expect(checkApproverNotExecutor('security', 'developer')).toBeNull();
  });

  it('blocks approval when approver is the executor', () => {
    const err = checkApproverNotExecutor('developer', 'developer');
    expect(err).not.toBeNull();
    expect(err).toContain('FORBIDDEN');
    expect(err).toContain('executor');
  });

  it('allows approval when executor is null', () => {
    expect(checkApproverNotExecutor('security', null)).toBeNull();
  });

  it('allows main approving a task executed by developer', () => {
    expect(checkApproverNotExecutor('main', 'developer')).toBeNull();
  });
});
