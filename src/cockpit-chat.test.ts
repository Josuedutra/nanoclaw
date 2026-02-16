/**
 * Tests for cockpit chat endpoints:
 * - GET /ops/messages (read message history)
 * - POST /ops/actions/chat (send message from cockpit)
 */
import http from 'http';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { _initTestDatabase, getDb, setRegisteredGroup, storeChatMetadata, storeMessageDirect } from './db.js';
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

// --- Seed helpers ---

function seedMainGroup(): void {
  storeChatMetadata('main-group@g.us', new Date().toISOString(), 'Main Group');
  setRegisteredGroup('main-group@g.us', {
    name: 'Main Group',
    folder: 'main',
    trigger: '!nano',
    added_at: new Date().toISOString(),
  });
}

function seedMessages(): void {
  seedMainGroup();

  storeMessageDirect({
    id: 'msg-1',
    chat_jid: 'main-group@g.us',
    sender: 'user1',
    sender_name: 'Alice',
    content: 'Hello from Alice',
    timestamp: '2026-02-16T10:00:00.000Z',
    is_from_me: false,
    is_bot_message: false,
  });

  storeMessageDirect({
    id: 'msg-2',
    chat_jid: 'main-group@g.us',
    sender: 'bot',
    sender_name: 'NanoClaw',
    content: 'Hello from bot',
    timestamp: '2026-02-16T10:01:00.000Z',
    is_from_me: true,
    is_bot_message: true,
  });

  storeMessageDirect({
    id: 'msg-3',
    chat_jid: 'main-group@g.us',
    sender: 'user2',
    sender_name: 'Bob',
    content: 'Hello from Bob',
    timestamp: '2026-02-16T10:02:00.000Z',
    is_from_me: false,
    is_bot_message: false,
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

// === GET /ops/messages ===

describe('GET /ops/messages', () => {
  it('returns empty when no main group registered', async () => {
    const res = await get('/ops/messages');
    expect(res.status).toBe(200);
    expect(res.body.messages).toEqual([]);
    expect(res.body.group_jid).toBeNull();
  });

  it('returns messages for the main group', async () => {
    seedMessages();
    const res = await get('/ops/messages');
    expect(res.status).toBe(200);
    const messages = res.body.messages as Array<Record<string, unknown>>;
    expect(messages.length).toBe(3);
    expect(res.body.group_jid).toBe('main-group@g.us');
  });

  it('returns messages in chronological order (oldest first)', async () => {
    seedMessages();
    const res = await get('/ops/messages');
    const messages = res.body.messages as Array<{ timestamp: string }>;
    expect(messages[0].timestamp).toBe('2026-02-16T10:00:00.000Z');
    expect(messages[2].timestamp).toBe('2026-02-16T10:02:00.000Z');
  });

  it('includes both user and bot messages', async () => {
    seedMessages();
    const res = await get('/ops/messages');
    const messages = res.body.messages as Array<{ is_bot_message: boolean; sender_name: string }>;
    const bot = messages.find((m) => m.is_bot_message);
    const user = messages.find((m) => !m.is_bot_message);
    expect(bot).toBeDefined();
    expect(user).toBeDefined();
  });

  it('respects limit parameter', async () => {
    seedMessages();
    const res = await get('/ops/messages?limit=2');
    const messages = res.body.messages as Array<Record<string, unknown>>;
    expect(messages.length).toBe(2);
  });

  it('respects before parameter for pagination', async () => {
    seedMessages();
    const res = await get('/ops/messages?before=2026-02-16T10:02:00.000Z');
    const messages = res.body.messages as Array<{ id: string }>;
    expect(messages.length).toBe(2);
    expect(messages.every((m) => m.id !== 'msg-3')).toBe(true);
  });

  it('rejects request without auth (401)', async () => {
    const res = await get('/ops/messages', {});
    expect(res.status).toBe(401);
  });

  it('maps is_bot_message to boolean', async () => {
    seedMessages();
    const res = await get('/ops/messages');
    const messages = res.body.messages as Array<{ is_bot_message: boolean }>;
    for (const m of messages) {
      expect(typeof m.is_bot_message).toBe('boolean');
    }
  });
});

// === POST /ops/actions/chat ===

describe('POST /ops/actions/chat', () => {
  it('stores message in database and returns ok', async () => {
    seedMainGroup();
    const res = await post('/ops/actions/chat', { message: 'Hello from cockpit' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.queued).toBe(true);

    // Verify message was stored
    const db = getDb();
    const row = db.prepare(
      "SELECT * FROM messages WHERE sender = 'cockpit' ORDER BY timestamp DESC LIMIT 1",
    ).get() as Record<string, unknown> | undefined;
    expect(row).toBeDefined();
    expect(row!.content).toBe('Hello from cockpit');
    expect(row!.sender_name).toBe('Owner');
    expect(row!.chat_jid).toBe('main-group@g.us');
  });

  it('rejects empty message (400)', async () => {
    seedMainGroup();
    const res = await post('/ops/actions/chat', { message: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('message');
  });

  it('rejects missing message field (400)', async () => {
    seedMainGroup();
    const res = await post('/ops/actions/chat', {});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('message');
  });

  it('rejects message over 4000 characters (400)', async () => {
    seedMainGroup();
    const res = await post('/ops/actions/chat', { message: 'x'.repeat(4001) });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('4000');
  });

  it('returns 400 when no main group registered', async () => {
    const res = await post('/ops/actions/chat', { message: 'Hello' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('main group');
  });

  it('rejects without write secret (401)', async () => {
    const res = await post(
      '/ops/actions/chat',
      { message: 'Hello' },
      { 'X-OS-SECRET': READ_SECRET, 'Content-Type': 'application/json' },
    );
    expect(res.status).toBe(401);
  });

  it('rejects without any auth (401)', async () => {
    const res = await post(
      '/ops/actions/chat',
      { message: 'Hello' },
      { 'Content-Type': 'application/json' },
    );
    expect(res.status).toBe(401);
  });

  it('stored message is retrievable via GET /ops/messages', async () => {
    seedMainGroup();
    await post('/ops/actions/chat', { message: 'Roundtrip test' });

    const res = await get('/ops/messages');
    expect(res.status).toBe(200);
    const messages = res.body.messages as Array<{ content: string; sender_name: string }>;
    const cockpitMsg = messages.find((m) => m.content === 'Roundtrip test');
    expect(cockpitMsg).toBeDefined();
    expect(cockpitMsg!.sender_name).toBe('Owner');
  });
});
