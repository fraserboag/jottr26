import Dexie from 'dexie'
import * as Y from 'yjs'
import { activeDatabase, closedByApp, type JottrDB } from './dexie'
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
/** Documents of pages dropped from this device, which must not write again. */
const forgotten = new WeakSet<Y.Doc>()
const loading = new Map<string, Promise<DocHandle>>()
/** Bumped by releaseAll, so a load that was running when the account signed
 *  out knows not to hand back a document tied to the closed database. */
let generation = 0
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

/** The snapshot and every delta row, read in one transaction. Read apart, a
 *  compaction in another tab could land between them and hand back the old
 *  snapshot with none of the rows it has just folded into the new one. */
async function readFromDisk(db: JottrDB, pageId: string) {
  return db.transaction('r', db.docStates, db.docUpdates, async () => {
    const state = await db.docStates.get(pageId)
    const updates = await db.docUpdates.where('pageId').equals(pageId).sortBy('seq')
    return { state, updates }
  })
}

async function loadFromDisk(db: JottrDB, pageId: string, doc: Y.Doc, origin: symbol = LOAD_ORIGIN) {
  const { state, updates } = await readFromDisk(db, pageId)

  // Outside any transaction the caller holds (a compaction does), so an
  // observer on the document that touches the database is not pulled into it.
  Dexie.ignoreTransaction(() =>
    doc.transact(() => {
      if (state?.snapshot?.byteLength) Y.applyUpdate(doc, state.snapshot, origin)
      for (const row of updates) Y.applyUpdate(doc, row.update, origin)
    }, origin),
  )

  return { state, deltaCount: updates.length }
}

/** Bring an open document up to what is on disk. Tabs share the disk but not
 *  their documents, and the disk also takes rows this tab never applied: a
 *  pull the leader tab wrote, or another tab's edit whose relay was missed.
 *  Anything that treats this tab's copy as the whole page — a push, a
 *  compaction — has to read those in first, or it throws them away. Applied
 *  as a peer edit, since it is already stored. */
async function catchUp(db: JottrDB, pageId: string, doc: Y.Doc) {
  await loadFromDisk(db, pageId, doc, PEER_ORIGIN)
}

export async function refreshFromDisk(handle: DocHandle) {
  const db = activeDatabase()
  if (db) await catchUp(db, handle.pageId, handle.doc)
}

/** One compaction at a time per page: two crossing the threshold together would
 *  both rewrite the snapshot and both clear the delta table. */
const compacting = new Set<string>()

/** False when another compaction of the page was already running. */
async function compact(db: JottrDB, pageId: string, doc: Y.Doc) {
  if (compacting.has(pageId)) return false
  compacting.add(pageId)
  try {
    await compactNow(db, pageId, doc)
    return true
  } finally {
    compacting.delete(pageId)
  }
}

/** The whole document goes back as a single delta row, not into the doc
 *  state row's snapshot. That row is rewritten on every keystroke to count
 *  the edit, and holding the document it made each keystroke a write of the
 *  whole page. Any snapshot an older build left there is folded in and
 *  cleared. Both builds read a page as its snapshot plus every row, so either
 *  can read what the other wrote. */
