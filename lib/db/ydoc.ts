import * as Y from 'yjs'
import { activeDatabase, type JottrDB } from './dexie'
import type { DocStateRow } from './schema'
import { broadcastUpdate, onPeerUpdate } from './peers'

/** Origin tags on Yjs transactions. The registry uses these to tell an edit the
 *  user just made from one that arrived over the wire — get this wrong and
 *  either remote edits never show up, or every pull echoes straight back as a
 *  push and the two devices ping-pong forever. */
export const REMOTE_ORIGIN = Symbol('jottr.remote')
export const LOAD_ORIGIN = Symbol('jottr.load')
/** An edit relayed from another tab. It is already in this origin's IndexedDB,
 *  so it must be applied to memory but never written or pushed a second time. */
export const PEER_ORIGIN = Symbol('jottr.peer')

/** Deltas are appended one row per transaction and compacted into the snapshot
 *  once there are this many. Re-encoding the whole document on every keystroke
 *  is the classic way to make a local-first editor feel slow. */
const COMPACT_THRESHOLD = 150

/** The document body lives in this fragment. It must match the `field` the
 *  Tiptap Collaboration extension uses (its default). */
export const DOC_FIELD = 'default'

export interface DocHandle {
  pageId: string
  doc: Y.Doc
  /** Whether this document has content — either created here or pulled down.
   *  An empty fragment for a page created on another device means the doc is
   *  still in flight, and letting the editor fill it in would duplicate the
   *  initial nodes when the two states merged. */
  ready: boolean
  /** When this device last edited the document, or 0. Kept here rather than
   *  written per keystroke; the editor's debounced mirror copies it onto the
   *  page row. */
  editedAt: number
}

/** 'text' is typing, which arrives in bursts and is worth batching.
 *  'structure' is a page created, moved, trashed or deleted: a single act the
 *  other devices should see straight away. */
export type EditKind = 'text' | 'structure'
type Listener = (kind: EditKind) => void

const handles = new Map<string, DocHandle>()
const loading = new Map<string, Promise<DocHandle>>()
const dirtyListeners = new Set<Listener>()

export function onLocalEdit(listener: Listener) {
  dirtyListeners.add(listener)
  return () => dirtyListeners.delete(listener)
}

export function notifyLocalEdit(kind: EditKind = 'text') {
  for (const listener of dirtyListeners) listener(kind)
}

/** Build the initial shape of a new page: a title node followed by an empty
 *  paragraph. This is exactly what ProseMirror would produce for the schema,
 *  but built by hand so the storage layer carries no editor dependency.
 *
 *  Seeding happens once, on the device that creates the page. Two devices
 *  independently seeding the same empty document would merge into two titles. */
export function seedDocument(doc: Y.Doc) {
  const fragment = doc.getXmlFragment(DOC_FIELD)
  if (fragment.length > 0) return
  // Committed as an ordinary local edit, so it is persisted and pushed like
  // anything else the user types. Seeding under a load origin would leave the
  // page's initial shape in memory only, and it would come back empty.
  doc.transact(() => {
    fragment.insert(0, [new Y.XmlElement('title'), new Y.XmlElement('paragraph')])
  })
}

async function loadFromDisk(db: JottrDB, pageId: string, doc: Y.Doc) {
  const [state, updates] = await Promise.all([
    db.docStates.get(pageId),
    db.docUpdates.where('pageId').equals(pageId).sortBy('seq'),
  ])

  doc.transact(() => {
    if (state?.snapshot?.byteLength) Y.applyUpdate(doc, state.snapshot, LOAD_ORIGIN)
    for (const row of updates) Y.applyUpdate(doc, row.update, LOAD_ORIGIN)
  }, LOAD_ORIGIN)

  return { state, deltaCount: updates.length }
}

/** One compaction at a time per page: two crossing the threshold together would
 *  both rewrite the snapshot and both clear the delta table. */
const compacting = new Set<string>()

async function compact(db: JottrDB, pageId: string, doc: Y.Doc) {
  if (compacting.has(pageId)) return
  compacting.add(pageId)
  try {
    await compactNow(db, pageId, doc)
  } finally {
    compacting.delete(pageId)
  }
}

async function compactNow(db: JottrDB, pageId: string, doc: Y.Doc) {
  await db.transaction('rw', db.docStates, db.docUpdates, async () => {
    // Encoded inside the transaction, so it covers every delta row the delete
    // below can reach: a row written before the transaction opened is already
    // in the document, and one written after it waits until this commits.
    const snapshot = Y.encodeStateAsUpdate(doc)
    const existing = await db.docStates.get(pageId)
    await db.docStates.put({ ...blankDocState(pageId), ...existing, snapshot })
    await db.docUpdates.where('pageId').equals(pageId).delete()
  })
}

function blankDocState(pageId: string): DocStateRow {
  return { pageId, snapshot: new Uint8Array(), version: 0, dirty: 0, edits: 0 }
}

/** Every change to a page's doc state row other than compaction goes through
 *  here, as one read-and-write transaction. Writing back a row read outside a
 *  transaction would put back whatever snapshot it held, and a compaction that
 *  landed in between has already deleted the deltas the old snapshot needs. */
export async function patchDocState(
  db: JottrDB,
  pageId: string,
  patch: (current: DocStateRow) => Partial<Omit<DocStateRow, 'pageId' | 'snapshot'>>,
) {
  await db.transaction('rw', db.docStates, async () => {
    const current = { ...blankDocState(pageId), ...(await db.docStates.get(pageId)) }
    await db.docStates.put({ ...current, ...patch(current) })
  })
}

