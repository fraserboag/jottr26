import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { createNote, deleteNote, moveNote, useNotes } from '@/lib/notes';
import {
  createFolder,
  deleteFolder,
  getFolderSubtreeIds,
  moveFolder,
  useFolders,
  wouldCreateCycle,
} from '@/lib/folders';
import { keyForEnd } from '@/lib/ordering';
import { childrenOf } from '@/lib/tree';
import { useReapExpired } from '@/lib/reap';
import { SyncStatusProvider } from '@/lib/syncStatus';
import { useCollapsedFolders } from '@/lib/useCollapsedFolders';
import { useIsNarrow } from '@/lib/useIsNarrow';
import type { MoveDest } from '@/components/NoteTree';
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
  useReapExpired(user?.uid ?? null);
  // Parent of the folder whose inline "new folder" input is currently open:
  // undefined = none open, null = new top-level folder, id = new subfolder.
  const [addingFolderParentId, setAddingFolderParentId] = useState<
    string | null | undefined
  >(undefined);
  const isNarrow = useIsNarrow();
  // null until the user expresses a preference, so the sidebar tracks the
  // viewport (open beside the editor, closed over it) until they say otherwise.
  const [sidebarPreference, setSidebarPreference] = useState<boolean | null>(
    null,
  );
  const sidebarOpen = sidebarPreference ?? !isNarrow;
  // Narrow puts the sidebar over the editor, so anything that opens a note has
  // to dismiss it or the note it just opened stays hidden behind it.
  const closeSidebarIfNarrow = () => {
    if (isNarrow) setSidebarPreference(false);
  };

  if (!user) {
    return null;
  }

  const selectedNote = notes.find((note) => note.id === selectedNoteId) ?? null;

  // Folders and notes directly under `parentId`, whose shared order keyspace a
  // newly created sibling appends to the end of.
  const siblingsAt = (parentId: string | null) =>
    childrenOf({ folders, notes }, parentId);

  const handleNewNote = () => {
    const note = createNote(user.uid, {
      folderId: null,
      order: keyForEnd(siblingsAt(null)),
    });
    closeSidebarIfNarrow();
    void navigate(`/notes/${note.id}`, { state: { focusTitle: true } });
  };

  const handleNewNoteInFolder = (folderId: string) => {
    const note = createNote(user.uid, {
      folderId,
      order: keyForEnd(siblingsAt(folderId)),
    });
    setCollapsedFolderIds((prev) => {
      const next = new Set(prev);
      next.delete(folderId);
      return next;
    });
    closeSidebarIfNarrow();
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
    void createFolder(user.uid, name, parentId, keyForEnd(siblingsAt(parentId)));
    setAddingFolderParentId(undefined);
  };

  const handleDeleteFolder = (folderId: string) => {
    const subtree = getFolderSubtreeIds(folders, folderId);
    void deleteFolder(user.uid, folderId, { folders, notes });
    if (addingFolderParentId != null && subtree.has(addingFolderParentId)) {
      setAddingFolderParentId(undefined);
    }
    // The cascade takes the open note with it if it lived anywhere below.
    if (selectedNote?.folderId != null && subtree.has(selectedNote.folderId)) {
      void navigate('/notes');
    }
  };

  const handleMoveItem = (
    item: { id: string; kind: 'folder' | 'note' },
    dest: MoveDest,
  ) => {
    if (item.kind === 'note') {
      void moveNote(user.uid, item.id, {
        folderId: dest.parentId,
        order: dest.order,
      });
      return;
    }
    // The sidebar hides a dragged folder's subtree so a cycle can't be
    // projected, but moveFolder's contract asks for the check regardless.
    if (!wouldCreateCycle(folders, item.id, dest.parentId)) {
      void moveFolder(user.uid, item.id, dest);
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
        <AppHeader
          onSignOut={() => void signOut()}
          onOpenTrash={() => void navigate('/trash')}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarPreference(!sidebarOpen)}
        />

        <div className={styles.body}>
          {sidebarOpen && (
            <Sidebar
              folders={folders}
              notes={notes}
              selectedNoteId={selectedNoteId ?? null}
              collapsedFolderIds={collapsedFolderIds}
              addingFolderParentId={addingFolderParentId}
              onNewNote={handleNewNote}
              onSelectNote={(noteId) => {
                closeSidebarIfNarrow();
                void navigate(`/notes/${noteId}`);
              }}
              onToggleFolder={toggleFolder}
              onNewNoteInFolder={handleNewNoteInFolder}
              onStartAddFolder={handleStartAddFolder}
              onCreateFolder={handleCreateFolder}
              onCancelAddFolder={() => setAddingFolderParentId(undefined)}
              onDeleteNote={handleDeleteNote}
              onDeleteFolder={handleDeleteFolder}
              onMoveItem={handleMoveItem}
            />
          )}

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
