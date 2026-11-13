import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authClient } from '../api/authClient';
import { deleteSessionToken, getSessionToken, saveSessionToken } from '../lib/secureStore';

describe('A VUE HTTP AuthClient & Secure Storage (Rule 02 & Task 3)', () => {
  const testEmail = 'tester@avue.app';
  const testPassword = 'Password2026!';

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.EXPO_PUBLIC_API_URL = 'http://127.0.0.1:3000';
  });

  afterEach(async () => {
    await deleteSessionToken();
  });

  it('throws a clear developer error if EXPO_PUBLIC_API_URL is missing (Task 3)', async () => {
    delete process.env.EXPO_PUBLIC_API_URL;
    await expect(authClient.signIn({ email: 'a@b.com', password: 'Password123!' })).rejects.toThrow(
      /EXPO_PUBLIC_API_URL environment variable is missing/,
    );
  });

  it('refuses plain HTTP in production and returns friendly generic error string to user (Task 3)', async () => {
    process.env.EXPO_PUBLIC_API_URL = 'http://api.avue.app';
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    (globalThis as any).__DEV__ = false;

    try {
      await expect(authClient.signIn({ email: 'a@b.com', password: 'Password123!' })).rejects.toThrow(
        'Something went wrong. Please try again.',
      );
    } finally {
      process.env.NODE_ENV = originalEnv;
      (globalThis as any).__DEV__ = true;
    }
  });

  it('missing EXPO_PUBLIC_API_URL in production returns friendly generic error string (Task 3)', async () => {
    delete process.env.EXPO_PUBLIC_API_URL;
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    (globalThis as any).__DEV__ = false;

    try {
      await expect(authClient.signIn({ email: 'a@b.com', password: 'Password123!' })).rejects.toThrow(
        'Something went wrong. Please try again.',
      );
    } finally {
      process.env.NODE_ENV = originalEnv;
      (globalThis as any).__DEV__ = true;
    }
  });

  it('network error throws friendly generic error string and never leaks raw server error (Task 3)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('Failed to fetch from raw server socket')),
    );

    await expect(authClient.signIn({ email: 'a@b.com', password: 'Password123!' })).rejects.toThrow(
      'Something went wrong. Please try again.',
    );
  });

  it('signs in with valid credentials and stores session token securely', async () => {
    const mockToken = 'pub_1234567890abcdef.sec_fedcba0987654321';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          token: mockToken,
          user: { id: 'usr_01', email: 'demo@avue.app' },
        }),
      }),
    );

    const session = await authClient.signIn({
      email: 'demo@avue.app',
      password: 'Password123!',
    });

    expect(session.token).toBe(mockToken);
    expect(session.user.email).toBe('demo@avue.app');

    const stored = await getSessionToken();
    expect(stored).toBe(mockToken);
  });

  it('rejects sign in with bad credentials and maps to strings error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid email or password. Please try again.',
          },
        }),
      }),
    );

    await expect(
      authClient.signIn({
        email: 'demo@avue.app',
        password: 'WrongPassword!',
      }),
    ).rejects.toThrow(/Invalid email or password/);
  });

  it('executes sign up -> verify flow and persists token', async () => {
    const mockToken = 'pub_verify123.sec_secret123';
    let callCount = 0;

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) => {
        callCount++;
        if (url.includes('/auth/signup')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ message: 'Code sent', email: testEmail }),
          };
        }
        if (url.includes('/auth/verify-code')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              token: mockToken,
              user: { id: 'usr_02', email: testEmail },
            }),
          };
        }
        throw new Error(`Unexpected url: ${url}`);
      }),
    );

    const signupRes = await authClient.signUp({
      email: testEmail,
      password: testPassword,
    });
    expect(signupRes.requiresVerification).toBe(true);
    expect(signupRes.email).toBe(testEmail);

    const session = await authClient.verifySignUpCode({
      email: testEmail,
      code: '123456',
    });
    expect(session.token).toBe(mockToken);
    expect(session.user.email).toBe(testEmail);
    expect(callCount).toBe(2);
  });

  it('explicit 401 clears stored session token', async () => {
    await saveSessionToken('initial_valid_token');
    expect(await getSessionToken()).toBe('initial_valid_token');

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          error: { code: 'INVALID_CREDENTIALS', message: 'Unauthorized' },
        }),
      }),
    );

    await expect(
      authClient.signIn({
        email: 'test@avue.app',
        password: 'WrongPassword1!',
      }),
    ).rejects.toThrow();

    // Verify token was deleted
    expect(await getSessionToken()).toBeNull();
  });

  it('network error or server 500 does NOT clear stored session token', async () => {
    const keepToken = 'preserve_this_token';
    await saveSessionToken(keepToken);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('Network request failed')),
    );

    // Call fails due to network
    await expect(authClient.me()).resolves.toBeNull();

    // Stored token is NOT cleared on network error (Rule 02)
    expect(await getSessionToken()).toBe(keepToken);
  });

  it('maps cooldown response to formatted cooldown string from strings file (Task 2b)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({
          error: {
            code: 'COOLDOWN_ACTIVE',
            message: 'Please wait 45 seconds before resending code.',
          },
        }),
      }),
    );

    await expect(authClient.resendSignUpCode('user@avue.app')).rejects.toThrow(
      /Resend code in 45s/,
    );
  });

  it('request timeout shows generic error string and does not clear stored session token (Task 4)', async () => {
    vi.useFakeTimers();
    try {
      const keepToken = 'preserve_token_on_timeout';
      await saveSessionToken(keepToken);

      // Mock fetch to simulate AbortController signal trigger on 10s timeout
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((_url, options) => {
          return new Promise((_, reject) => {
            if (options?.signal) {
              options.signal.addEventListener('abort', () => {
                reject(new Error('The operation was aborted'));
              });
            }
          });
        }),
      );

      const requestPromise = authClient.signIn({
        email: 'timeout@avue.app',
        password: 'Password123!',
      });

      // Attach rejects assertion first to prevent unhandled rejection during timer advance
      const expectationPromise = expect(requestPromise).rejects.toThrow(
        'Something went wrong. Please try again.',
      );

      // Advance timers asynchronously to flush pending microtasks and advance the 10s timeout timer
      await vi.advanceTimersByTimeAsync(10000);

      // Await expectation fulfillment
      await expectationPromise;

      // Timeout does not clear stored session token (Rule 02)
      expect(await getSessionToken()).toBe(keepToken);
    } finally {
      vi.useRealTimers();
    }
  });
});
