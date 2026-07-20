import { useCallback, useEffect, useRef } from 'react';

// Debounces onSave until `value` stops changing for delayMs, then calls it
// with the latest value. Call the returned `flush` on blur to save
// immediately instead of waiting; it also runs automatically on unmount so
// navigating away within the debounce window doesn't drop the last edit.
export function useAutosave<T>(value: T, onSave: (value: T) => void | Promise<void>, delayMs = 1000): { flush: () => void } {
  const pendingRef = useRef(value);
  const savedRef = useRef(value);
  const onSaveRef = useRef(onSave);

  useEffect(() => {
    pendingRef.current = value;
    onSaveRef.current = onSave;
  }, [value, onSave]);

  const flush = useCallback(() => {
    if (pendingRef.current === savedRef.current) {
      return;
    }
    savedRef.current = pendingRef.current;
    void onSaveRef.current(pendingRef.current);
  }, []);

  useEffect(() => {
    const timer = setTimeout(flush, delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs, flush]);

  useEffect(() => flush, [flush]);

  return { flush };
}
