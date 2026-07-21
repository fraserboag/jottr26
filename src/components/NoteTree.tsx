import type { Folder } from '@/lib/folders';
import type { Note } from '@/lib/notes';
import FolderRow from './FolderRow';
import NewFolderForm from './NewFolderForm';
import NoteRow from './NoteRow';
import styles from './NoteTree.module.css';

type NoteTreeProps = {
  folders: Folder[];
  notes: Note[];
  selectedNoteId: string | null;
  collapsedFolderIds: Set<string>;
  addingFolderParentId: string | null | undefined;
  onSelectNote: (noteId: string) => void;
  onToggleFolder: (folderId: string) => void;
  onNewNoteInFolder: (folderId: string) => void;
  onStartAddFolder: (parentId: string | null) => void;
  onCreateFolder: (parentId: string | null, name: string) => void;
  onCancelAddFolder: () => void;
  onDeleteNote: (noteId: string) => void;
  onDeleteFolder: (folderId: string) => void;
  parentId?: string | null;
  depth?: number;
};

// Recursive: renders the folders and notes that live directly under parentId,
// at the given nesting depth, and (for expanded folders) their children below
// them — folders and unfiled notes are siblings in one tree, not separate
// sections.
function NoteTree(props: NoteTreeProps) {
  const {
    folders,
    notes,
    selectedNoteId,
    collapsedFolderIds,
    addingFolderParentId,
    onSelectNote,
    onToggleFolder,
    onNewNoteInFolder,
    onStartAddFolder,
    onCreateFolder,
    onCancelAddFolder,
    onDeleteNote,
    onDeleteFolder,
    parentId = null,
    depth = 0,
  } = props;

  const folderIds = new Set(folders.map((folder) => folder.id));
  // A folderId/parentId pointing at a folder that's been deleted (tombstoned,
  // so no longer in `folders`) is treated as top-level.
  // Without this, a deleted folder's notes and subfolders would still exist
  // in Firestore but never render anywhere in the tree.
  const effectiveParentId = (id: string | null) =>
    id !== null && folderIds.has(id) ? id : null;

  const childFolders = folders.filter(
    (folder) => effectiveParentId(folder.parentId) === parentId,
  );
  const childNotes = notes.filter(
    (note) => effectiveParentId(note.folderId) === parentId,
  );
  if (childFolders.length === 0 && childNotes.length === 0) {
    return null;
  }
  const indent = {
    paddingLeft: `calc(var(--space-2) + ${depth} * var(--space-4))`,
  };
  const childIndent = {
    paddingLeft: `calc(var(--space-2) + ${depth + 1} * var(--space-4))`,
  };

  return (
    <ul className={styles.tree}>
      {childFolders.map((folder) => {
        const isCollapsed = collapsedFolderIds.has(folder.id);
        return (
          <li key={folder.id}>
            <FolderRow
              folder={folder}
              isCollapsed={isCollapsed}
              indent={indent}
              onToggle={() => onToggleFolder(folder.id)}
              onNewNote={() => onNewNoteInFolder(folder.id)}
              onAddSubfolder={() => onStartAddFolder(folder.id)}
              onDelete={() => onDeleteFolder(folder.id)}
            />
            {addingFolderParentId === folder.id && (
              <div style={childIndent}>
                <NewFolderForm
                  autoFocus
                  onCreate={(name) => onCreateFolder(folder.id, name)}
                  onCancel={onCancelAddFolder}
                />
              </div>
            )}
            {!isCollapsed && (
              <NoteTree {...props} parentId={folder.id} depth={depth + 1} />
            )}
          </li>
        );
      })}
      {childNotes.map((note) => (
        <li key={note.id}>
          <NoteRow
            note={note}
            isSelected={note.id === selectedNoteId}
            indent={indent}
            onSelect={() => onSelectNote(note.id)}
            onDelete={() => onDeleteNote(note.id)}
          />
        </li>
      ))}
    </ul>
  );
}

export default NoteTree;
