import type { Folder } from '@/lib/folders';
import type { Note } from '@/lib/notes';
import { compareOrder } from '@/lib/ordering';

// The sidebar tree: folders and notes are siblings in one structure, not
// separate sections, and everything under one parent shares a single order
// keyspace so the two kinds interleave. See src/lib/ordering.ts.

export type Tree = { folders: Folder[]; notes: Note[] };

export type TreeItem = {
  id: string;
  parentId: string | null;
  order?: string;
} & ({ kind: 'folder'; folder: Folder } | { kind: 'note'; note: Note });

export type FlatItem = TreeItem & { depth: number };

// Every item keyed by the parent it renders under, each level pre-sorted.
function groupByParent(tree: Tree): Map<string | null, TreeItem[]> {
  const live = new Set(tree.folders.map((folder) => folder.id));
  // A parent that's been deleted (tombstoned, so no longer in `folders`) makes
  // its orphans top-level. Without this they'd still exist in Firestore but
  // never render anywhere in the tree.
  const parentOf = (id: string | null) => (id !== null && live.has(id) ? id : null);

  const groups = new Map<string | null, TreeItem[]>();
  const add = (item: TreeItem) => {
    const siblings = groups.get(item.parentId);
    if (siblings) {
      siblings.push(item);
    } else {
      groups.set(item.parentId, [item]);
    }
  };

  for (const folder of tree.folders) {
    add({
      kind: 'folder',
      folder,
      id: folder.id,
      parentId: parentOf(folder.parentId),
      order: folder.order,
    });
  }
  for (const note of tree.notes) {
    add({
      kind: 'note',
      note,
      id: note.id,
      parentId: parentOf(note.folderId),
      order: note.order,
    });
  }

  // The id tiebreak keeps the sort stable when order keys are equal or absent
  // (documents predating ordering sort last, then by id).
  for (const siblings of groups.values()) {
    siblings.sort((a, b) => compareOrder(a, b) || a.id.localeCompare(b.id));
  }
  return groups;
}

// One level's children, in display order.
export function childrenOf(tree: Tree, parentId: string | null): TreeItem[] {
  return groupByParent(tree).get(parentId) ?? [];
}

// Depth-first walk of the whole tree in display order, skipping what lives
// under a collapsed folder — i.e. exactly the rows the sidebar shows.
export function flattenTree(
  tree: Tree,
  collapsedFolderIds: ReadonlySet<string> = new Set(),
): FlatItem[] {
  const groups = groupByParent(tree);
  const flat: FlatItem[] = [];

  const walk = (parentId: string | null, depth: number) => {
    for (const item of groups.get(parentId) ?? []) {
      flat.push({ ...item, depth });
      if (item.kind === 'folder' && !collapsedFolderIds.has(item.id)) {
        walk(item.id, depth + 1);
      }
    }
  };
  walk(null, 0);

  return flat;
}
