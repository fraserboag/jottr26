import { useCallback, useEffect, useRef, useState } from 'react';

export type SaveStatus = 'synced' | 'pending' | 'saving' | 'error';

// Debounces onSave until `value` stops changing for delayMs, then calls it
// with the latest value. Call the returned `flush` on blur to save
// immediately instead of waiting; it also runs automatically on unmount so
// navigating away within the debounce window doesn't drop the last edit.
// `status` tracks the round-trip: pending while debouncing, saving while the
// write is in flight, synced once it lands, error if it rejects.
export function useAutosave<T>(value: T, onSave: (value: T) => void | Promise<void>, delayMs = 1000): { flush: () => void; status: SaveStatus } {
  const pendingRef = useRef(value);
  const savedRef = useRef(value);
  const onSaveRef = useRef(onSave);
  const [status, setStatus] = useState<SaveStatus>('synced');

  useEffect(() => {
    pendingRef.current = value;
    onSaveRef.current = onSave;
    if (value !== savedRef.current) {
      setStatus('pending');
    }
  }, [value, onSave]);

  const flush = useCallback(() => {
    if (pendingRef.current === savedRef.current) {
      return;
    }
    savedRef.current = pendingRef.current;
    setStatus('saving');
    void Promise.resolve(onSaveRef.current(savedRef.current)).then(
      // Skip synced if a newer edit came in while this was in flight — its own
      // flush is already driving status and will land it.
      () => setStatus((prev) => (prev === 'saving' ? 'synced' : prev)),
      () => setStatus('error'),
    );
  }, []);

  useEffect(() => {
    const timer = setTimeout(flush, delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs, flush]);

  useEffect(() => flush, [flush]);

  return { flush, status };
}
