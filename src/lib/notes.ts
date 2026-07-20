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
import type { SerializedEditorState } from 'lexical';
import { db } from '@/lib/firebase';

export type Note = {
  id: string;
  ownerId: string;
  folderId: string | null; // null = unfiled; see CONTEXT.md
  title: string;
  content: SerializedEditorState;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  deletedAt: Timestamp | null;
};

export function notesRef(uid: string) {
  return collection(db, 'users', uid, 'notes') as CollectionReference<Note>;
}

export async function createNote(
  uid: string,
  input: { title?: string; content: SerializedEditorState; folderId?: string | null },
): Promise<Note> {
  const ref = doc(notesRef(uid));
  const now = Timestamp.now();
  const note: Note = {
    id: ref.id,
    ownerId: uid,
    folderId: input.folderId ?? null,
    title: input.title ?? '',
    content: input.content,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  await setDoc(ref, note);
  return note;
}

export function updateNote(
  uid: string,
  noteId: string,
  patch: Partial<Pick<Note, 'title' | 'content' | 'folderId'>>,
): Promise<void> {
  return updateDoc(doc(notesRef(uid), noteId), { ...patch, updatedAt: Timestamp.now() });
}

// Tombstone, never deleteDoc — see CONTEXT.md. Writes only deletedAt so it
// merges with a concurrent, unrelated edit instead of racing it.
export function deleteNote(uid: string, noteId: string): Promise<void> {
  return updateDoc(doc(notesRef(uid), noteId), { deletedAt: serverTimestamp() });
}

type NotesState = { notes: Note[]; loading: boolean; error: Error | null };

// folderId omitted -> all live notes; null -> unfiled only; a string -> that folder's notes.
export function useNotes(uid: string | null, folderId?: string | null): NotesState {
  const q = uid
    ? folderId === undefined
      ? query(notesRef(uid), where('deletedAt', '==', null), orderBy('updatedAt', 'desc'))
      : query(
          notesRef(uid),
          where('folderId', '==', folderId),
          where('deletedAt', '==', null),
          orderBy('updatedAt', 'desc'),
        )
    : null;

  const [state, setState] = useState<NotesState>({ notes: [], loading: q != null, error: null });

  useEffect(() => {
    if (!q) {
      return;
    }
    return onSnapshot(
      q,
      (snapshot) => setState({ notes: snapshot.docs.map((d) => d.data()), loading: false, error: null }),
      (error) => setState({ notes: [], loading: false, error }),
    );
  }, [q]);

  return q ? state : { notes: [], loading: false, error: null };
}
