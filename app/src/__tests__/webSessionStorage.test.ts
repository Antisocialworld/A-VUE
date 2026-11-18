import { afterEach, describe, expect, it, vi } from 'vitest';
import { STRINGS } from '../constants/strings';
import { SESSION_TOKEN_KEY } from '../lib/sessionTokenKey';
import {
  getWebSessionToken,
  removeWebSessionToken,
  SESSION_TOKEN_EXPIRY_KEY,
  setWebSessionToken,
} from '../lib/webSessionStorage';

function installMemoryLocalStorage() {
  const store: Record<string, string> = {};
  const storage = {
    getItem: vi.fn((key: string) => (key in store ? store[key] : null)),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
  } as unknown as Storage;
  vi.stubGlobal('localStorage', storage);
  return { storage, store };
}

describe('A VUE web session storage adapter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('sets, gets and removes a token and its 30-day expiry from localStorage', async () => {
    const now = Date.parse('2026-01-01T00:00:00.000Z');
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const { storage, store } = installMemoryLocalStorage();

    await setWebSessionToken('test-token');

    expect(storage.setItem).toHaveBeenCalledWith(SESSION_TOKEN_KEY, 'test-token');
    expect(store[SESSION_TOKEN_EXPIRY_KEY]).toBe(String(now + 30 * 24 * 60 * 60 * 1000));
    expect(await getWebSessionToken()).toBe('test-token');

    await removeWebSessionToken();
    expect(storage.removeItem).toHaveBeenCalledWith(SESSION_TOKEN_KEY);
    expect(storage.removeItem).toHaveBeenCalledWith(SESSION_TOKEN_EXPIRY_KEY);
    expect(await getWebSessionToken()).toBeNull();
  });

  it('never touches sessionStorage', async () => {
    const { storage } = installMemoryLocalStorage();
    const sessionStorage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    } as unknown as Storage;
    vi.stubGlobal('sessionStorage', sessionStorage);

    await setWebSessionToken('test-token');
    await getWebSessionToken();
    await removeWebSessionToken();

    expect(sessionStorage.getItem).not.toHaveBeenCalled();
    expect(sessionStorage.setItem).not.toHaveBeenCalled();
    expect(sessionStorage.removeItem).not.toHaveBeenCalled();
    expect(storage.setItem).toHaveBeenCalledTimes(2);
    expect(storage.getItem).toHaveBeenCalledTimes(2);
    expect(storage.removeItem).toHaveBeenCalledTimes(2);
  });

  it('clears an expired token and returns nothing', async () => {
    const { storage, store } = installMemoryLocalStorage();

    await setWebSessionToken('test-token');
    store[SESSION_TOKEN_EXPIRY_KEY] = String(Date.now() - 1);

    expect(await getWebSessionToken()).toBeNull();
    expect(store[SESSION_TOKEN_KEY]).toBeUndefined();
    expect(store[SESSION_TOKEN_EXPIRY_KEY]).toBeUndefined();
    expect(storage.removeItem).toHaveBeenCalledWith(SESSION_TOKEN_KEY);
    expect(storage.removeItem).toHaveBeenCalledWith(SESSION_TOKEN_EXPIRY_KEY);
  });

  it('clears a token with a missing or invalid expiry', async () => {
    const { store } = installMemoryLocalStorage();

    store[SESSION_TOKEN_KEY] = 'test-token';
    expect(await getWebSessionToken()).toBeNull();
    expect(store[SESSION_TOKEN_KEY]).toBeUndefined();

    store[SESSION_TOKEN_KEY] = 'test-token';
    store[SESSION_TOKEN_EXPIRY_KEY] = 'not-a-number';
    expect(await getWebSessionToken()).toBeNull();
    expect(store[SESSION_TOKEN_KEY]).toBeUndefined();
    expect(store[SESSION_TOKEN_EXPIRY_KEY]).toBeUndefined();
  });

  it('throws the friendly generic error when localStorage is unavailable', async () => {
    vi.stubGlobal('localStorage', undefined);

    await expect(setWebSessionToken('test-token')).rejects.toThrow(STRINGS.common.error);
    await expect(getWebSessionToken()).rejects.toThrow(STRINGS.common.error);
    await expect(removeWebSessionToken()).rejects.toThrow(STRINGS.common.error);
  });

  it('throws the friendly generic error when storage methods throw', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage);

    await expect(setWebSessionToken('test-token')).rejects.toThrow(STRINGS.common.error);
    await expect(getWebSessionToken()).rejects.toThrow(STRINGS.common.error);
    await expect(removeWebSessionToken()).rejects.toThrow(STRINGS.common.error);
  });
});
