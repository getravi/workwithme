import { useCallback, useEffect, useRef } from "react";

/**
 * Debounce a save callback and guarantee the last pending value is flushed on
 * unmount, so edits made just before a window closes are never dropped.
 *
 * Returns a `schedule(value)` function: each call restarts the timer with the
 * latest value; when the timer fires (or the component unmounts with a value
 * still pending) `save(value)` runs exactly once for that value.
 */
export function useDebouncedSave<T>(
  save: (value: T) => void | Promise<void>,
  delayMs: number,
): (value: T) => void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<{ value: T } | null>(null);
  // Keep the latest save closure without resetting the debounce timer.
  const saveRef = useRef(save);
  saveRef.current = save;

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (pendingRef.current) {
      const { value } = pendingRef.current;
      pendingRef.current = null;
      void saveRef.current(value);
    }
  }, []);

  const schedule = useCallback((value: T) => {
    pendingRef.current = { value };
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      pendingRef.current = null;
      void saveRef.current(value);
    }, delayMs);
  }, [delayMs]);

  useEffect(() => flush, [flush]);

  return schedule;
}
