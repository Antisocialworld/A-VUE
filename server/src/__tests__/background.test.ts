import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  waitUntil: vi.fn(),
}));

vi.mock('@vercel/functions', () => ({
  waitUntil: (promise: Promise<unknown>) => mocks.waitUntil(promise),
}));

import { runInBackground } from '../lib/background.js';

const ORIGINAL_VERCEL = process.env.VERCEL;

describe('runInBackground', () => {
  beforeEach(() => {
    mocks.waitUntil.mockReset();
  });

  afterEach(() => {
    if (ORIGINAL_VERCEL === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = ORIGINAL_VERCEL;
    vi.restoreAllMocks();
  });

  it('runs locally with setImmediate and does not call waitUntil', async () => {
    delete process.env.VERCEL;
    const task = vi.fn().mockResolvedValue(undefined);

    expect(() => runInBackground('local-label', task)).not.toThrow();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(task).toHaveBeenCalledTimes(1);
    expect(mocks.waitUntil).not.toHaveBeenCalled();
  });

  it('calls waitUntil once with a promise on Vercel', async () => {
    process.env.VERCEL = '1';
    const task = vi.fn().mockResolvedValue(undefined);

    expect(() => runInBackground('vercel-label', task)).not.toThrow();

    expect(mocks.waitUntil).toHaveBeenCalledTimes(1);
    const promise = mocks.waitUntil.mock.calls[0][0];
    expect(promise).toBeInstanceOf(Promise);
    await promise;
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('swallows throwing tasks and logs only the closed-set line', async () => {
    const stderrWrite = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((() => true) as any);
    const expected = '[Background] outcome=error label=error-label\n';

    delete process.env.VERCEL;
    expect(() =>
      runInBackground('error-label', async () => {
        throw new Error('leak-check-token');
      }),
    ).not.toThrow();
    await new Promise<void>((resolve) => setImmediate(resolve));

    process.env.VERCEL = '1';
    expect(() =>
      runInBackground('error-label', async () => {
        throw new Error('leak-check-token');
      }),
    ).not.toThrow();
    await expect(mocks.waitUntil.mock.calls[0][0]).resolves.toBeUndefined();

    expect(stderrWrite).toHaveBeenCalledTimes(2);
    expect(stderrWrite).toHaveBeenCalledWith(expected);
    const output = stderrWrite.mock.calls
      .map((call) => String(call[0]))
      .join('');
    expect(output).not.toContain('leak-check-token');
    expect(output).not.toContain('Error');
  });
});
