import {
  Timestamp,
  getDocs,
  query,
  where,
  type CollectionReference,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { useEffect } from 'react';
import { batchWriter } from '@/lib/batch';
import { foldersRef, type Folder } from '@/lib/folders';
import { notesRef, type Note } from '@/lib/notes';
import { isExpired, reapCutoff } from '@/lib/trash';

// Firestore sorts null before every other type, so a bare `deletedAt < cutoff`
// would match live documents and hard-delete the whole collection. This lower
// bound excludes them: any real tombstone is a timestamp, and every timestamp
// sorts after null.
const NOT_NULL = Timestamp.fromMillis(0);

async function expiredDocs<T extends Note | Folder>(
  ref: CollectionReference<T>,
  cutoff: Timestamp,
): Promise<QueryDocumentSnapshot<T>[]> {
  const snapshot = await getDocs(
    query(
      ref,
      where('deletedAt', '>', NOT_NULL),
      where('deletedAt', '<', cutoff),
    ),
  );
  // Re-checked rather than trusted: the query above is one typo away from
  // selecting live documents, and this is a hard delete.
  return snapshot.docs.filter((d) => isExpired(d.data().deletedAt));
}

// Clears out tombstones past the retention window. This is the client-side
// stand-in for a TTL policy (see src/lib/trash.ts), so it only runs when
// someone opens the app — a user who stops visiting keeps their tombstones.
// Legacy tombstones written before expiresAt existed are swept too, since this
// goes by deletedAt.
async function reapExpired(uid: string): Promise<void> {
  const cutoff = reapCutoff();
  const [notes, folders] = await Promise.all([
    expiredDocs(notesRef(uid), cutoff),
    expiredDocs(foldersRef(uid), cutoff),
  ]);
  if (notes.length === 0 && folders.length === 0) {
    return;
  }

  const batches = batchWriter();
  for (const snapshot of notes) {
    batches.next().delete(snapshot.ref);
  }
  for (const snapshot of folders) {
    batches.next().delete(snapshot.ref);
  }
  await batches.commit();
}

// Once per load, not per mount — the pages that call this remount on every
// navigation between them, and the sweep costs reads.
let sweptUid: string | null = null;

export function useReapExpired(uid: string | null): void {
  useEffect(() => {
    if (!uid || sweptUid === uid) {
      return;
    }
    sweptUid = uid;
    // Best-effort: a rejected batch (stale cache, clock skew at the boundary)
    // leaves the tombstones for the next load rather than surfacing an error
    // for something the user didn't ask for.
    reapExpired(uid).catch((error: unknown) => {
      console.error('Failed to reap expired tombstones:', error);
    });
  }, [uid]);
}
