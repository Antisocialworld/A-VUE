import React, { useEffect } from 'react';

export interface FocusableTarget {
  focus: () => void;
}

type GlobalWithIdleCallback = typeof globalThis & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

/**
 * A VUE useAutoFocus Hook
 * Rule: Focuses a target input ref after screen transition finishes.
 * Modern React Native 0.88+: InteractionManager removed from core.
 * Uses requestIdleCallback with short timeout option (250ms),
 * with a requestAnimationFrame + setTimeout fallback when unavailable.
 * Cancels cleanly on unmount and when enabled/trigger changes.
 */
export function useAutoFocus(
  ref: React.RefObject<FocusableTarget | null> | { current: FocusableTarget | null },
  enabled: boolean = false,
  extraTrigger?: unknown,
): void {
  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let idleId: number | null = null;
    let rafId: number | null = null;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const doFocus = () => {
      if (!cancelled && ref.current && typeof ref.current.focus === 'function') {
        ref.current.focus();
      }
    };

    const g = globalThis as GlobalWithIdleCallback;
    if (typeof g.requestIdleCallback === 'function') {
      idleId = g.requestIdleCallback(doFocus, { timeout: 250 });
    } else {
      rafId = requestAnimationFrame(() => {
        timerId = setTimeout(doFocus, 100);
      });
    }

    return () => {
      cancelled = true;
      if (idleId !== null && typeof g.cancelIdleCallback === 'function') {
        g.cancelIdleCallback(idleId);
      }
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      if (timerId !== null) {
        clearTimeout(timerId);
      }
    };
  }, [enabled, extraTrigger]);
}

