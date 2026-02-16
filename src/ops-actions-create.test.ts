/**
 * Tests for POST /ops/actions/create — task creation via cockpit write pipeline.
 */
import http from 'http';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { _initTestDatabase } from './db.js';
import {
  createProduct,
  getGovTaskById,
  getGovActivities,
} from './gov-db.js';
import { startOpsHttp } from './ops-http.js';

let server: http.Server;
let baseUrl: string;

const READ_SECRET = 'test-ops-secret-42';
const WRITE_SECRET = 'test-write-secret-99';

const AUTH_WRITE = {
  'X-OS-SECRET': READ_SECRET,
  'X-WRITE-SECRET': WRITE_SECRET,
  'Content-Type': 'application/json',
};

const now = new Date().toISOString();

// --- HTTP helpers ---

function post(
  path: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = AUTH_WRITE,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const payload = JSON.stringify(body);
    const req = http.request(
      url,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Length': String(Buffer.byteLength(payload)) },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: string) => (data += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode!, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode!, body: { raw: data } as Record<string, unknown> });
          }
        });
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

beforeAll(async () => {
  process.env.OS_HTTP_SECRET = READ_SECRET;
  process.env.COCKPIT_WRITE_SECRET_CURRENT = WRITE_SECRET;
  _initTestDatabase();
  server = startOpsHttp(0);
  await new Promise<void>((resolve) => {
    server.on('listening', () => {
      const addr = server.address() as { port: number };
      baseUrl = `http://localhost:${addr.port}`;
      resolve();
    });
  });
});

afterAll(() => {
  server.close();
  delete process.env.OS_HTTP_SECRET;
  delete process.env.COCKPIT_WRITE_SECRET_CURRENT;
});

beforeEach(() => {
  _initTestDatabase();
});

// === Auth ===

describe('POST /ops/actions/create auth', () => {
  it('rejects without write secret (401)', async () => {
    const res = await post(
      '/ops/actions/create',
      { title: 'Test', task_type: 'BUG' },
      { 'X-OS-SECRET': READ_SECRET, 'Content-Type': 'application/json' },
    );
    expect(res.status).toBe(401);
  });

  it('rejects without read secret (401)', async () => {
    const res = await post(
      '/ops/actions/create',
      { title: 'Test', task_type: 'BUG' },
      { 'X-WRITE-SECRET': WRITE_SECRET, 'Content-Type': 'application/json' },
    );
    expect(res.status).toBe(401);
  });
});

// === Validation ===

