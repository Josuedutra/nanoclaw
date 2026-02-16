/**
 * Tests for Sprint 10B write actions: DoD update, evidence, docsUpdated.
 */
import http from 'http';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { _initTestDatabase } from './db.js';
import {
  getGovTaskById,
  getGovActivities,
} from './gov-db.js';
import { processGovIpc } from './gov-ipc.js';
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

/** Create a task and return its ID. */
async function createTask(overrides?: Record<string, unknown>): Promise<string> {
  const res = await post('/ops/actions/create', {
    title: 'Test task',
    task_type: 'FEATURE',
    scope: 'COMPANY',
    metadata: { dodChecklist: ['Item A', 'Item B', 'Item C'] },
    ...overrides,
  });
  return res.body.taskId as string;
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

// === DoD Update ===

describe('POST /ops/actions/dod', () => {
  it('updates dodChecklist with done flags and assigns stable IDs', async () => {
    const taskId = await createTask();
    const res = await post('/ops/actions/dod', {
      taskId,
      dodChecklist: [
        { text: 'Item A updated', done: true },
        { text: 'Item B updated', done: false },
        { text: 'Item C updated', done: true },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const task = getGovTaskById(taskId);
    const meta = JSON.parse(task!.metadata!);
    expect(meta.dodStatus).toHaveLength(3);
    // Each item gets a server-assigned stable ID
    expect(meta.dodStatus[0]).toMatchObject({ text: 'Item A updated', done: true });
    expect(meta.dodStatus[0].id).toMatch(/^dod-/);
    expect(meta.dodStatus[1]).toMatchObject({ text: 'Item B updated', done: false });
    expect(meta.dodStatus[1].id).toMatch(/^dod-/);
    // dodChecklist (text-only) preserved for backward compat
    expect(meta.dodChecklist).toEqual(['Item A updated', 'Item B updated', 'Item C updated']);
  });

  it('preserves existing stable IDs from client', async () => {
    const taskId = await createTask();
    const res = await post('/ops/actions/dod', {
      taskId,
      dodChecklist: [
        { id: 'dod-abc123', text: 'Keep my ID', done: false },
        { text: 'Need a new ID', done: true },
        { id: 'tmp-bad', text: 'Bad prefix gets replaced', done: false },
      ],
    });
    expect(res.status).toBe(200);
    const task = getGovTaskById(taskId);
    const meta = JSON.parse(task!.metadata!);
    // Valid dod- prefix preserved
    expect(meta.dodStatus[0].id).toBe('dod-abc123');
    // Missing ID gets server-assigned
    expect(meta.dodStatus[1].id).toMatch(/^dod-/);
    expect(meta.dodStatus[1].id).not.toBe('dod-abc123');
    // Invalid prefix gets replaced
    expect(meta.dodStatus[2].id).toMatch(/^dod-/);
    expect(meta.dodStatus[2].id).not.toBe('tmp-bad');
  });

  it('logs DOD_UPDATED activity with done count and hash', async () => {
    const taskId = await createTask();
    await post('/ops/actions/dod', {
      taskId,
      dodChecklist: [
        { text: 'Item Alpha', done: true },
        { text: 'Item Beta', done: true },
      ],
    });
    const activities = getGovActivities(taskId);
    const dodActs = activities.filter((a) => a.action === 'DOD_UPDATED');
    expect(dodActs.length).toBe(1);
    expect(dodActs[0].reason).toContain('2/2');
    expect(dodActs[0].reason).toMatch(/h:[a-z0-9]+/);
  });

  it('trims whitespace from text', async () => {
    const taskId = await createTask();
    const res = await post('/ops/actions/dod', {
      taskId,
      dodChecklist: [{ text: '  Padded text  ', done: false }],
    });
    expect(res.status).toBe(200);
    const task = getGovTaskById(taskId);
    const meta = JSON.parse(task!.metadata!);
    expect(meta.dodStatus[0].text).toBe('Padded text');
  });

  it('rejects missing taskId', async () => {
    const res = await post('/ops/actions/dod', {
      dodChecklist: [{ text: 'Valid item', done: false }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('taskId');
  });

  it('rejects non-array dodChecklist', async () => {
    const taskId = await createTask();
    const res = await post('/ops/actions/dod', {
      taskId,
      dodChecklist: 'not-array',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('array');
  });

  it('rejects items with wrong shape', async () => {
    const taskId = await createTask();
    const res = await post('/ops/actions/dod', {
      taskId,
      dodChecklist: [{ text: 'valid text', done: 'not-bool' }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('dodChecklist[0]');
  });

  it('rejects text shorter than 4 chars', async () => {
    const taskId = await createTask();
    const res = await post('/ops/actions/dod', {
      taskId,
      dodChecklist: [{ text: 'ab', done: false }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('4 characters');
  });

  it('rejects text exceeding 200 chars', async () => {
    const taskId = await createTask();
    const res = await post('/ops/actions/dod', {
      taskId,
      dodChecklist: [{ text: 'x'.repeat(201), done: false }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('200 characters');
  });

  it('rejects more than 50 items', async () => {
    const taskId = await createTask();
    const items = Array.from({ length: 51 }, (_, i) => ({ text: `Item number ${i}`, done: false }));
    const res = await post('/ops/actions/dod', { taskId, dodChecklist: items });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('50 items');
  });

  it('returns 404 for unknown task', async () => {
    const res = await post('/ops/actions/dod', {
      taskId: 'gov-nonexistent',
      dodChecklist: [{ text: 'Valid item', done: false }],
    });
    expect(res.status).toBe(404);
  });

  it('requires auth', async () => {
    const res = await post(
      '/ops/actions/dod',
      { taskId: 'x', dodChecklist: [] },
      { 'Content-Type': 'application/json' },
    );
    expect(res.status).toBe(401);
  });
});

// === Evidence ===

describe('POST /ops/actions/evidence', () => {
  it('adds evidence link + note to metadata', async () => {
    const taskId = await createTask();
    const res = await post('/ops/actions/evidence', {
      taskId,
      link: 'https://github.com/org/repo/pull/42',
      note: 'PR review passed',
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.evidenceCount).toBe(1);

    const task = getGovTaskById(taskId);
    const meta = JSON.parse(task!.metadata!);
    expect(meta.evidence).toHaveLength(1);
    expect(meta.evidence[0].link).toBe('https://github.com/org/repo/pull/42');
    expect(meta.evidence[0].note).toBe('PR review passed');
    expect(meta.evidence[0].addedAt).toBeTruthy();
  });

  it('appends multiple evidence entries', async () => {
    const taskId = await createTask();
    await post('/ops/actions/evidence', { taskId, link: 'https://a.com' });
    const res = await post('/ops/actions/evidence', { taskId, link: 'https://b.com', note: 'second' });
    expect(res.status).toBe(200);
    expect(res.body.evidenceCount).toBe(2);
  });

  it('logs EVIDENCE_ADDED activity', async () => {
    const taskId = await createTask();
    await post('/ops/actions/evidence', {
      taskId,
      link: 'https://example.com',
      note: 'test evidence',
    });
    const activities = getGovActivities(taskId);
    const evActs = activities.filter((a) => a.action === 'EVIDENCE_ADDED');
    expect(evActs.length).toBe(1);
    expect(evActs[0].reason).toContain('https://example.com');
    expect(evActs[0].reason).toContain('test evidence');
  });

  it('rejects missing link', async () => {
    const taskId = await createTask();
    const res = await post('/ops/actions/evidence', { taskId });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('link');
  });

  it('rejects link over 2000 chars', async () => {
    const taskId = await createTask();
    const res = await post('/ops/actions/evidence', {
      taskId,
      link: 'https://x.com/' + 'a'.repeat(2000),
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('2000');
  });

  it('rejects note over 1000 chars', async () => {
    const taskId = await createTask();
    const res = await post('/ops/actions/evidence', {
      taskId,
      link: 'https://x.com',
      note: 'n'.repeat(1001),
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('1000');
  });

  it('returns 404 for unknown task', async () => {
    const res = await post('/ops/actions/evidence', {
      taskId: 'gov-nonexistent',
      link: 'https://a.com',
    });
    expect(res.status).toBe(404);
  });

  it('requires auth', async () => {
    const res = await post(
      '/ops/actions/evidence',
      { taskId: 'x', link: 'https://a.com' },
      { 'Content-Type': 'application/json' },
    );
    expect(res.status).toBe(401);
  });
});

// === DocsUpdated ===

describe('POST /ops/actions/docsUpdated', () => {
  it('sets docsUpdated=true in metadata', async () => {
    const taskId = await createTask();
    const res = await post('/ops/actions/docsUpdated', {
      taskId,
      docsUpdated: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const task = getGovTaskById(taskId);
    const meta = JSON.parse(task!.metadata!);
    expect(meta.docsUpdated).toBe(true);
  });

  it('sets docsUpdated=false in metadata', async () => {
    const taskId = await createTask();
    // Set to true first
    await post('/ops/actions/docsUpdated', { taskId, docsUpdated: true });
    // Now unset
    const res = await post('/ops/actions/docsUpdated', { taskId, docsUpdated: false });
    expect(res.status).toBe(200);

    const task = getGovTaskById(taskId);
    const meta = JSON.parse(task!.metadata!);
    expect(meta.docsUpdated).toBe(false);
  });

  it('logs DOCS_UPDATED_SET activity', async () => {
    const taskId = await createTask();
    await post('/ops/actions/docsUpdated', { taskId, docsUpdated: true });
    const activities = getGovActivities(taskId);
    const docActs = activities.filter((a) => a.action === 'DOCS_UPDATED_SET');
    expect(docActs.length).toBe(1);
    expect(docActs[0].reason).toContain('updated');
  });

  it('rejects non-boolean docsUpdated', async () => {
    const taskId = await createTask();
    const res = await post('/ops/actions/docsUpdated', {
      taskId,
      docsUpdated: 'yes',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('boolean');
  });

  it('rejects missing taskId', async () => {
    const res = await post('/ops/actions/docsUpdated', {
      docsUpdated: true,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('taskId');
  });

  it('returns 404 for unknown task', async () => {
    const res = await post('/ops/actions/docsUpdated', {
      taskId: 'gov-nonexistent',
      docsUpdated: true,
    });
    expect(res.status).toBe(404);
  });

  it('requires auth', async () => {
    const res = await post(
      '/ops/actions/docsUpdated',
      { taskId: 'x', docsUpdated: true },
      { 'Content-Type': 'application/json' },
    );
    expect(res.status).toBe(401);
  });

  it('preserves existing metadata fields', async () => {
    const taskId = await createTask();
    // Add evidence first
    await post('/ops/actions/evidence', { taskId, link: 'https://test.com' });
    // Set docs flag
    await post('/ops/actions/docsUpdated', { taskId, docsUpdated: true });

    const task = getGovTaskById(taskId);
    const meta = JSON.parse(task!.metadata!);
    // Evidence still there
    expect(meta.evidence).toHaveLength(1);
    expect(meta.docsUpdated).toBe(true);
    // policy_version still there
    expect(meta.policy_version).toBeDefined();
  });
});
