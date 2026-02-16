import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { emitOpsEvent } from './ops-events.js';
import {
  startAlertHooks,
  _resetAlertState,
  _setSendFn,
  _restoreSendFn,
  ALERT_WORKER_OFFLINE_GRACE_MS,
  ALERT_DISPATCH_FAIL_THRESHOLD,
} from './ops-alerts.js';

describe('ops-alerts', () => {
  const mockSend = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    _resetAlertState();
    mockSend.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    _restoreSendFn();
  });

  it('does not register listener when Telegram config is missing', () => {
    delete process.env.ALERT_TELEGRAM_BOT_TOKEN;
    delete process.env.ALERT_TELEGRAM_CHAT_ID;
    _setSendFn(mockSend);
    startAlertHooks();

    emitOpsEvent('breaker:state', { provider: 'github', state: 'OPEN' });
    expect(mockSend).not.toHaveBeenCalled();
  });

  describe('with Telegram config', () => {
    beforeEach(() => {
      process.env.ALERT_TELEGRAM_BOT_TOKEN = 'test-bot-token';
      process.env.ALERT_TELEGRAM_CHAT_ID = '-100123';
      _setSendFn(mockSend);
      startAlertHooks();
    });

    afterEach(() => {
      delete process.env.ALERT_TELEGRAM_BOT_TOKEN;
      delete process.env.ALERT_TELEGRAM_CHAT_ID;
    });

    it('alerts on worker offline after grace period', () => {
      emitOpsEvent('worker:status', { workerId: 'w1', status: 'offline', reason: 'tunnel_exited' });

      // Before grace period — no alert
      vi.advanceTimersByTime(ALERT_WORKER_OFFLINE_GRACE_MS - 1000);
      expect(mockSend).not.toHaveBeenCalled();

      // After grace period — alert fires
      vi.advanceTimersByTime(2000);
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockSend.mock.calls[0][0]).toContain('w1');
      expect(mockSend.mock.calls[0][0]).toContain('offline');
    });

    it('cancels alert when worker comes back online', () => {
      emitOpsEvent('worker:status', { workerId: 'w1', status: 'offline' });
      vi.advanceTimersByTime(ALERT_WORKER_OFFLINE_GRACE_MS / 2);

      emitOpsEvent('worker:status', { workerId: 'w1', status: 'online' });

      vi.advanceTimersByTime(ALERT_WORKER_OFFLINE_GRACE_MS);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('does not alert on dispatch failures below threshold', () => {
      for (let i = 0; i < ALERT_DISPATCH_FAIL_THRESHOLD - 1; i++) {
        emitOpsEvent('dispatch:lifecycle', { taskId: `t${i}`, status: 'FAILED', reason: 'error' });
      }
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('alerts when dispatch failures exceed threshold', () => {
      for (let i = 0; i < ALERT_DISPATCH_FAIL_THRESHOLD; i++) {
        emitOpsEvent('dispatch:lifecycle', { taskId: `t${i}`, status: 'FAILED', reason: 'error' });
      }
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockSend.mock.calls[0][0]).toContain('dispatch failures');
    });

    it('alerts immediately on breaker OPEN', () => {
      emitOpsEvent('breaker:state', { provider: 'github', state: 'OPEN', group: 'developer' });
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockSend.mock.calls[0][0]).toContain('Circuit breaker OPEN');
      expect(mockSend.mock.calls[0][0]).toContain('github');
    });

    it('deduplicates repeat alerts within window', () => {
      emitOpsEvent('breaker:state', { provider: 'github', state: 'OPEN' });
      emitOpsEvent('breaker:state', { provider: 'github', state: 'OPEN' });
      emitOpsEvent('breaker:state', { provider: 'github', state: 'OPEN' });
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('does not alert on non-FAILED dispatch events', () => {
      emitOpsEvent('dispatch:lifecycle', { taskId: 't1', status: 'STARTED' });
      emitOpsEvent('dispatch:lifecycle', { taskId: 't2', status: 'DONE' });
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('alert payload does not contain secrets', () => {
      emitOpsEvent('breaker:state', {
        provider: 'github',
        state: 'OPEN',
        shared_secret: 'should-be-stripped',
        GITHUB_TOKEN: 'ghp_123',
      });
      expect(mockSend).toHaveBeenCalledTimes(1);
      const text = mockSend.mock.calls[0][0];
      expect(text).not.toContain('should-be-stripped');
      expect(text).not.toContain('ghp_123');
    });
  });
});
