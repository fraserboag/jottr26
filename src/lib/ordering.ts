import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

// Manual sibling ordering via fractional-index keys: reordering or moving an
// item is a single-doc write of a new `order` string, with no renumbering of
// its neighbours. Notes and folders under one parent share a single keyspace
// so they can interleave — see NoteTree, which merges and sorts them together.

// `order` may be absent on documents written before ordering existed;
// comparators and key helpers treat those as unordered and sort them last.
export type Ordered = { order?: string };

// Sort comparator for one level's siblings. Equal or missing keys compare
// equal here; callers add a stable id tiebreak so rendering never jitters.
export function compareOrder(a: Ordered, b: Ordered): number {
  const ao = a.order;
  const bo = b.order;
  if (ao === bo) {
    return 0;
  }
  if (ao === undefined) {
    return 1;
  }
  if (bo === undefined) {
    return -1;
  }
  return ao < bo ? -1 : 1;
}

// Order key for a new item at the end of `siblings` (any order). Used when
// creating a note/folder so it appends below its existing siblings.
export function keyForEnd(siblings: Ordered[]): string {
  return generateKeyBetween(maxKey(siblings), null);
}

// Order key for a new item at the start of `siblings` (any order).
export function keyForStart(siblings: Ordered[]): string {
  return generateKeyBetween(null, minKey(siblings));
}

// Order key to drop an item at `index` within `sorted` — a sibling list
// already sorted by order and NOT containing the item being moved. index 0
// places before the first sibling; sorted.length places after the last.
export function keyForIndex(sorted: Ordered[], index: number): string {
  const before = index > 0 ? (sorted[index - 1]?.order ?? null) : null;
  const after = index < sorted.length ? (sorted[index]?.order ?? null) : null;
  return generateKeyBetween(before, after);
}

// N evenly spaced keys, e.g. to assign order across a freshly built list.
export function keysForCount(n: number): string[] {
  return n > 0 ? generateNKeysBetween(null, null, n) : [];
}

function maxKey(siblings: Ordered[]): string | null {
  let max: string | null = null;
  for (const s of siblings) {
    if (s.order !== undefined && (max === null || s.order > max)) {
      max = s.order;
    }
  }
  return max;
}

function minKey(siblings: Ordered[]): string | null {
  let min: string | null = null;
  for (const s of siblings) {
    if (s.order !== undefined && (min === null || s.order < min)) {
      min = s.order;
    }
  }
  return min;
}
