import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  deleteSessionToken: vi.fn(async (..._args: unknown[]) => {}),
  getSessionToken: vi.fn(async (..._args: unknown[]) => 'test-session-token'),
  saveSessionToken: vi.fn(async (..._args: unknown[]) => {}),
}));

vi.mock('../lib/secureStore', () => ({
  deleteSessionToken: (...args: unknown[]) => mocks.deleteSessionToken(...args),
  getSessionToken: (...args: unknown[]) => mocks.getSessionToken(...args),
  saveSessionToken: (...args: unknown[]) => mocks.saveSessionToken(...args),
}));

import { cinemaClient } from '../api/cinemaClient';
import { moviesClient } from '../api/moviesClient';
import { assistantClient } from '../api/assistantClient';
import { onSessionExpired } from '../lib/sessionExpired';

function mockFetch(status: number): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => ({}),
      headers: { get: () => null },
    }),
  );
}

const authenticatedCalls: Array<[string, () => Promise<unknown>]> = [
  ['cinemaClient', () => cinemaClient.getUserTickets()],
  ['moviesClient', () => moviesClient.getMovies()],
  ['assistantClient', () => assistantClient.sendChat({ message: 'Hi' })],
];

describe('shared 401 session-expiry handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.EXPO_PUBLIC_API_URL = 'http://127.0.0.1:3000';
    (globalThis as any).__DEV__ = true;
  });

  for (const [name, call] of authenticatedCalls) {
    it(`${name} clears the session once and triggers the app flow on 401`, async () => {
      const listener = vi.fn();
      const unsubscribe = onSessionExpired(listener);
      mockFetch(401);

      await expect(call()).rejects.toBeDefined();

      expect(mocks.deleteSessionToken).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledTimes(1);
      unsubscribe();
    });

    it(`${name} does not clear the session or trigger the flow on a non-401 error`, async () => {
      const listener = vi.fn();
      const unsubscribe = onSessionExpired(listener);
      mockFetch(500);

      await expect(call()).rejects.toBeDefined();

      expect(mocks.deleteSessionToken).not.toHaveBeenCalled();
      expect(listener).not.toHaveBeenCalled();
      unsubscribe();
    });
  }

  it('uses one shared helper in all three clients, with no copied storage logic', () => {
    const root = path.resolve(__dirname, '..');
    for (const file of ['api/cinemaClient.ts', 'api/moviesClient.ts', 'api/assistantClient.ts']) {
      const src = fs.readFileSync(path.join(root, file), 'utf-8');
      expect(src).toContain("from '../lib/sessionExpired'");
      expect(src).toContain('await handleUnauthorized(response.status)');
      expect(src).not.toContain('deleteSessionToken');
    }
  });

  it('wires the shared notifier into the existing App session-expired flow', () => {
    const appSrc = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf-8');
    expect(appSrc).toContain("from './src/lib/sessionExpired'");
    expect(appSrc).toContain('onSessionExpired(() => handleAssistantSessionExpired())');
    expect(appSrc).toContain("setCurrentRoute('sign_in')");
  });

  it('leaves authClient 401 handling unchanged and does not subscribe it to the notifier', () => {
    const authSrc = fs.readFileSync(path.resolve(__dirname, '../api/authClient.ts'), 'utf-8');
    expect(authSrc).toContain('await deleteSessionToken()');
    expect(authSrc).not.toContain('sessionExpired');
    expect(authSrc).not.toContain('handleUnauthorized');
  });
});
