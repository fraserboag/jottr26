import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable } from '@dnd-kit/sortable';
import type { Folder } from '@/lib/folders';
import type { Note } from '@/lib/notes';
import { flattenTree } from '@/lib/tree';
import { project, resolveDrop, type Projection } from '@/lib/treeDrop';
import FolderRow from './FolderRow';
import NewFolderForm from './NewFolderForm';
import NoteRow from './NoteRow';
import styles from './NoteTree.module.css';

export type MoveDest = { parentId: string | null; order: string };

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
  onMoveItem: (item: { id: string; kind: 'folder' | 'note' }, dest: MoveDest) => void;
};

type DragState = { activeId: string; overId: string; offsetX: number };

// The tree renders flat: one row per visible folder/note, indented by depth, so
// a single vertical sortable covers the whole thing. Nesting is expressed by
// dragging sideways — see src/lib/treeDrop.ts.
function NoteTree({
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
  onMoveItem,
}: NoteTreeProps) {
  const [drag, setDrag] = useState<DragState | null>(null);

  // Touch activates on a long press rather than a distance, so a swipe still
  // scrolls the sidebar instead of dragging a row out of it.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  );

  const tree = { folders, notes };
  // A dragged folder takes its subtree with it, so those rows are hidden for
  // the duration rather than offered as drop targets — which also makes it
  // impossible to project a drop inside the folder being moved.
  const hidden = drag
    ? new Set([...collapsedFolderIds, drag.activeId])
    : collapsedFolderIds;
  const items = flattenTree(tree, hidden);
  const projection = drag
    ? project(items, drag.activeId, drag.overId, drag.offsetX)
    : null;

  function handleDragStart({ active }: DragStartEvent) {
    const activeId = String(active.id);
    setDrag({ activeId, overId: activeId, offsetX: 0 });
  }

  function handleDragMove({ delta }: DragMoveEvent) {
    setDrag((prev) => (prev ? { ...prev, offsetX: delta.x } : prev));
  }

  function handleDragOver({ over }: DragOverEvent) {
    setDrag((prev) => (prev && over ? { ...prev, overId: String(over.id) } : prev));
  }

  function handleDragEnd({ active, over, delta }: DragEndEvent) {
    setDrag(null);
    if (!over) {
      return;
    }
    const activeId = String(active.id);
    const item = items.find((candidate) => candidate.id === activeId);
    const projected = project(items, activeId, String(over.id), delta.x);
    if (!item || !projected) {
      return;
    }
    const dest = resolveDrop(tree, activeId, projected);
    if (dest) {
      onMoveItem({ id: item.id, kind: item.kind }, dest);
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDrag(null)}
    >
      <SortableContext items={items.map((item) => item.id)} strategy={noDisplacement}>
        <ul className={styles.tree}>
          {items.map((item, index) => {
            const indent = indentAt(item.depth);
            return (
              <SortableItem
                key={item.id}
                id={item.id}
                indicator={indicatorFor(projection, item.id, index)}
                indicatorDepth={projection?.depth ?? 0}
              >
                {item.kind === 'note' ? (
                  <NoteRow
                    note={item.note}
                    isSelected={item.note.id === selectedNoteId}
                    indent={indent}
                    onSelect={() => onSelectNote(item.note.id)}
                    onDelete={() => onDeleteNote(item.note.id)}
                  />
                ) : (
                  <>
                    <FolderRow
                      folder={item.folder}
                      isCollapsed={collapsedFolderIds.has(item.id)}
                      isDropTarget={projection?.parentId === item.id}
                      indent={indent}
                      onToggle={() => onToggleFolder(item.id)}
                      onNewNote={() => onNewNoteInFolder(item.id)}
                      onAddSubfolder={() => onStartAddFolder(item.id)}
                      onDelete={() => onDeleteFolder(item.id)}
                    />
                    {addingFolderParentId === item.id && (
                      <div style={indentAt(item.depth + 1)}>
                        <NewFolderForm
                          autoFocus
                          onCreate={(name) => onCreateFolder(item.id, name)}
                          onCancel={onCancelAddFolder}
                        />
                      </div>
                    )}
                  </>
                )}
              </SortableItem>
            );
          })}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

const indentAt = (depth: number): CSSProperties => ({
  paddingLeft: `calc(var(--space-2) + ${depth} * var(--space-4))`,
});

// Rows hold their place for the whole drag: the indicator line alone says where
// the item lands, so nothing slides around to open a gap for it.
const noDisplacement = () => null;

// Which edge of this row, if any, the drop indicator sits on.
type Indicator = 'before' | 'after' | null;

function indicatorFor(
  projection: Projection | null,
  id: string,
  index: number,
): Indicator {
  if (!projection) {
    return null;
  }
  if (projection.afterId === id) {
    return 'after';
  }
  return projection.afterId === null && index === 0 ? 'before' : null;
}

// The whole row is the drag handle; the buttons inside it stay clickable
// because the mouse sensor only activates past a few pixels of movement.
function SortableItem({
  id,
  indicator,
  indicatorDepth,
  children,
}: {
  id: string;
  indicator: Indicator;
  indicatorDepth: number;
  children: ReactNode;
}) {
  const { setNodeRef, listeners, isDragging } = useSortable({
    id,
    animateLayoutChanges: () => false,
  });

  return (
    <li
      ref={setNodeRef}
      className={`${styles.item} ${isDragging ? styles.dragging : ''}`}
      {...listeners}
    >
      {children}
      {indicator && (
        <div
          className={`${styles.indicator} ${indicator === 'before' ? styles.indicatorBefore : ''}`}
          style={{
            left: `calc(var(--space-2) + ${indicatorDepth} * var(--space-4))`,
          }}
        />
      )}
    </li>
  );
}

export default NoteTree;
