import { useEffect, useRef, useState, type FormEvent } from 'react';
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
import {
  createFolder,
  deleteFolder,
  useFolders,
  type Folder,
} from '@/lib/folders';
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
function NotePane({
  uid,
  note,
  folders,
}: {
  uid: string;
  note: Note;
  folders: Folder[];
}) {
  const [draft, setDraft] = useState<Draft>({
    title: note.title,
    text: noteTextFromContent(note.content),
  });
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
  // outcome, same as any other same-field conflict.
  useEffect(() => {
    const incoming: Draft = {
      title: note.title,
      text: noteTextFromContent(note.content),
    };
    if (
      draftsEqual(incoming, baselineRef.current) ||
      !draftsEqual(draftRef.current, baselineRef.current)
    ) {
      return;
    }
    baselineRef.current = incoming;
    setDraft(incoming);
  }, [note]);

  const { flush } = useAutosave(draft, (value) => {
    baselineRef.current = value;
    return updateNote(uid, note.id, {
      title: value.title,
      content: noteContentFromText(value.text),
    });
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
      <select
        value={note.folderId ?? ''}
        onChange={(e) =>
          void updateNote(uid, note.id, { folderId: e.target.value || null })
        }
        aria-label='Folder'
      >
        <option value=''>Unfiled</option>
        {folders.map((folder) => (
          <option key={folder.id} value={folder.id}>
            {folder.name}
          </option>
        ))}
      </select>
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
  const { folders } = useFolders(user?.uid ?? null);
  const { notes } = useNotes(user?.uid ?? null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  // Where new notes/folders are created — null is the top level of the tree.
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(
    new Set(),
  );
  const [newFolderName, setNewFolderName] = useState('');

  if (!user) {
    return null;
  }

  const selectedNote = notes.find((note) => note.id === selectedNoteId) ?? null;

  const handleNewNote = () => {
    const note = createNote(user.uid, { folderId: selectedFolderId });
    setSelectedNoteId(note.id);
  };

  const handleDelete = (noteId: string) => {
    void deleteNote(user.uid, noteId);
    if (noteId === selectedNoteId) {
      setSelectedNoteId(null);
    }
  };

  const handleCreateFolder = (e: FormEvent) => {
    e.preventDefault();
    const name = newFolderName.trim();
    if (!name) {
      return;
    }
    void createFolder(user.uid, name, selectedFolderId);
    setNewFolderName('');
  };

  const handleDeleteFolder = (folderId: string) => {
    void deleteFolder(user.uid, folderId);
    if (selectedFolderId === folderId) {
      setSelectedFolderId(null);
    }
  };

  const toggleFolder = (folderId: string) => {
    setCollapsedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  const folderIds = new Set(folders.map((folder) => folder.id));
  // A folderId/parentId pointing at a folder that's been deleted (tombstoned,
  // so no longer in `folders`) is treated as top-level.
  // Without this, a deleted folder's notes and subfolders would still exist
  // in Firestore but never render anywhere in the tree.
  const effectiveParentId = (id: string | null) =>
    id !== null && folderIds.has(id) ? id : null;

  // Recursive: renders the folders and notes that live directly under
  // parentId, at the given nesting depth, and (for expanded folders) their
  // children below them — folders and unfiled notes are siblings in one
  // tree, not separate sections.
  const renderLevel = (parentId: string | null, depth: number) => {
    const childFolders = folders.filter(
      (folder) => effectiveParentId(folder.parentId) === parentId,
    );
    const childNotes = notes.filter(
      (note) => effectiveParentId(note.folderId) === parentId,
    );
    if (childFolders.length === 0 && childNotes.length === 0) {
      return null;
    }
    const indent = { paddingLeft: `calc(${depth} * var(--space-4))` };

    return (
      <ul className={styles.tree}>
        {childFolders.map((folder) => {
          const isCollapsed = collapsedFolderIds.has(folder.id);
          return (
            <li key={folder.id}>
              <div className={styles.row} style={indent}>
                <button
                  type='button'
                  className={styles.disclosure}
                  aria-expanded={!isCollapsed}
                  aria-label={
                    isCollapsed
                      ? `Expand ${folder.name}`
                      : `Collapse ${folder.name}`
                  }
                  onClick={() => toggleFolder(folder.id)}
                >
                  {isCollapsed ? '▸' : '▾'}
                </button>
                <button
                  type='button'
                  className={styles.folderName}
                  aria-current={selectedFolderId === folder.id}
                  aria-expanded={!isCollapsed}
                  onClick={() => {
                    setSelectedFolderId(folder.id);
                    toggleFolder(folder.id);
                  }}
                >
                  {folder.name}
                </button>
                <button
                  type='button'
                  className={styles.deleteButton}
                  aria-label={`Delete ${folder.name}`}
                  onClick={() => handleDeleteFolder(folder.id)}
                >
                  Delete
                </button>
              </div>
              {!isCollapsed && renderLevel(folder.id, depth + 1)}
            </li>
          );
        })}
        {childNotes.map((note) => (
          <li key={note.id}>
            <div className={styles.row} style={indent}>
              <span className={styles.disclosureSpacer} aria-hidden='true' />
              <button
                type='button'
                className={styles.noteName}
                aria-current={note.id === selectedNoteId}
                onClick={() => setSelectedNoteId(note.id)}
              >
                {note.title || 'Untitled'}
              </button>
              <button
                type='button'
                className={styles.deleteButton}
                aria-label={`Delete ${note.title || 'Untitled'}`}
                onClick={() => handleDelete(note.id)}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    );
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
          <div className={styles.sidebarActions}>
            <button type='button' onClick={handleNewNote}>
              New note
            </button>
            <form
              className={styles.newFolderForm}
              onSubmit={handleCreateFolder}
            >
              <input
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder='New folder name'
                aria-label='New folder name'
              />
              <button type='submit'>Add folder</button>
            </form>
          </div>

          {folders.length === 0 && notes.length === 0 ? (
            <p>No notes or folders yet.</p>
          ) : (
            renderLevel(null, 0)
          )}
        </aside>

        <main className={styles.main}>
          {selectedNote ? (
            <NotePane
              key={selectedNote.id}
              uid={user.uid}
              note={selectedNote}
              folders={folders}
            />
          ) : (
            <p>Select a note or create a new one.</p>
          )}
        </main>
      </div>
    </div>
  );
}

export default Notes;