async function compactNow(db: JottrDB, pageId: string, doc: Y.Doc) {
  await db.transaction('rw', db.docStates, db.docUpdates, async () => {
    // Caught up and encoded inside the transaction, so it covers every delta
    // row the delete below can reach, including ones this tab never applied.
    // A row written after it opened waits until this commits.
    await catchUp(db, pageId, doc)
    const update = Y.encodeStateAsUpdate(doc)
    await db.docUpdates.where('pageId').equals(pageId).delete()
    await db.docUpdates.add({ pageId, update })
    const existing = await db.docStates.get(pageId)
    if (existing?.snapshot?.byteLength) await db.docStates.put({ ...existing, snapshot: new Uint8Array() })
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

/** The write the update listener started last. Set synchronously inside
 *  Y.applyUpdate, so applyRemoteUpdate can wait on the one its update began. */
let latestWrite: Promise<void> | null = null

export async function whenPersisted() {
  while (persisting.size > 0) await Promise.all(persisting)
}

/** Pages with an edit in memory that failed to reach the disk (a full disk,
 *  most likely), and why. Until it is saved the edit is not marked dirty, so
 *  nothing would push it, and a status of "synced" would be a lie. */
const unsaved = new Map<string, string>()
const resaveTimers = new Map<string, ReturnType<typeof setTimeout>>()
const saveListeners = new Set<() => void>()
const RESAVE_MS = 5_000

/** Called whenever a page starts or stops having an unsaved edit. */
export function onSaveFailure(listener: () => void) {
  saveListeners.add(listener)
  return () => saveListeners.delete(listener)
}

/** Why an edit could not be saved on this device, or null if every edit was. */
export function saveFailure(): string | null {
  return unsaved.values().next().value ?? null
}

export function unsavedPages(): string[] {
  return [...unsaved.keys()]
}

function markUnsaved(db: JottrDB, handle: DocHandle, error: unknown) {
  const { pageId } = handle
  unsaved.set(pageId, error instanceof Error ? error.message : String(error))
  for (const listener of saveListeners) listener()
  // Retried on its own as well as on the next edit, since the edit that
  // failed may have been the last one.
  if (resaveTimers.has(pageId)) return
  resaveTimers.set(
    pageId,
    setTimeout(() => {
      resaveTimers.delete(pageId)
      if (!unsaved.has(pageId) || handles.get(pageId) !== handle || closedByApp(db)) return
      const retry = resave(db, handle).catch((error) => markUnsaved(db, handle, error))
      persisting.add(retry)
      void retry.finally(() => persisting.delete(retry))
    }, RESAVE_MS),
  )
}

/** Save the whole document after a delta failed to. A compaction writes it
 *  from memory, which still holds the lost edit, so this covers it without
 *  knowing which one it was. */
async function resave(db: JottrDB, handle: DocHandle) {
  if (!(await compact(db, handle.pageId, handle.doc))) {
    throw new Error('Could not save this page yet')
  }
  await patchDocState(db, handle.pageId, (current) => ({ dirty: 1, edits: current.edits + 1 }))
  unsaved.delete(handle.pageId)
  for (const listener of saveListeners) listener()
  notifyLocalEdit()
}

export async function openDoc(pageId: string, options?: { seed?: boolean }): Promise<DocHandle> {
  const existing = handles.get(pageId)
  if (existing) {
    if (options?.seed) seedDocument(existing.doc)
    return existing
  }

  const inFlight = loading.get(pageId)
  if (inFlight) {
    if (!options?.seed) return inFlight
    const handle = await inFlight
    seedDocument(handle.doc)
    return handle
  }

  const promise = (async (): Promise<DocHandle> => {
    const db = activeDatabase()
    if (!db) throw new Error('openDoc called before sign-in')

    const started = generation
    const doc = new Y.Doc({ gc: true })
    const { state, deltaCount } = await loadFromDisk(db, pageId, doc)
    // Saved by an older build, the whole document is still in the row every
    // edit rewrites. The first edit here moves it out. Not on opening: a
    // first sync opens every page.
    let snapshotInRow = Boolean(state?.snapshot?.byteLength)
    // Registered, it would be what this page opens to after signing back in,
    // and its writes, aimed at the closed database, would all be skipped.
    if (generation !== started) {
      doc.destroy()
      throw new Error('Signed out while the page was loading')
    }

    const handle: DocHandle = { pageId, doc, editedAt: 0 }
    let pending = deltaCount

    // Attached before anything else touches the document, so no edit — not even
    // the initial title and paragraph of a brand new page — can slip past
    // persistence.
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === LOAD_ORIGIN || origin === PEER_ORIGIN || forgotten.has(doc)) return

      const isLocal = origin !== REMOTE_ORIGIN
      if (isLocal) handle.editedAt = Date.now()

      // Persisted immediately, one small row per transaction. The user's work is
      // on disk before the next keystroke lands, whatever the network is doing.
      //
      // The database is the one this document was opened against, not whichever
      // is active when the write lands: an edit made just before signing out
      // must never end up in the next account's database.
      const write = (async () => {
        // Only a database this app closed, on signing out. One the browser
        // closed (iOS can, in the background, and so does a page put in the
        // back-forward cache), or another tab's upgrade closed, Dexie reopens
        // on this write, so it has to be tried: skipped, the edit was lost
        // while the status read synced.
        if (closedByApp(db)) return
        if (unsaved.has(pageId)) await resave(db, handle)
        await db.docUpdates.add({ pageId, update })
        pending += 1

        // Pulls too: only the leader tab pulls, and without this every other
        // tab showing the page would sit on the old text until a reload.
        broadcastUpdate(pageId, update)

        if (isLocal) {
          await patchDocState(db, pageId, (current) => ({ dirty: 1, edits: current.edits + 1 }))
          notifyLocalEdit()
        }

        if (pending >= COMPACT_THRESHOLD || (isLocal && snapshotInRow)) {
          pending = 0
          if (await compact(db, pageId, doc)) snapshotInRow = false
        }
      })().catch((error) => markUnsaved(db, handle, error))
      persisting.add(write)
      latestWrite = write
      void write.finally(() => persisting.delete(write))
    })

    if (options?.seed) seedDocument(doc)

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
 *  update listener persists it without marking the document dirty again.
 *
 *  Resolves once it is on disk: true, or false when the disk refused it. The
 *  page is then held as unsaved, and the server's version must not be
 *  recorded against it. If it were and the tab then closed, the disk would
 *  claim a version whose content it lacks, and the next push, accepted at
 *  that version, would erase the other device's edit from the server. */
export async function applyRemoteUpdate(pageId: string, update: Uint8Array): Promise<boolean> {
  if (!update.byteLength) return true
  const handle = await openDoc(pageId)
  latestWrite = null
  Y.applyUpdate(handle.doc, update, REMOTE_ORIGIN)
  // Null when the update held nothing new, which is then already stored.
  const written = latestWrite
  latestWrite = null
  await written
  return !unsaved.has(pageId)
}

/** Lets go of the documents of pages just dropped from this device. They are
 *  not destroyed, since an editor may still be showing one for a moment, but
 *  nothing more they receive is written, so no rows reappear for a page that
 *  is gone, and a failed save of one no longer counts as unsaved work. */
export function forgetDocs(pageIds: string[]) {
  let changed = false
  for (const pageId of pageIds) {
    const handle = handles.get(pageId)
    if (handle) forgotten.add(handle.doc)
    handles.delete(pageId)
    clearTimeout(resaveTimers.get(pageId))
    resaveTimers.delete(pageId)
    changed = unsaved.delete(pageId) || changed
  }
  if (changed) for (const listener of saveListeners) listener()
}

export function loadedDoc(pageId: string): DocHandle | undefined {
  return handles.get(pageId)
}

/** Relay deltas from sibling tabs into whichever documents are open here. One
 *  still loading gets it once loaded, whether or not its read of the disk
 *  already caught the row: applying an update twice changes nothing. */
onPeerUpdate(({ pageId, update }) => {
  const handle = handles.get(pageId)
  if (handle) {
    Y.applyUpdate(handle.doc, update, PEER_ORIGIN)
    return
  }
  loading.get(pageId)?.then(
    (loaded) => Y.applyUpdate(loaded.doc, update, PEER_ORIGIN),
    () => {},
  )
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
  generation += 1
  for (const timer of resaveTimers.values()) clearTimeout(timer)
  resaveTimers.clear()
  if (unsaved.size) {
    unsaved.clear()
    for (const listener of saveListeners) listener()
  }
  for (const handle of handles.values()) handle.doc.destroy()
  handles.clear()
  loading.clear()
}
