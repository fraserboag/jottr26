import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import {
  createNote,
  deleteNote,
  noteContentFromText,
  noteTextFromContent,
  updateNote,
  useNotes,
  type Note,
} from '@/lib/notes';
import { useAutosave } from '@/lib/useAutosave';
import styles from './Notes.module.css';

type Draft = { title: string; text: string };

function draftsEqual(a: Draft, b: Draft): boolean {
  return a.title === b.title && a.text === b.text;
}

// Textarea in place of the rich text editor — see NoteEditor.tsx, not wired
// up here for now. noteContentFromText/noteTextFromContent round-trip
// through Note.content's real (Lexical) shape so this stays compatible with
// whatever the editor last saved, lossily: formatting doesn't survive.
function NotePane({ uid, note }: { uid: string; note: Note }) {
  const [draft, setDraft] = useState<Draft>({ title: note.title, text: noteTextFromContent(note.content) });
  const baselineRef = useRef(draft);
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  // Resyncs from the live note whenever there are no unsaved local edits, so
  // a change from another tab/device is picked up here the same way it
  // already is in the sidebar list. If there ARE unsaved local edits, the
  // remote value is left alone until this instance's own autosave lands —
  // Firestore's normal last-write-wins-by-arrival rule then decides the
  // outcome, same as any other same-field conflict (see CONTEXT.md).
  useEffect(() => {
    const incoming: Draft = { title: note.title, text: noteTextFromContent(note.content) };
    if (draftsEqual(incoming, baselineRef.current) || !draftsEqual(draftRef.current, baselineRef.current)) {
      return;
    }
    baselineRef.current = incoming;
    setDraft(incoming);
  }, [note]);

  const { flush } = useAutosave(draft, (value) => {
    baselineRef.current = value;
    return updateNote(uid, note.id, { title: value.title, content: noteContentFromText(value.text) });
  });

  return (
    <div className={styles.pane}>
      <input
        className={styles.title}
        value={draft.title}
        onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
        onBlur={flush}
        placeholder='Title'
        aria-label='Note title'
      />
      <textarea
        className={styles.textarea}
        value={draft.text}
        onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))}
        onBlur={flush}
        aria-label='Note content'
      />
    </div>
  );
}

function Notes() {
  const { user, signOut } = useAuth();
  const { notes } = useNotes(user?.uid ?? null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);

  if (!user) {
    return null;
  }

  const selectedNote = notes.find((note) => note.id === selectedNoteId) ?? null;

  const handleNewNote = () => {
    const note = createNote(user.uid, {});
    setSelectedNoteId(note.id);
  };

  const handleDelete = (noteId: string) => {
    void deleteNote(user.uid, noteId);
    if (noteId === selectedNoteId) {
      setSelectedNoteId(null);
    }
  };

  return (
    <div className={styles.layout}>
      <header className={styles.header}>
        <h1>Jottr</h1>
        <button type='button' onClick={() => void signOut()}>
          Sign out
        </button>
      </header>

      <div className={styles.body}>
        <aside className={styles.sidebar}>
          <button type='button' onClick={handleNewNote}>
            New note
          </button>

          {notes.length === 0 ? (
            <p>No notes yet.</p>
          ) : (
            <ul className={styles.list}>
              {notes.map((note) => (
                <li key={note.id}>
                  <button
                    type='button'
                    aria-current={note.id === selectedNoteId}
                    onClick={() => setSelectedNoteId(note.id)}
                  >
                    {note.title || 'Untitled'}
                  </button>
                  <button
                    type='button'
                    aria-label={`Delete ${note.title || 'Untitled'}`}
                    onClick={() => handleDelete(note.id)}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <main className={styles.main}>
          {selectedNote ? (
            <NotePane key={selectedNote.id} uid={user.uid} note={selectedNote} />
          ) : (
            <p>Select a note or create a new one.</p>
          )}
        </main>
      </div>
    </div>
  );
}

export default Notes;
