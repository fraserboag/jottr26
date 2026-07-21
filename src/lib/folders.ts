import {
  Timestamp,
  serverTimestamp,
  collection,
  doc,
  setDoc,
  updateDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  type CollectionReference,
} from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { db } from '@/lib/firebase';

// Folders nest via parentId (null = root-level). Deleting a
// folder tombstones it and does not cascade to its children or its notes.
export type Folder = {
  id: string;
  ownerId: string;
  parentId: string | null;
  name: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  deletedAt: Timestamp | null;
};

export function foldersRef(uid: string) {
  return collection(db, 'users', uid, 'folders') as CollectionReference<Folder>;
}

export async function createFolder(
  uid: string,
  name: string,
  parentId: string | null = null,
): Promise<Folder> {
  const ref = doc(foldersRef(uid));
  const now = Timestamp.now();
  const folder: Folder = {
    id: ref.id,
    ownerId: uid,
    parentId,
    name,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  await setDoc(ref, folder);
  return folder;
}

// Call wouldCreateCycle first if patch.parentId is changing — rules only
// reject the direct self-parent case, not a move under one's own descendant.
export function updateFolder(
  uid: string,
  folderId: string,
  patch: Partial<Pick<Folder, 'name' | 'parentId'>>,
): Promise<void> {
  return updateDoc(doc(foldersRef(uid), folderId), {
    ...patch,
    updatedAt: Timestamp.now(),
  });
}

// True if setting folderId's parent to newParentId would create a cycle —
// either newParentId is folderId itself, or folderId is already an ancestor
// of newParentId. Operates on an already-loaded folder list (e.g. from
// useFolders), so it costs no extra reads.
export function wouldCreateCycle(
  folders: Folder[],
  folderId: string,
  newParentId: string | null,
): boolean {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const visited = new Set<string>();
  let current = newParentId;
  while (current !== null && !visited.has(current)) {
    if (current === folderId) {
      return true;
    }
    visited.add(current);
    current = byId.get(current)?.parentId ?? null;
  }
  return false;
}

// Root -> folder, for breadcrumbs. A parentId that doesn't resolve to a live
// folder (deleted, reaped, or corrupt) stops the walk there rather than
// throwing.
export function getFolderPath(
  folders: Folder[],
  folderId: string | null,
): Folder[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const visited = new Set<string>();
  const path: Folder[] = [];
  let current = folderId;
  while (current !== null && !visited.has(current)) {
    const folder = byId.get(current);
    if (!folder) {
      break;
    }
    path.unshift(folder);
    visited.add(current);
    current = folder.parentId;
  }
  return path;
}

// Tombstone, never deleteDoc. Writes only deletedAt so it
// merges with a concurrent, unrelated rename instead of racing it.
export function deleteFolder(uid: string, folderId: string): Promise<void> {
  return updateDoc(doc(foldersRef(uid), folderId), {
    deletedAt: serverTimestamp(),
  });
}

type FoldersState = {
  folders: Folder[];
  loading: boolean;
  error: Error | null;
};

export function useFolders(uid: string | null): FoldersState {
  const q = uid
    ? query(
        foldersRef(uid),
        where('deletedAt', '==', null),
        orderBy('name', 'asc'),
      )
    : null;

  const [state, setState] = useState<FoldersState>({
    folders: [],
    loading: q != null,
    error: null,
  });

  useEffect(() => {
    if (!q) {
      return;
    }
    return onSnapshot(
      q,
      (snapshot) =>
        setState({
          folders: snapshot.docs.map((d) => d.data()),
          loading: false,
          error: null,
        }),
      (error) => setState({ folders: [], loading: false, error }),
    );
  }, [q]);

  return q ? state : { folders: [], loading: false, error: null };
}
