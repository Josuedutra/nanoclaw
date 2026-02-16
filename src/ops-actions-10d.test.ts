/**
 * Tests for Sprint 10D: Bulk evidence endpoint.
 */
import http from 'http';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { _initTestDatabase } from './db.js';
import {
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

describe('POST /ops/actions/evidence/bulk', () => {
  // === Validation ===

  it('rejects missing taskId', async () => {
    const res = await post('/ops/actions/evidence/bulk', {
      links: ['https://a.com'],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('taskId');
  });

  it('rejects non-array links', async () => {
    const taskId = await createTask();
    const res = await post('/ops/actions/evidence/bulk', {
      taskId,
      links: 'not-array',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('array');
  });

  it('rejects empty links array', async () => {
    const taskId = await createTask();
    const res = await post('/ops/actions/evidence/bulk', {
      taskId,
      links: [],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('empty');
  });

  it('rejects more than 20 links', async () => {
    const taskId = await createTask();
    const links = Array.from({ length: 21 }, (_, i) => `https://example.com/${i}`);
    const res = await post('/ops/actions/evidence/bulk', { taskId, links });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('20');
  });

  it('rejects link exceeding 2000 characters', async () => {
    const taskId = await createTask();
    const res = await post('/ops/actions/evidence/bulk', {
      taskId,
      links: ['https://x.com/' + 'a'.repeat(2000)],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('2000');
  });

  it('rejects invalid URL format', async () => {
    const taskId = await createTask();
    const res = await post('/ops/actions/evidence/bulk', {
      taskId,
      links: ['not-a-url'],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('not a valid URL');
  });

  it('rejects non-string link', async () => {
    const taskId = await createTask();
    const res = await post('/ops/actions/evidence/bulk', {
      taskId,
      links: [123],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('string');
  });

  it('rejects note exceeding 1000 characters', async () => {
    const taskId = await createTask();
    const res = await post('/ops/actions/evidence/bulk', {
      taskId,
      links: ['https://a.com'],
      note: 'n'.repeat(1001),
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('1000');
  });

  it('returns 404 for unknown task', async () => {
    const res = await post('/ops/actions/evidence/bulk', {
      taskId: 'gov-nonexistent',
      links: ['https://a.com'],
    });
    expect(res.status).toBe(404);
  });

  it('requires auth', async () => {
    const res = await post(
      '/ops/actions/evidence/bulk',
      { taskId: 'x', links: ['https://a.com'] },
      { 'Content-Type': 'application/json' },
    );
    expect(res.status).toBe(401);
  });

  // === Success ===

  it('adds multiple evidence entries atomically', async () => {
    const taskId = await createTask();
    const res = await post('/ops/actions/evidence/bulk', {
      taskId,
      links: ['https://a.com', 'https://b.com', 'https://c.com'],
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.addedCount).toBe(3);
    expect(res.body.evidenceCount).toBe(3);

    const task = getGovTaskById(taskId);
    const meta = JSON.parse(task!.metadata!);
    expect(meta.evidence).toHaveLength(3);
    expect(meta.evidence[0].link).toBe('https://a.com');
    expect(meta.evidence[1].link).toBe('https://b.com');
    expect(meta.evidence[2].link).toBe('https://c.com');
  });

  it('applies shared note to all entries', async () => {
    const taskId = await createTask();
    const res = await post('/ops/actions/evidence/bulk', {
      taskId,
      links: ['https://a.com', 'https://b.com'],
      note: 'Sprint evidence',
    });
    expect(res.status).toBe(200);

    const task = getGovTaskById(taskId);
    const meta = JSON.parse(task!.metadata!);
    expect(meta.evidence[0].note).toBe('Sprint evidence');
    expect(meta.evidence[1].note).toBe('Sprint evidence');
    expect(meta.evidence[0].addedAt).toBeTruthy();
  });

  it('preserves existing evidence entries', async () => {
    const taskId = await createTask();
    // Add single evidence first
    await post('/ops/actions/evidence', { taskId, link: 'https://first.com' });
    // Now bulk add
    const res = await post('/ops/actions/evidence/bulk', {
      taskId,
      links: ['https://second.com', 'https://third.com'],
    });
    expect(res.status).toBe(200);
    expect(res.body.evidenceCount).toBe(3);

    const task = getGovTaskById(taskId);
    const meta = JSON.parse(task!.metadata!);
    expect(meta.evidence[0].link).toBe('https://first.com');
    expect(meta.evidence[1].link).toBe('https://second.com');
    expect(meta.evidence[2].link).toBe('https://third.com');
  });

  it('allows http links in non-production', async () => {
    const taskId = await createTask();
    const res = await post('/ops/actions/evidence/bulk', {
      taskId,
      links: ['http://localhost:3000/test'],
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  // === Activity ===

  it('logs ONE EVIDENCE_BULK_ADDED activity with count', async () => {
    const taskId = await createTask();
    await post('/ops/actions/evidence/bulk', {
      taskId,
      links: ['https://a.com', 'https://b.com', 'https://c.com'],
      note: 'batch note',
    });
    const activities = getGovActivities(taskId);
    const bulkActs = activities.filter((a) => a.action === 'EVIDENCE_BULK_ADDED');
    expect(bulkActs.length).toBe(1);
    expect(bulkActs[0].reason).toContain('3 links added');
    expect(bulkActs[0].reason).toContain('batch note');
    // No raw URLs in the activity reason
    expect(bulkActs[0].reason).not.toContain('https://a.com');
  });
});