describe('POST /ops/actions/create validation', () => {
  it('missing title returns 400', async () => {
    const res = await post('/ops/actions/create', { task_type: 'BUG' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('title');
  });

  it('missing task_type returns 400', async () => {
    const res = await post('/ops/actions/create', { title: 'Test' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('task_type');
  });

  it('title over 140 chars returns 400', async () => {
    const res = await post('/ops/actions/create', {
      title: 'x'.repeat(141),
      task_type: 'BUG',
      scope: 'COMPANY',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('140');
  });

  it('invalid task_type returns 400', async () => {
    const res = await post('/ops/actions/create', {
      title: 'Test',
      task_type: 'INVALID',
      scope: 'COMPANY',
    });
    expect(res.status).toBe(400);
  });

  it('invalid priority returns 400', async () => {
    const res = await post('/ops/actions/create', {
      title: 'Test',
      task_type: 'BUG',
      priority: 'P9',
      scope: 'COMPANY',
    });
    expect(res.status).toBe(400);
  });

  it('invalid gate returns 400', async () => {
    const res = await post('/ops/actions/create', {
      title: 'Test',
      task_type: 'BUG',
      gate: 'BadGate',
      scope: 'COMPANY',
    });
    expect(res.status).toBe(400);
  });

  it('invalid scope returns 400', async () => {
    const res = await post('/ops/actions/create', {
      title: 'Test',
      task_type: 'BUG',
      scope: 'INVALID',
    });
    expect(res.status).toBe(400);
  });
});

// === Scope / product rules ===

describe('POST /ops/actions/create scope rules', () => {
  it('PRODUCT scope without product_id returns 400', async () => {
    const res = await post('/ops/actions/create', {
      title: 'Test',
      task_type: 'BUG',
      scope: 'PRODUCT',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('product_id');
  });

  it('COMPANY scope forces product_id to null', async () => {
    createProduct({
      id: 'prod-test',
      name: 'Test Product',
      status: 'active',
      risk_level: 'normal',
      created_at: now,
      updated_at: now,
    });

    const res = await post('/ops/actions/create', {
      title: 'Company task',
      task_type: 'OPS',
      scope: 'COMPANY',
      product_id: 'prod-test',
    });
    expect(res.status).toBe(201);
    const task = getGovTaskById(res.body.taskId as string);
    expect(task).toBeDefined();
    expect(task!.product_id).toBeNull();
    expect(task!.scope).toBe('COMPANY');
  });
});

// === Success cases ===

describe('POST /ops/actions/create success', () => {
  it('creates task with COMPANY scope (minimal fields)', async () => {
    const res = await post('/ops/actions/create', {
      title: 'Fix login bug',
      task_type: 'BUG',
      scope: 'COMPANY',
    });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.taskId).toBeDefined();
    expect(res.body.state).toBe('INBOX');

    const task = getGovTaskById(res.body.taskId as string);
    expect(task).toBeDefined();
    expect(task!.title).toBe('Fix login bug');
    expect(task!.task_type).toBe('BUG');
    expect(task!.priority).toBe('P2');
    expect(task!.gate).toBe('None');
    expect(task!.state).toBe('INBOX');
  });

  it('creates task with PRODUCT scope and product_id', async () => {
    createProduct({
      id: 'ritmo',
      name: 'Ritmo',
      status: 'active',
      risk_level: 'normal',
      created_at: now,
      updated_at: now,
    });

    const res = await post('/ops/actions/create', {
      title: 'Add feature to Ritmo',
      task_type: 'FEATURE',
      scope: 'PRODUCT',
      product_id: 'ritmo',
      priority: 'P1',
      gate: 'Security',
      description: 'A detailed description',
      assigned_group: 'developer',
    });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);

    const task = getGovTaskById(res.body.taskId as string);
    expect(task).toBeDefined();
    expect(task!.product_id).toBe('ritmo');
    expect(task!.scope).toBe('PRODUCT');
    expect(task!.priority).toBe('P1');
    expect(task!.gate).toBe('Security');
    expect(task!.description).toBe('A detailed description');
    expect(task!.assigned_group).toBe('developer');
  });

  it('taskId format matches gov-<timestamp>-<random>', async () => {
    const res = await post('/ops/actions/create', {
      title: 'Format test',
      task_type: 'DOC',
      scope: 'COMPANY',
    });
    expect(res.status).toBe(201);
    expect(res.body.taskId).toMatch(/^gov-\d{8}T\d{6}Z-[a-z0-9]{6}$/);
  });

  it('logs create activity', async () => {
    const res = await post('/ops/actions/create', {
      title: 'Activity test',
      task_type: 'RESEARCH',
      scope: 'COMPANY',
    });
    expect(res.status).toBe(201);

    const activities = getGovActivities(res.body.taskId as string);
    const creates = activities.filter((a) => a.action === 'create');
    expect(creates.length).toBeGreaterThanOrEqual(1);
    expect(creates[0].to_state).toBe('INBOX');
  });

  it('defaults priority to P2 and gate to None', async () => {
    const res = await post('/ops/actions/create', {
      title: 'Defaults test',
      task_type: 'OPS',
      scope: 'COMPANY',
    });
    expect(res.status).toBe(201);
    const task = getGovTaskById(res.body.taskId as string);
    expect(task!.priority).toBe('P2');
    expect(task!.gate).toBe('None');
  });
});

// === Metadata (Sprint 10A) ===

describe('POST /ops/actions/create metadata', () => {
  it('persists metadata with dodChecklist', async () => {
    const checklist = ['Unit tests pass', 'Docs updated'];
    const res = await post('/ops/actions/create', {
      title: 'Meta test',
      task_type: 'FEATURE',
      scope: 'COMPANY',
      metadata: { dodChecklist: checklist },
    });
    expect(res.status).toBe(201);
    const task = getGovTaskById(res.body.taskId as string);
    expect(task).toBeDefined();
    const meta = JSON.parse(task!.metadata!);
    expect(meta.dodChecklist).toEqual(checklist);
    expect(meta.policy_version).toBeDefined();
  });

  it('rejects metadata exceeding 8192 bytes', async () => {
    const bigChecklist = Array.from({ length: 200 }, (_, i) => 'x'.repeat(50) + i);
    const res = await post('/ops/actions/create', {
      title: 'Big meta',
      task_type: 'BUG',
      scope: 'COMPANY',
      metadata: { dodChecklist: bigChecklist },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('8192');
  });

  it('rejects non-object metadata', async () => {
    const res = await post('/ops/actions/create', {
      title: 'Bad meta',
      task_type: 'BUG',
      scope: 'COMPANY',
      metadata: 'not-an-object',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('JSON object');
  });

  it('rejects array metadata', async () => {
    const res = await post('/ops/actions/create', {
      title: 'Array meta',
      task_type: 'BUG',
      scope: 'COMPANY',
      metadata: ['a', 'b'],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('JSON object');
  });

  it('creates task without metadata when not provided', async () => {
    const res = await post('/ops/actions/create', {
      title: 'No meta',
      task_type: 'DOC',
      scope: 'COMPANY',
    });
    expect(res.status).toBe(201);
    const task = getGovTaskById(res.body.taskId as string);
    expect(task).toBeDefined();
    // Should still have policy_version from kernel
    const meta = JSON.parse(task!.metadata!);
    expect(meta.policy_version).toBeDefined();
    expect(meta.dodChecklist).toBeUndefined();
  });

  it('SECURITY template preset uses gate=Security', async () => {
    const res = await post('/ops/actions/create', {
      title: 'Security audit',
      task_type: 'SECURITY',
      scope: 'COMPANY',
      gate: 'Security',
      assigned_group: 'security',
      metadata: {
        dodChecklist: [
          'Vulnerability assessment completed',
          'Fix reviewed by security team',
        ],
      },
    });
    expect(res.status).toBe(201);
    const task = getGovTaskById(res.body.taskId as string);
    expect(task).toBeDefined();
    expect(task!.gate).toBe('Security');
    expect(task!.assigned_group).toBe('security');
    const meta = JSON.parse(task!.metadata!);
    expect(meta.dodChecklist).toHaveLength(2);
    expect(meta.dodChecklist[0]).toContain('Vulnerability');
  });
});
