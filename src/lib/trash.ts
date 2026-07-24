import { Timestamp } from 'firebase/firestore';

// How long a tombstone stays restorable. Three places have to agree on this:
// the expiresAt written here, the Firestore TTL policy that reaps it (the
// fieldOverrides in firestore.indexes.json), and isExpiredTombstone in
// firestore.rules.
export const TRASH_RETENTION_DAYS = 7;

const RETENTION_MS = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;

// Written on every tombstone, but nothing reads it yet: configuring the TTL
// policy calls the Firestore Admin API's field endpoint, which 403s on a
// project without billing, so src/lib/reap.ts sweeps on the client instead.
// Keeping the field current means switching to TTL later is just a
// fieldOverrides entry ({ collectionGroup, fieldPath: 'expiresAt', ttl: true })
// in firestore.indexes.json and a deploy — no backfill.
//
// Unlike deletedAt it can't be a serverTimestamp: a sentinel is unreadable
// until the write lands, and TTL needs a real value. Computed from the local
// clock instead, which is why the rules only require it to be within a day of
// a full window out.
export function trashExpiresAt(): Timestamp {
  return Timestamp.fromMillis(Date.now() + RETENTION_MS);
}

// The oldest deletedAt a tombstone can have and still be worth keeping.
// isExpiredTombstone in firestore.rules re-checks the window against server
// time and rejects the delete if it disagrees, taking the whole batch down
// with it; the extra hour keeps a client running slightly fast from tripping
// that at the boundary.
export function reapCutoff(): Timestamp {
  return Timestamp.fromMillis(Date.now() - RETENTION_MS - 60 * 60 * 1000);
}

export function reapsAt(deletedAt: Timestamp): Date {
  return new Date(deletedAt.toMillis() + RETENTION_MS);
}

// TTL collection can lag expiry by around a day, so the trash view hides what
// the reaper hasn't got to yet rather than offering a restore on borrowed time.
export function isExpired(deletedAt: Timestamp | null | undefined): boolean {
  return deletedAt != null && Date.now() > deletedAt.toMillis() + RETENTION_MS;
}
