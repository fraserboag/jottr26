import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { createNote, deleteNote, useNotes } from '@/lib/notes';
import { createFolder, deleteFolder, useFolders } from '@/lib/folders';
import { SyncStatusProvider } from '@/lib/syncStatus';
import { useCollapsedFolders } from '@/lib/useCollapsedFolders';
import AppHeader from '@/components/AppHeader';
import NoteEditor from '@/components/NoteEditor';
import Sidebar from '@/components/Sidebar';
import styles from './Notes.module.css';

function Notes() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { noteId: selectedNoteId } = useParams<{ noteId?: string }>();
  const { folders } = useFolders(user?.uid ?? null);
  const { notes, loading: notesLoading } = useNotes(user?.uid ?? null);
  const [collapsedFolderIds, setCollapsedFolderIds] = useCollapsedFolders();
  // Parent of the folder whose inline "new folder" input is currently open:
  // undefined = none open, null = new top-level folder, id = new subfolder.
  const [addingFolderParentId, setAddingFolderParentId] = useState<
    string | null | undefined
  >(undefined);

  if (!user) {
    return null;
  }

  const selectedNote = notes.find((note) => note.id === selectedNoteId) ?? null;

  const handleNewNote = () => {
    const note = createNote(user.uid, { folderId: null });
    void navigate(`/notes/${note.id}`, { state: { focusTitle: true } });
  };

  const handleNewNoteInFolder = (folderId: string) => {
    const note = createNote(user.uid, { folderId });
    setCollapsedFolderIds((prev) => {
      const next = new Set(prev);
      next.delete(folderId);
      return next;
    });
    void navigate(`/notes/${note.id}`, { state: { focusTitle: true } });
  };

  const handleDeleteNote = (noteId: string) => {
    void deleteNote(user.uid, noteId);
    if (noteId === selectedNoteId) {
      void navigate('/notes');
    }
  };

  const handleStartAddFolder = (parentId: string | null) => {
    if (parentId !== null) {
      setCollapsedFolderIds((prev) => {
        const next = new Set(prev);
        next.delete(parentId);
        return next;
      });
    }
    setAddingFolderParentId(parentId);
  };

  const handleCreateFolder = (parentId: string | null, name: string) => {
    void createFolder(user.uid, name, parentId);
    setAddingFolderParentId(undefined);
  };

  const handleDeleteFolder = (folderId: string) => {
    void deleteFolder(user.uid, folderId);
    if (addingFolderParentId === folderId) {
      setAddingFolderParentId(undefined);
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

  return (
    <SyncStatusProvider>
      <div className={styles.layout}>
        <AppHeader onSignOut={() => void signOut()} />

        <div className={styles.body}>
          <Sidebar
            folders={folders}
            notes={notes}
            selectedNoteId={selectedNoteId ?? null}
            collapsedFolderIds={collapsedFolderIds}
            addingFolderParentId={addingFolderParentId}
            onNewNote={handleNewNote}
            onSelectNote={(noteId) => void navigate(`/notes/${noteId}`)}
            onToggleFolder={toggleFolder}
            onNewNoteInFolder={handleNewNoteInFolder}
            onStartAddFolder={handleStartAddFolder}
            onCreateFolder={handleCreateFolder}
            onCancelAddFolder={() => setAddingFolderParentId(undefined)}
            onDeleteNote={handleDeleteNote}
            onDeleteFolder={handleDeleteFolder}
          />

          <main className={styles.main}>
            {selectedNote ? (
              <NoteEditor
                key={selectedNote.id}
                uid={user.uid}
                note={selectedNote}
              />
            ) : !selectedNoteId ? (
              <p className={styles.message}>Select a note or create a new one.</p>
            ) : notesLoading ? (
              <p className={styles.message}>Loading…</p>
            ) : (
              <p className={styles.message}>Note not found.</p>
            )}
          </main>
        </div>
      </div>
    </SyncStatusProvider>
  );
}

export default Notes;
