import { useCallback, useEffect, useRef, useState } from 'react';

export type SaveStatus = 'synced' | 'pending' | 'saving' | 'error';

type AutosaveOptions<T> = {
  delayMs?: number;
  cooldownMs?: number;
  isEqual?: (a: T, b: T) => boolean;
};

// Debounces onSave until `value` stops changing for delayMs, then calls it with
// the latest value, subject to a cooldown that caps how often writes go out —
// see the autosave policy in the README. Call the returned `flush` on blur to
// save immediately; it also runs on unmount and when the page is hidden, so
// navigating away or backgrounding the app doesn't drop the last edit.
// Explicit flushes ignore the cooldown: durability beats the write ceiling.
// `status` tracks the round-trip: pending while waiting, saving while the write
// is in flight, synced once it lands, error if it rejects. A rejected write is
// not retried — with Firestore's offline persistence a write queues rather than
// rejecting, so a rejection means something a retry wouldn't fix.
export function useAutosave<T>(
  value: T,
  onSave: (value: T) => void | Promise<void>,
  options: AutosaveOptions<T> = {},
): { flush: () => void; status: SaveStatus } {
  const { delayMs = 1000, cooldownMs = 5000, isEqual = Object.is } = options;
  const pendingRef = useRef(value);
  const savedRef = useRef(value);
  const onSaveRef = useRef(onSave);
  const isEqualRef = useRef(isEqual);
  // Set when the write starts, never when it resolves: offline, a write's
  // promise doesn't settle until connectivity returns, which would stall the
  // cooldown — and every later write with it — for the whole outage.
  const lastWriteAtRef = useRef(0);
  const [status, setStatus] = useState<SaveStatus>('synced');

  useEffect(() => {
    pendingRef.current = value;
    onSaveRef.current = onSave;
    isEqualRef.current = isEqual;
    if (!isEqual(value, savedRef.current)) {
      setStatus('pending');
    }
  }, [value, onSave, isEqual]);

  const write = useCallback(() => {
    savedRef.current = pendingRef.current;
    lastWriteAtRef.current = Date.now();
    setStatus('saving');
    void Promise.resolve(onSaveRef.current(savedRef.current)).then(
      // Skip synced if a newer edit came in while this was in flight — its own
      // write is already driving status and will land it.
      () => setStatus((prev) => (prev === 'saving' ? 'synced' : prev)),
      () => setStatus('error'),
    );
  }, []);

  const flush = useCallback(() => {
    if (isEqualRef.current(pendingRef.current, savedRef.current)) {
      return;
    }
    write();
  }, [write]);

  useEffect(() => {
    if (isEqualRef.current(value, savedRef.current)) {
      return;
    }
    // Re-armed on every change, so continuous typing writes nothing until it
    // stops — then waits out whatever cooldown the last write still has left.
    const elapsed = Date.now() - lastWriteAtRef.current;
    const timer = setTimeout(write, Math.max(delayMs, cooldownMs - elapsed));
    return () => clearTimeout(timer);
  }, [value, delayMs, cooldownMs, write]);

  // pagehide and visibilitychange both, not either: visibilitychange is what
  // fires when iOS backgrounds the PWA, pagehide covers bfcache paths it
  // misses. beforeunload is unreliable on iOS and unload never fires there.
  useEffect(() => {
    const flushIfHidden = () => {
      if (document.visibilityState === 'hidden') {
        flush();
      }
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flushIfHidden);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flushIfHidden);
      flush();
    };
  }, [flush]);

  return { flush, status };
}
