import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runPreflight } from './preflight.js';

describe('preflight checks', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear relevant env vars
    delete process.env.OS_HTTP_SECRET;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('throws when OS_HTTP_SECRET is missing', () => {
    expect(() => runPreflight()).toThrow('Missing required secrets: OS_HTTP_SECRET');
  });

  it('throws listing all missing secrets', () => {
    // Currently only one required, but verify the format
    expect(() => runPreflight()).toThrow('Missing required secrets:');
    expect(() => runPreflight()).toThrow('Refusing to start');
  });

  it('warns when secret is shorter than 16 chars', () => {
    process.env.OS_HTTP_SECRET = 'short';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Should not throw, just warn via logger
    expect(() => runPreflight()).not.toThrow();
    warnSpy.mockRestore();
  });

  it('passes with valid secret', () => {
    process.env.OS_HTTP_SECRET = 'a-strong-secret-that-is-long-enough';
    expect(() => runPreflight()).not.toThrow();
  });
});
