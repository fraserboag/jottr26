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
  folderId: string | null; // null = unfiled
  title: string;
  content: SerializedEditorState;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  deletedAt: Timestamp | null;
};

export function notesRef(uid: string) {
  return collection(db, 'users', uid, 'notes') as CollectionReference<Note>;
}

// A single empty paragraph — what a fresh LexicalComposer initializes to.
// Captured as a literal (verified against the installed lexical version) so
// a new note can be created before the editor for it has ever mounted. Cast
// rather than annotated: SerializedEditorState's default type parameter
// erases node-specific fields like ParagraphNode's `textFormat`/`textStyle`
// down to the generic SerializedLexicalNode shape, so a direct annotation
// trips TS's excess-property check on fields that do belong here.
export const EMPTY_NOTE_CONTENT = {
  root: {
    children: [
      {
        children: [],
        direction: null,
        format: '',
        indent: 0,
        type: 'paragraph',
        version: 1,
        textFormat: 0,
        textStyle: '',
      },
    ],
    direction: null,
    format: '',
    indent: 0,
    type: 'root',
    version: 1,
  },
} as unknown as SerializedEditorState;

type LooseNode = { text?: string; children?: LooseNode[] };

function collectText(node: LooseNode): string {
  if (typeof node.text === 'string') {
    return node.text;
  }
  return (node.children ?? []).map(collectText).join('');
}

// One line of plain text per top-level block (paragraph, heading, list item,
// ...), joined with newlines. Lossy on purpose: bold/italic/block-type marks
// aren't representable as plain text, so round-tripping through a plain
// <textarea> discards them. Fine for a placeholder editor; not fine once the
// rich text editor is back — that must read/write `content` directly instead.
export function noteTextFromContent(content: SerializedEditorState): string {
  const root = content.root as unknown as LooseNode;
  return (root.children ?? []).map(collectText).join('\n');
}

// Inverse of noteTextFromContent: one paragraph per line, each holding a
// single unformatted text run. See EMPTY_NOTE_CONTENT for why the cast.
export function noteContentFromText(text: string): SerializedEditorState {
  if (text === '') {
    return EMPTY_NOTE_CONTENT;
  }
  return {
    root: {
      children: text.split('\n').map((line) => ({
        children: line
          ? [
              {
                detail: 0,
                format: 0,
                mode: 'normal',
                style: '',
                text: line,
                type: 'text',
                version: 1,
              },
            ]
          : [],
        direction: null,
        format: '',
        indent: 0,
        type: 'paragraph',
        version: 1,
        textFormat: 0,
        textStyle: '',
      })),
      direction: null,
      format: '',
      indent: 0,
      type: 'root',
      version: 1,
    },
  } as unknown as SerializedEditorState;
}

// Synchronous, not async: id and content are already known client-side, and
// setDoc's promise doesn't resolve until the backend round-trips — awaiting
// it here would make "create a note" hang until connectivity returns while
// offline, which breaks the offline-first requirement. The write itself
// still happens; callers just don't wait on it, same as updateNote/deleteNote below.
export function createNote(
  uid: string,
  input: {
    title?: string;
    content?: SerializedEditorState;
    folderId?: string | null;
  },
): Note {
  const ref = doc(notesRef(uid));
  const now = Timestamp.now();
  const note: Note = {
    id: ref.id,
    ownerId: uid,
    folderId: input.folderId ?? null,
    title: input.title ?? '',
    content: input.content ?? EMPTY_NOTE_CONTENT,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  void setDoc(ref, note);
  return note;
}

export function updateNote(
  uid: string,
  noteId: string,
  patch: Partial<Pick<Note, 'title' | 'content' | 'folderId'>>,
): Promise<void> {
  return updateDoc(doc(notesRef(uid), noteId), {
    ...patch,
    updatedAt: Timestamp.now(),
  });
}

// Tombstone, never deleteDoc. Writes only deletedAt so it merges with a concurrent,
// unrelated edit instead of racing it.
export function deleteNote(uid: string, noteId: string): Promise<void> {
  return updateDoc(doc(notesRef(uid), noteId), {
    deletedAt: serverTimestamp(),
  });
}

type NotesState = { notes: Note[]; loading: boolean; error: Error | null };

// folderId omitted -> all live notes; null -> unfiled only; a string -> that folder's notes.
export function useNotes(
  uid: string | null,
  folderId?: string | null,
): NotesState {
  const q = uid
    ? folderId === undefined
      ? query(
          notesRef(uid),
          where('deletedAt', '==', null),
          orderBy('updatedAt', 'desc'),
        )
      : query(
          notesRef(uid),
          where('folderId', '==', folderId),
          where('deletedAt', '==', null),
          orderBy('updatedAt', 'desc'),
        )
    : null;

  const [state, setState] = useState<NotesState>({
    notes: [],
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
          notes: snapshot.docs.map((d) => d.data()),
          loading: false,
          error: null,
        }),
      (error) => setState({ notes: [], loading: false, error }),
    );
  }, [q]);

  return q ? state : { notes: [], loading: false, error: null };
}
