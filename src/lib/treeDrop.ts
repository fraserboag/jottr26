import { arrayMove } from '@dnd-kit/sortable';
import { keyForIndex } from '@/lib/ordering';
import { childrenOf, type FlatItem, type Tree } from '@/lib/tree';

// Where a sidebar drag would land. The flat list is one vertical sortable, so
// the vertical position picks the slot and the horizontal drag offset picks the
// nesting depth: drag right to nest under the row above, left to pop out
// towards the root.

// Pixels of horizontal drag per nesting level — matches the per-depth indent
// NoteTree renders (--space-4).
const INDENT_WIDTH = 16;

export type Projection = {
  depth: number;
  parentId: string | null;
  // Nearest row above the drop that shares the destination parent; null when
  // the drop lands first among its siblings.
  prevSiblingId: string | null;
  // Row the landing slot opens directly below, whatever its depth; null when
  // the drop lands at the very top of the tree. Positions the drop indicator.
  afterId: string | null;
};

export function project(
  items: FlatItem[],
  activeId: string,
  overId: string,
  offsetX: number,
): Projection | null {
  const activeIndex = items.findIndex((item) => item.id === activeId);
  const overIndex = items.findIndex((item) => item.id === overId);
  if (activeIndex === -1 || overIndex === -1) {
    return null;
  }

  const reordered = arrayMove(items, activeIndex, overIndex);
  const above = reordered[overIndex - 1];
  const below = reordered[overIndex + 1];

  // Only a folder can take children, so a note above the drop caps the depth at
  // its own level instead of one deeper. The row below sets the floor: dropping
  // shallower than it would strand it under nothing.
  const maxDepth = above ? above.depth + (above.kind === 'folder' ? 1 : 0) : 0;
  const minDepth = below ? below.depth : 0;
  const dragged = items[activeIndex].depth + Math.round(offsetX / INDENT_WIDTH);
  const depth = Math.min(Math.max(dragged, minDepth), maxDepth);

  return {
    depth,
    parentId: parentAt(reordered, overIndex, depth),
    prevSiblingId: prevSiblingAt(reordered, overIndex, depth),
    afterId: above?.id ?? null,
  };
}

function parentAt(reordered: FlatItem[], overIndex: number, depth: number): string | null {
  const above = reordered[overIndex - 1];
  if (depth === 0 || !above) {
    return null;
  }
  if (depth > above.depth) {
    return above.id; // a folder — maxDepth only allows this past one
  }
  if (depth === above.depth) {
    return above.parentId;
  }
  // Popping out: the last row above sitting at the destination depth is a
  // sibling-to-be, so it names the parent.
  for (let i = overIndex - 1; i >= 0; i -= 1) {
    if (reordered[i].depth === depth) {
      return reordered[i].parentId;
    }
  }
  return null;
}

function prevSiblingAt(reordered: FlatItem[], overIndex: number, depth: number): string | null {
  for (let i = overIndex - 1; i >= 0; i -= 1) {
    const item = reordered[i];
    if (item.depth < depth) {
      break; // left the destination level without meeting a sibling
    }
    if (item.depth === depth) {
      return item.id;
    }
  }
  return null;
}

// The write a projected drop implies, or null if the item wouldn't actually
// move. Order keys come from the real sibling list rather than the visible
// rows, so dropping into a collapsed folder still lands between its children.
export function resolveDrop(
  tree: Tree,
  activeId: string,
  projection: Projection,
): { parentId: string | null; order: string } | null {
  const siblings = childrenOf(tree, projection.parentId);
  const others = siblings.filter((sibling) => sibling.id !== activeId);
  const index =
    projection.prevSiblingId === null
      ? 0
      : others.findIndex((sibling) => sibling.id === projection.prevSiblingId) + 1;

  const currentIndex = siblings.findIndex((sibling) => sibling.id === activeId);
  if (currentIndex !== -1 && currentIndex === index) {
    return null;
  }
  return { parentId: projection.parentId, order: keyForIndex(others, index) };
}
