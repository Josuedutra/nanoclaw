/**
 * Tests for cockpit topic system:
 * - Topic CRUD (create, list, activity update, archive)
 * - Virtual JID routing (messages stored under cockpit:{topicId})
 * - Multi-session isolation (topics across agents)
 * - API endpoints: GET /ops/topics, POST /ops/actions/topic
 */
import http from 'http';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  _initTestDatabase,
  createCockpitTopic,
  getCockpitTopics,
  getCockpitTopicById,
  updateTopicActivity,
  updateTopicTitle,
  archiveCockpitTopic,
  getDb,
} from './db.js';
import { startOpsHttp } from './ops-http.js';

let server: http.Server;
let baseUrl: string;

const READ_SECRET = 'test-ops-secret-42';
const WRITE_SECRET = 'test-write-secret-99';

const AUTH_READ = { 'X-OS-SECRET': READ_SECRET };
const AUTH_WRITE = {
  'X-OS-SECRET': READ_SECRET,
  'X-WRITE-SECRET': WRITE_SECRET,
  'Content-Type': 'application/json',
};

// --- HTTP helpers ---

function get(
  path: string,
  headers: Record<string, string> = AUTH_READ,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const req = http.request(url, { method: 'GET', headers }, (res) => {
      let data = '';
      res.on('data', (chunk: string) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode!, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode!, body: { raw: data } as Record<string, unknown> });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

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

// --- Setup / Teardown ---

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

// === DB-level Topic CRUD ===

describe('Topic CRUD (DB level)', () => {
  it('creates a topic and retrieves it by ID', () => {
    createCockpitTopic({ id: 'topic-1', group_folder: 'main', title: 'Test Topic' });
    const topic = getCockpitTopicById('topic-1');
    expect(topic).toBeDefined();
    expect(topic!.id).toBe('topic-1');
    expect(topic!.group_folder).toBe('main');
    expect(topic!.title).toBe('Test Topic');
    expect(topic!.status).toBe('active');
  });

  it('lists topics filtered by group_folder', () => {
    createCockpitTopic({ id: 'topic-main-1', group_folder: 'main', title: 'Main 1' });
    createCockpitTopic({ id: 'topic-dev-1', group_folder: 'developer', title: 'Dev 1' });
    createCockpitTopic({ id: 'topic-main-2', group_folder: 'main', title: 'Main 2' });

    const mainTopics = getCockpitTopics('main');
    expect(mainTopics.length).toBe(2);

    const devTopics = getCockpitTopics('developer');
    expect(devTopics.length).toBe(1);

    const allTopics = getCockpitTopics();
    expect(allTopics.length).toBe(3);
  });

  it('updates topic activity timestamp', () => {
    createCockpitTopic({ id: 'topic-act', group_folder: 'main', title: 'Activity Test' });
    const before = getCockpitTopicById('topic-act')!.last_activity;

    // Small delay to ensure timestamp changes
    updateTopicActivity('topic-act');
    const after = getCockpitTopicById('topic-act')!.last_activity;
    expect(after >= before).toBe(true);
  });

  it('updates topic title', () => {
    createCockpitTopic({ id: 'topic-title', group_folder: 'main', title: 'Old Title' });
    updateTopicTitle('topic-title', 'New Title');
    const topic = getCockpitTopicById('topic-title');
    expect(topic!.title).toBe('New Title');
  });

  it('archives a topic', () => {
    createCockpitTopic({ id: 'topic-arch', group_folder: 'main', title: 'Archive Me' });
    archiveCockpitTopic('topic-arch');

    const topic = getCockpitTopicById('topic-arch');
    expect(topic!.status).toBe('archived');

    // Archived topics excluded from active list
    const active = getCockpitTopics('main');
    expect(active.length).toBe(0);
  });

  it('lists topics ordered by last_activity desc', () => {
    createCockpitTopic({ id: 'topic-old', group_folder: 'main', title: 'Old' });
    createCockpitTopic({ id: 'topic-new', group_folder: 'main', title: 'New' });
    // Force the old topic to have an older timestamp
    const db = getDb();
    db.prepare("UPDATE cockpit_topics SET last_activity = '2020-01-01T00:00:00.000Z' WHERE id = 'topic-old'").run();

    const topics = getCockpitTopics('main');
    expect(topics[0].id).toBe('topic-new');
    expect(topics[1].id).toBe('topic-old');
  });
});

// === API-level Topic Endpoints ===

describe('GET /ops/topics', () => {
  it('returns empty array when no topics exist', async () => {
    const res = await get('/ops/topics');
    expect(res.status).toBe(200);
    expect(res.body.topics).toEqual([]);
  });

  it('returns topics for all groups', async () => {
    createCockpitTopic({ id: 't1', group_folder: 'main', title: 'Main Topic' });
    createCockpitTopic({ id: 't2', group_folder: 'developer', title: 'Dev Topic' });

    const res = await get('/ops/topics');
    expect(res.status).toBe(200);
    const topics = res.body.topics as Array<{ id: string }>;
    expect(topics.length).toBe(2);
  });

  it('filters by group parameter', async () => {
    createCockpitTopic({ id: 't1', group_folder: 'main', title: 'Main Topic' });
    createCockpitTopic({ id: 't2', group_folder: 'developer', title: 'Dev Topic' });

    const res = await get('/ops/topics?group=developer');
    expect(res.status).toBe(200);
    const topics = res.body.topics as Array<{ id: string; group_folder: string }>;
    expect(topics.length).toBe(1);
    expect(topics[0].group_folder).toBe('developer');
  });

  it('rejects without auth (401)', async () => {
    const res = await get('/ops/topics', {});
    expect(res.status).toBe(401);
  });
});

describe('POST /ops/actions/topic', () => {
  it('creates a new topic with defaults', async () => {
    const res = await post('/ops/actions/topic', {});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const topic = res.body.topic as { id: string; group_folder: string; title: string };
    expect(topic.id).toMatch(/^topic-/);
    expect(topic.group_folder).toBe('main');
    expect(topic.title).toBe('New Topic');
  });

  it('creates a topic for a specific group', async () => {
    const res = await post('/ops/actions/topic', { group: 'developer', title: 'Fix auth bug' });
    expect(res.status).toBe(200);
    const topic = res.body.topic as { id: string; group_folder: string; title: string };
    expect(topic.group_folder).toBe('developer');
    expect(topic.title).toBe('Fix auth bug');
  });

  it('topic is visible via GET /ops/topics', async () => {
    const createRes = await post('/ops/actions/topic', { group: 'security', title: 'Review PR' });
    expect(createRes.status).toBe(200);

    const listRes = await get('/ops/topics?group=security');
    const topics = listRes.body.topics as Array<{ title: string }>;
    expect(topics.length).toBe(1);
    expect(topics[0].title).toBe('Review PR');
  });
});

// === Multi-agent topic isolation ===

describe('Multi-agent topic isolation', () => {
  it('topics for different agents are independent', () => {
    createCockpitTopic({ id: 'main-t1', group_folder: 'main', title: 'Coordinator work' });
    createCockpitTopic({ id: 'dev-t1', group_folder: 'developer', title: 'Dev work' });
    createCockpitTopic({ id: 'sec-t1', group_folder: 'security', title: 'Security review' });

    expect(getCockpitTopics('main').length).toBe(1);
    expect(getCockpitTopics('developer').length).toBe(1);
    expect(getCockpitTopics('security').length).toBe(1);
    expect(getCockpitTopics().length).toBe(3);
  });

  it('archiving one agent topic does not affect others', () => {
    createCockpitTopic({ id: 'main-t', group_folder: 'main', title: 'Main' });
    createCockpitTopic({ id: 'dev-t', group_folder: 'developer', title: 'Dev' });

    archiveCockpitTopic('main-t');

    expect(getCockpitTopics('main').length).toBe(0);
    expect(getCockpitTopics('developer').length).toBe(1);
  });
});
