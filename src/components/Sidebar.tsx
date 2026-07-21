import { FilePlus, FolderPlus } from 'lucide-react';
import type { Folder } from '@/lib/folders';
import type { Note } from '@/lib/notes';
import NewFolderForm from './NewFolderForm';
import NoteTree from './NoteTree';
import styles from './Sidebar.module.css';

type SidebarProps = {
  folders: Folder[];
  notes: Note[];
  selectedNoteId: string | null;
  collapsedFolderIds: Set<string>;
  addingFolderParentId: string | null | undefined;
  onNewNote: () => void;
  onSelectNote: (noteId: string) => void;
  onToggleFolder: (folderId: string) => void;
  onNewNoteInFolder: (folderId: string) => void;
  onStartAddFolder: (parentId: string | null) => void;
  onCreateFolder: (parentId: string | null, name: string) => void;
  onCancelAddFolder: () => void;
  onDeleteNote: (noteId: string) => void;
  onDeleteFolder: (folderId: string) => void;
};

function Sidebar({ folders, notes, onNewNote, ...tree }: SidebarProps) {
  const isEmpty = folders.length === 0 && notes.length === 0;

  return (
    <aside className={styles.sidebar}>
      <div className={styles.actions}>
        <button type='button' aria-label='New note' onClick={onNewNote}>
          <FilePlus size={16} />
        </button>
        <button
          type='button'
          aria-label='New folder'
          onClick={() => tree.onStartAddFolder(null)}
        >
          <FolderPlus size={16} />
        </button>
      </div>

      {tree.addingFolderParentId === null && (
        <NewFolderForm
          autoFocus
          onCreate={(name) => tree.onCreateFolder(null, name)}
          onCancel={tree.onCancelAddFolder}
        />
      )}

      {isEmpty ? (
        <p className={styles.empty}>No notes or folders yet.</p>
      ) : (
        <NoteTree folders={folders} notes={notes} {...tree} />
      )}
    </aside>
  );
}

export default Sidebar;
