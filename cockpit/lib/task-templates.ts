/**
 * Sprint 10A: Task template presets by task_type.
 * Auto-fills gate, assigned_group, and DoD checklist when creating tasks.
 */

export interface TaskTemplate {
  gate: string;
  assignedGroup: string;
  dodChecklist: string[];
}

export const TASK_TEMPLATES: Partial<Record<string, TaskTemplate>> = {
  FEATURE: {
    gate: 'Product',
    assignedGroup: 'developer',
    dodChecklist: [
      'Unit tests cover new functionality',
      'Integration test for happy path',
      'Documentation updated',
      'No regressions in existing tests',
    ],
  },
  BUG: {
    gate: 'None',
    assignedGroup: 'developer',
    dodChecklist: [
      'Root cause identified and documented',
      'Fix verified with regression test',
      'No regressions in existing tests',
    ],
  },
  SECURITY: {
    gate: 'Security',
    assignedGroup: 'security',
    dodChecklist: [
      'Vulnerability assessment completed',
      'Fix reviewed by security team',
      'Penetration test passed',
      'Security advisory drafted if applicable',
    ],
  },
  REVOPS: {
    gate: 'RevOps',
    assignedGroup: 'revops',
    dodChecklist: [
      'Revenue impact assessed',
      'Billing changes validated',
      'Stakeholder sign-off obtained',
    ],
  },
  OPS: {
    gate: 'None',
    assignedGroup: 'developer',
    dodChecklist: [
      'Runbook updated',
      'Monitoring and alerts configured',
      'Rollback plan documented',
    ],
  },
  DOC: {
    gate: 'None',
    assignedGroup: 'developer',
    dodChecklist: [
      'Content reviewed for accuracy',
      'Links and references verified',
      'Format consistent with style guide',
    ],
  },
  INCIDENT: {
    gate: 'Security',
    assignedGroup: 'developer',
    dodChecklist: [
      'Incident timeline documented',
      'Root cause analysis completed',
      'Remediation verified',
      'Post-mortem scheduled',
    ],
  },
};
