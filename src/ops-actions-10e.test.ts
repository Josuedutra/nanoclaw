/**
 * Tests for Sprint 10E: Comments + @mentions + Notifications.
 */
import http from 'http';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { _initTestDatabase } from './db.js';
import {
  getGovActivities,
  getNotifications,
  getUnreadNotificationCount,
  markNotificationsRead,
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

const AUTH_READ = {
  'X-OS-SECRET': READ_SECRET,
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

function get(
  path: string,
  headers: Record<string, string> = AUTH_READ,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const req = http.request(
      url,
      { method: 'GET', headers },
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
    req.end();
  });
}

async function createTask(overrides?: Record<string, unknown>): Promise<string> {
  const res = await post('/ops/actions/create', {
    title: 'Test task',
    task_type: 'FEATURE',
    scope: 'COMPANY',
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

// === Comment endpoint ===

describe('POST /ops/actions/comment', () => {
  it('adds a comment and logs activity', async () => {
    const taskId = await createTask();
    const res = await post('/ops/actions/comment', {
      taskId,
      text: 'Looks good to me',
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.taskId).toBe(taskId);

    const activities = getGovActivities(taskId);
    const comment = activities.find((a) => a.action === 'COMMENT_ADDED');
    expect(comment).toBeTruthy();
    expect(comment!.reason).toBe('Looks good to me');
    expect(comment!.actor).toBe('cockpit');
  });

  it('trims whitespace from text', async () => {
    const taskId = await createTask();
    await post('/ops/actions/comment', { taskId, text: '  trimmed  ' });
    const activities = getGovActivities(taskId);
    const comment = activities.find((a) => a.action === 'COMMENT_ADDED');
    expect(comment!.reason).toBe('trimmed');
  });

  it('strips HTML tags', async () => {
    const taskId = await createTask();
    await post('/ops/actions/comment', { taskId, text: '<b>bold</b> text <script>evil</script>' });
    const activities = getGovActivities(taskId);
    const comment = activities.find((a) => a.action === 'COMMENT_ADDED');
    expect(comment!.reason).toBe('bold text evil');
  });

  it('rejects missing text', async () => {
    const taskId = await createTask();
    const res = await post('/ops/actions/comment', { taskId });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('text');
  });

  it('rejects empty text after sanitization', async () => {
    const taskId = await createTask();
    const res = await post('/ops/actions/comment', { taskId, text: '<br>' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('empty');
  });

  it('rejects text exceeding 4000 characters', async () => {
    const taskId = await createTask();
    const res = await post('/ops/actions/comment', { taskId, text: 'x'.repeat(4001) });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('4000');
  });

  it('rejects missing taskId', async () => {
    const res = await post('/ops/actions/comment', { text: 'hello' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('taskId');
  });

  it('returns 404 for unknown task', async () => {
    const res = await post('/ops/actions/comment', { taskId: 'gov-nonexistent', text: 'hello' });
    expect(res.status).toBe(404);
  });

  it('requires auth', async () => {
    const res = await post(
      '/ops/actions/comment',
      { taskId: 'x', text: 'hello' },
      { 'Content-Type': 'application/json' },
    );
    expect(res.status).toBe(401);
  });

  it('uses custom actor when provided', async () => {
    const taskId = await createTask();
    await post('/ops/actions/comment', { taskId, text: 'from dev', actor: 'developer' });
    const activities = getGovActivities(taskId);
    const comment = activities.find((a) => a.action === 'COMMENT_ADDED');
    expect(comment!.actor).toBe('developer');
  });

  it('defaults actor to cockpit when actor is too long', async () => {
    const taskId = await createTask();
    await post('/ops/actions/comment', { taskId, text: 'test', actor: 'a'.repeat(51) });
    const activities = getGovActivities(taskId);
    const comment = activities.find((a) => a.action === 'COMMENT_ADDED');
    expect(comment!.actor).toBe('cockpit');
  });
});

// === Mention parsing + Notifications ===

describe('Comment @mentions', () => {
  it('parses @developer and @security mentions', async () => {
    const taskId = await createTask();
    const res = await post('/ops/actions/comment', {
      taskId,
      text: 'cc @developer and @security please review',
    });
    expect(res.status).toBe(200);
    expect(res.body.mentions).toEqual(expect.arrayContaining(['developer', 'security']));
    expect((res.body.mentions as string[]).length).toBe(2);
  });

  it('creates notifications for mentioned groups', async () => {
    const taskId = await createTask();
    await post('/ops/actions/comment', {
      taskId,
      text: 'Hey @main please check this',
    });

    const notifs = getNotifications({ target_group: 'main' });
    expect(notifs.length).toBe(1);
    expect(notifs[0].task_id).toBe(taskId);
    expect(notifs[0].snippet).toContain('Hey @main');
    expect(notifs[0].read).toBe(0);
  });

  it('deduplicates mentions', async () => {
    const taskId = await createTask();
    const res = await post('/ops/actions/comment', {
      taskId,
      text: '@developer @developer @developer fix this',
    });
    expect((res.body.mentions as string[]).length).toBe(1);

    const notifs = getNotifications({ target_group: 'developer' });
    expect(notifs.length).toBe(1);
  });

  it('ignores invalid @mentions', async () => {
    const taskId = await createTask();
    const res = await post('/ops/actions/comment', {
      taskId,
      text: '@invalid @unknown hello',
    });
    expect(res.body.mentions).toEqual([]);
  });

  it('creates separate notifications for multiple groups', async () => {
    const taskId = await createTask();
    await post('/ops/actions/comment', {
      taskId,
      text: '@developer @security @revops all hands',
    });

    expect(getNotifications({ target_group: 'developer' }).length).toBe(1);
    expect(getNotifications({ target_group: 'security' }).length).toBe(1);
    expect(getNotifications({ target_group: 'revops' }).length).toBe(1);
  });

  it('returns empty mentions when no @mentions in text', async () => {
    const taskId = await createTask();
    const res = await post('/ops/actions/comment', { taskId, text: 'no mentions here' });
    expect(res.body.mentions).toEqual([]);
  });

  it('snippet is truncated to 200 characters', async () => {
    const taskId = await createTask();
    const longText = '@main ' + 'a'.repeat(300);
    await post('/ops/actions/comment', { taskId, text: longText });

    const notifs = getNotifications({ target_group: 'main' });
    expect(notifs[0].snippet.length).toBe(200);
  });
});

// === markRead ===

describe('POST /ops/actions/notifications/markRead', () => {
  it('marks notifications as read', async () => {
    const taskId = await createTask();
    await post('/ops/actions/comment', { taskId, text: '@developer check' });
    await post('/ops/actions/comment', { taskId, text: '@developer again' });

    const notifs = getNotifications({ target_group: 'developer' });
    expect(notifs.length).toBe(2);
    expect(getUnreadNotificationCount('developer')).toBe(2);

    const res = await post('/ops/actions/notifications/markRead', {
      ids: notifs.map((n) => n.id),
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.markedCount).toBe(2);

    expect(getUnreadNotificationCount('developer')).toBe(0);
  });

  it('returns 0 for already-read notifications', async () => {
    const taskId = await createTask();
    await post('/ops/actions/comment', { taskId, text: '@developer check' });

    const notifs = getNotifications({ target_group: 'developer' });
    markNotificationsRead(notifs.map((n) => n.id));

    const res = await post('/ops/actions/notifications/markRead', {
      ids: notifs.map((n) => n.id),
    });
    expect(res.body.markedCount).toBe(0);
  });

  it('rejects empty ids', async () => {
    const res = await post('/ops/actions/notifications/markRead', { ids: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('empty');
  });

  it('rejects non-array ids', async () => {
    const res = await post('/ops/actions/notifications/markRead', { ids: 'not-array' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('array');
  });

  it('rejects ids exceeding 100 items', async () => {
    const ids = Array.from({ length: 101 }, (_, i) => i);
    const res = await post('/ops/actions/notifications/markRead', { ids });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('100');
  });

  it('rejects non-number id', async () => {
    const res = await post('/ops/actions/notifications/markRead', { ids: ['not-a-number'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('number');
  });

  it('requires auth', async () => {
    const res = await post(
      '/ops/actions/notifications/markRead',
      { ids: [1] },
      { 'Content-Type': 'application/json' },
    );
    expect(res.status).toBe(401);
  });
});

// === GET /ops/notifications ===

describe('GET /ops/notifications', () => {
  it('returns notifications with unread count', async () => {
    const taskId = await createTask();
    await post('/ops/actions/comment', { taskId, text: '@developer please' });
    await post('/ops/actions/comment', { taskId, text: '@security review' });

    const res = await get('/ops/notifications');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.notifications)).toBe(true);
    expect((res.body.notifications as unknown[]).length).toBe(2);
    expect(res.body.unreadCount).toBe(2);
  });

  it('filters by target_group', async () => {
    const taskId = await createTask();
    await post('/ops/actions/comment', { taskId, text: '@developer @security test' });

    const res = await get('/ops/notifications?target_group=developer');
    expect((res.body.notifications as unknown[]).length).toBe(1);
  });

  it('filters by unread_only', async () => {
    const taskId = await createTask();
    await post('/ops/actions/comment', { taskId, text: '@developer one' });
    await post('/ops/actions/comment', { taskId, text: '@developer two' });

    const notifs = getNotifications({ target_group: 'developer' });
    markNotificationsRead([notifs[0].id]);

    const res = await get('/ops/notifications?unread_only=1');
    expect((res.body.notifications as unknown[]).length).toBe(1);
    expect(res.body.unreadCount).toBe(1);
  });

  it('requires auth', async () => {
    const res = await get('/ops/notifications', {});
    expect(res.status).toBe(401);
  });

  it('respects limit parameter', async () => {
    const taskId = await createTask();
    for (let i = 0; i < 5; i++) {
      await post('/ops/actions/comment', { taskId, text: `@developer msg${i}` });
    }

    const res = await get('/ops/notifications?limit=2');
    expect((res.body.notifications as unknown[]).length).toBe(2);
    expect(res.body.unreadCount).toBe(5);
  });
});
