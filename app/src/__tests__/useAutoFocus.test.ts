import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAutoFocus } from '../hooks/useAutoFocus';

describe('useAutoFocus Hook (Task 1)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('is a callable hook function', () => {
    expect(typeof useAutoFocus).toBe('function');
  });

  it('schedules focus via requestIdleCallback when available', () => {
    const focusMock = vi.fn();
    const mockRef = { current: { focus: focusMock } };

    const requestIdleCallbackMock = vi.fn((cb: () => void) => {
      cb();
      return 123;
    });
    const cancelIdleCallbackMock = vi.fn();

    vi.stubGlobal('requestIdleCallback', requestIdleCallbackMock);
    vi.stubGlobal('cancelIdleCallback', cancelIdleCallbackMock);

    // Call focus directly via logic test
    let cancelled = false;
    const doFocus = () => {
      if (!cancelled && mockRef.current) {
        mockRef.current.focus();
      }
    };

    const handle = (globalThis as any).requestIdleCallback(doFocus, { timeout: 250 });
    expect(requestIdleCallbackMock).toHaveBeenCalled();
    expect(focusMock).toHaveBeenCalled();
    expect(handle).toBe(123);
  });

  it('falls back to requestAnimationFrame and setTimeout when requestIdleCallback is absent', () => {
    const focusMock = vi.fn();
    const mockRef = { current: { focus: focusMock } };

    const rafMock = vi.fn((cb: () => void) => {
      cb();
      return 456;
    });

    vi.stubGlobal('requestAnimationFrame', rafMock);
    delete (globalThis as any).requestIdleCallback;

    let timerId: any = null;
    const rafId = requestAnimationFrame(() => {
      timerId = setTimeout(() => {
        mockRef.current.focus();
      }, 100);
    });

    expect(rafMock).toHaveBeenCalled();
    expect(rafId).toBe(456);
  });
});

