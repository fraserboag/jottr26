import { useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { FilePlus, FolderPlus } from 'lucide-react';
import type { Folder } from '@/lib/folders';
import type { Note } from '@/lib/notes';
import {
  clampSidebarWidth,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  useSidebarWidth,
} from '@/lib/useSidebarWidth';
import NewFolderForm from './NewFolderForm';
import NoteTree, { type MoveDest } from './NoteTree';
import styles from './Sidebar.module.css';

const KEYBOARD_STEP = 16;

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
  onMoveItem: (item: { id: string; kind: 'folder' | 'note' }, dest: MoveDest) => void;
};

function Sidebar({ folders, notes, onNewNote, ...tree }: SidebarProps) {
  const isEmpty = folders.length === 0 && notes.length === 0;
  const [sidebarWidth, setSidebarWidth] = useSidebarWidth();
  const [isResizing, setIsResizing] = useState(false);

  function handleResizeStart(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();

    const handle = event.currentTarget;
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    handle.setPointerCapture(event.pointerId);
    setIsResizing(true);
    // Pointer capture routes events to the handle, but the cursor still tracks
    // whatever is underneath it, so pin it for the duration of the drag.
    document.body.style.cursor = 'col-resize';

    // Pointer capture keeps these on the handle even as the cursor leaves it.
    function handleMove(moveEvent: globalThis.PointerEvent) {
      setSidebarWidth(clampSidebarWidth(startWidth + moveEvent.clientX - startX));
    }
    function handleEnd() {
      setIsResizing(false);
      document.body.style.cursor = '';
      handle.removeEventListener('pointermove', handleMove);
      handle.removeEventListener('pointerup', handleEnd);
      handle.removeEventListener('pointercancel', handleEnd);
    }

    handle.addEventListener('pointermove', handleMove);
    handle.addEventListener('pointerup', handleEnd);
    handle.addEventListener('pointercancel', handleEnd);
  }

  function handleResizeKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step =
      event.key === 'ArrowLeft'
        ? -KEYBOARD_STEP
        : event.key === 'ArrowRight'
          ? KEYBOARD_STEP
          : 0;
    if (!step) return;
    event.preventDefault();
    setSidebarWidth((width) => clampSidebarWidth(width + step));
  }

  return (
    <aside className={styles.sidebar} style={{ width: sidebarWidth }}>
      <div className={styles.content}>
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
      </div>

      <div
        className={`${styles.handle} ${isResizing ? styles.resizing : ''}`}
        role='separator'
        aria-orientation='vertical'
        aria-label='Resize sidebar'
        aria-valuenow={sidebarWidth}
        aria-valuemin={MIN_SIDEBAR_WIDTH}
        aria-valuemax={MAX_SIDEBAR_WIDTH}
        tabIndex={0}
        onPointerDown={handleResizeStart}
        onKeyDown={handleResizeKeyDown}
        onDoubleClick={() => setSidebarWidth(DEFAULT_SIDEBAR_WIDTH)}
      />
    </aside>
  );
}

export default Sidebar;
