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
import { batchWriter } from '@/lib/batch';
import { db } from '@/lib/firebase';
import { notesRef, type Note } from '@/lib/notes';
import { trashExpiresAt } from '@/lib/trash';

// Folders nest via parentId (null = root-level). Deleting a folder tombstones
// it and cascades to its whole subtree — descendant folders and their notes.
export type Folder = {
  id: string;
  ownerId: string;
  parentId: string | null;
  name: string;
  // Fractional-index key for manual ordering among its siblings (the folders
  // and notes sharing its parentId). Optional only for folders written before
  // ordering existed; new folders always set it. See src/lib/ordering.ts.
  order?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  deletedAt: Timestamp | null;
  // Id of the folder whose deletion cascaded this tombstone; null when the
  // user deleted this document itself. Restoring folder F revives F plus
  // everything carrying deletedWith === F.id, so a child deleted on its own
  // before F (deletedWith null) correctly stays deleted. Optional only for
  // documents written before cascading deletes existed.
  deletedWith?: string | null;
  // When the Firestore TTL policy may reap this tombstone; null while live.
  // Optional only for documents written before the policy existed — those are
  // reaped by nothing, so their deletedAt is what the trash view goes by.
  expiresAt?: Timestamp | null;
};

export function foldersRef(uid: string) {
  return collection(db, 'users', uid, 'folders') as CollectionReference<Folder>;
}

export async function createFolder(
  uid: string,
  name: string,
  parentId: string | null,
  order: string,
): Promise<Folder> {
  const ref = doc(foldersRef(uid));
  const now = Timestamp.now();
  const folder: Folder = {
    id: ref.id,
    ownerId: uid,
    parentId,
    name,
    order,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedWith: null,
    expiresAt: null,
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

// Reposition a folder: change its parent and/or its order key among siblings.
// Deliberately does NOT bump updatedAt (see moveNote). Call wouldCreateCycle
// first when parentId changes — rules only reject the direct self-parent case.
// Compute `order` from the destination level's siblings with src/lib/ordering.ts.
export function moveFolder(
  uid: string,
  folderId: string,
  dest: { parentId: string | null; order: string },
): Promise<void> {
  return updateDoc(doc(foldersRef(uid), folderId), dest);
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

// Every folder in folderId's subtree, itself included. Reads an already-loaded
// live folder list (as wouldCreateCycle does), so it costs no extra reads. The
// visited check also stops a corrupt parentId cycle from spinning forever.
export function getFolderSubtreeIds(
  folders: Folder[],
  folderId: string,
): Set<string> {
  const childrenByParent = new Map<string, Folder[]>();
  for (const folder of folders) {
    if (folder.parentId === null) {
      continue;
    }
    const siblings = childrenByParent.get(folder.parentId);
    if (siblings) {
      siblings.push(folder);
    } else {
      childrenByParent.set(folder.parentId, [folder]);
    }
  }

  const subtree = new Set<string>();
  const pending = [folderId];
  while (pending.length > 0) {
    const current = pending.pop() as string;
    if (subtree.has(current)) {
      continue;
    }
    subtree.add(current);
    for (const child of childrenByParent.get(current) ?? []) {
      pending.push(child.id);
    }
  }
  return subtree;
}

// Tombstone, never deleteDoc. Writes only the tombstone fields so a delete
// merges with a concurrent, unrelated rename instead of racing it.
//
// Deletion cascades: every descendant folder and every note anywhere in the
// subtree is tombstoned too, tagged with deletedWith so restoring this folder
// can revive exactly the set that went down with it. Nothing is reparented, so
// the subtree reassembles unchanged. Pass the live folders and notes already
// loaded by useFolders/useNotes.
//
// The returned promise resolves on backend acknowledgement; callers that must
// stay responsive offline should not await it. The batches are committed
// together rather than in sequence for the same reason.
export async function deleteFolder(
  uid: string,
  folderId: string,
  tree: { folders: Folder[]; notes: Note[] },
): Promise<void> {
  const subtree = getFolderSubtreeIds(tree.folders, folderId);
  const expiresAt = trashExpiresAt();
  const batches = batchWriter();

  // deletedWith null: this is the folder the user actually deleted.
  batches.next().update(doc(foldersRef(uid), folderId), {
    deletedAt: serverTimestamp(),
    deletedWith: null,
    expiresAt,
  });
  for (const descendantId of subtree) {
    if (descendantId !== folderId) {
      batches.next().update(doc(foldersRef(uid), descendantId), {
        deletedAt: serverTimestamp(),
        deletedWith: folderId,
        expiresAt,
      });
    }
  }
  for (const note of tree.notes) {
    if (note.folderId !== null && subtree.has(note.folderId)) {
      batches.next().update(doc(notesRef(uid), note.id), {
        deletedAt: serverTimestamp(),
        deletedWith: folderId,
        expiresAt,
      });
    }
  }

  await batches.commit();
}

const REVIVED = { deletedAt: null, deletedWith: null, expiresAt: null };

// Every document tombstoned by folderId's deletion: its descendant folders and
// their notes, tagged with deletedWith when the cascade took them down.
export function getCascadedIds(
  folderId: string,
  trash: { folders: Folder[]; notes: Note[] },
): { folderIds: string[]; noteIds: string[] } {
  return {
    folderIds: trash.folders
      .filter((folder) => folder.deletedWith === folderId)
      .map((folder) => folder.id),
    noteIds: trash.notes
      .filter((note) => note.deletedWith === folderId)
      .map((note) => note.id),
  };
}

// Undoes deleteFolder: revives the folder plus exactly what went down with it.
// A descendant the user had deleted on its own beforehand carries deletedWith
// null, so it stays in the trash as its own restorable entry. Nothing is
// reparented, so the subtree reassembles unchanged — but a folder whose own
// parent is still tombstoned comes back at the top level, which NoteTree
// already renders that way. Pass the tombstones loaded by
// useTrashedFolders/useTrashedNotes.
export async function restoreFolder(
  uid: string,
  folderId: string,
  trash: { folders: Folder[]; notes: Note[] },
): Promise<void> {
  const cascaded = getCascadedIds(folderId, trash);
  const batches = batchWriter();

  batches.next().update(doc(foldersRef(uid), folderId), REVIVED);
  for (const descendantId of cascaded.folderIds) {
    batches.next().update(doc(foldersRef(uid), descendantId), REVIVED);
  }
  for (const noteId of cascaded.noteIds) {
    batches.next().update(doc(notesRef(uid), noteId), REVIVED);
  }

  await batches.commit();
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

// Every tombstoned folder, most recently deleted first — including the ones a
// parent's deletion cascaded, which restoreFolder needs even though the trash
// view doesn't list them separately.
export function useTrashedFolders(uid: string | null): FoldersState {
  const q = uid
    ? query(
        foldersRef(uid),
        where('deletedAt', '!=', null),
        orderBy('deletedAt', 'desc'),
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