/** Persistence is fire-and-forget so typing never waits on the disk. This is
 *  for the few callers — tests, mostly — that need to know it has landed. */
const persisting = new Set<Promise<void>>()

export async function whenPersisted() {
  while (persisting.size > 0) await Promise.all(persisting)
}

export async function openDoc(pageId: string, options?: { seed?: boolean }): Promise<DocHandle> {
  const existing = handles.get(pageId)
  if (existing) {
    if (options?.seed) {
      seedDocument(existing.doc)
      existing.ready = true
    }
    return existing
  }

  const inFlight = loading.get(pageId)
  if (inFlight) return inFlight

  const promise = (async (): Promise<DocHandle> => {
    const db = activeDatabase()
    if (!db) throw new Error('openDoc called before sign-in')

    const doc = new Y.Doc({ gc: true })
    const { state, deltaCount } = await loadFromDisk(db, pageId, doc)

    const handle: DocHandle = { pageId, doc, ready: false, editedAt: 0 }
    let pending = deltaCount

    // Attached before anything else touches the document, so no edit — not even
    // the initial title and paragraph of a brand new page — can slip past
    // persistence.
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === LOAD_ORIGIN) return
      if (origin === PEER_ORIGIN) {
        handle.ready = true
        return
      }

      const isLocal = origin !== REMOTE_ORIGIN
      handle.ready = true
      if (isLocal) handle.editedAt = Date.now()

      // Persisted immediately, one small row per transaction. The user's work is
      // on disk before the next keystroke lands, whatever the network is doing.
      //
      // The database is the one this document was opened against, not whichever
      // is active when the write lands: an edit made just before signing out
      // must never end up in the next account's database.
      const write = (async () => {
        if (!db.isOpen()) return
        await db.docUpdates.add({ pageId, update })
        pending += 1

        if (isLocal) {
          broadcastUpdate(pageId, update)
          await patchDocState(db, pageId, (current) => ({ dirty: 1, edits: current.edits + 1 }))
          notifyLocalEdit()
        }

        if (pending >= COMPACT_THRESHOLD) {
          pending = 0
          await compact(db, pageId, doc)
        }
      })()
      persisting.add(write)
      void write.finally(() => persisting.delete(write))
    })

    if (options?.seed) seedDocument(doc)
    handle.ready = doc.getXmlFragment(DOC_FIELD).length > 0 || (state?.version ?? 0) > 0

    handles.set(pageId, handle)
    return handle
  })()

  loading.set(pageId, promise)
  try {
    return await promise
  } finally {
    loading.delete(pageId)
  }
}

/** Apply a state blob that came from the server. Tagged REMOTE_ORIGIN so the
 *  update listener persists it without marking the document dirty again. */
export async function applyRemoteUpdate(pageId: string, update: Uint8Array) {
  if (!update.byteLength) return
  const handle = await openDoc(pageId)
  Y.applyUpdate(handle.doc, update, REMOTE_ORIGIN)
  handle.ready = true
}

export function loadedDoc(pageId: string): DocHandle | undefined {
  return handles.get(pageId)
}

/** Relay deltas from sibling tabs into whichever documents are open here. */
onPeerUpdate(({ pageId, update }) => {
  const handle = handles.get(pageId)
  if (handle) Y.applyUpdate(handle.doc, update, PEER_ORIGIN)
})

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false
  for (let i = 0; i < a.byteLength; i += 1) if (a[i] !== b[i]) return false
  return true
}

/** The title is the document's first node, so it is part of the CRDT and merges
 *  like any other text. This reads it without needing an editor, which matters
 *  because a title can change on a pull while the page is nowhere on screen. */
export function readTitle(doc: Y.Doc): string {
  const fragment = doc.getXmlFragment(DOC_FIELD)
  const first = fragment.get(0)
  if (!(first instanceof Y.XmlElement) || first.nodeName !== 'title') return ''
  return collectText(first).trim().slice(0, 200)
}

/** A flattened copy of the page's text, kept locally so search can look inside
 *  pages rather than only at their titles. It is derived, never synced: the
 *  document itself is the only thing the server stores. */
export function readPlainText(doc: Y.Doc): string {
  const fragment = doc.getXmlFragment(DOC_FIELD)
  let out = ''
  for (const child of fragment.toArray()) {
    if (child instanceof Y.XmlElement) out += `${collectText(child)}\n`
    else if (child instanceof Y.XmlText) out += `${textOf(child)}\n`
    if (out.length > 8000) break
  }
  return out.replace(/\n{2,}/g, '\n').slice(0, 8000)
}

/** Read a text node through its delta rather than toString(): toString()
 *  serialises marks as HTML tags, and stripping those back out would also eat a
 *  literal '<b>' that someone actually typed. */
function textOf(node: Y.XmlText): string {
  let out = ''
  for (const op of node.toDelta() as Array<{ insert?: unknown }>) {
    if (typeof op.insert === 'string') out += op.insert
  }
  return out
}

function collectText(node: Y.XmlElement | Y.XmlFragment): string {
  let out = ''
  for (const child of node.toArray()) {
    if (child instanceof Y.XmlText) out += textOf(child)
    else if (child instanceof Y.XmlElement) out += collectText(child)
  }
  return out
}

export function releaseAll() {
  for (const handle of handles.values()) handle.doc.destroy()
  handles.clear()
  loading.clear()
}
