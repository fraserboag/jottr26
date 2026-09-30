'use client'

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type * as Y from 'yjs'
import type { Extensions } from '@tiptap/core'
import { EditorContent, ReactNodeViewRenderer, useEditor } from '@tiptap/react'
import Collaboration from '@tiptap/extension-collaboration'
import { Placeholder } from '@tiptap/extension-placeholder'
import { pageExtensions } from './extensions/page'
import { Subpages } from './extensions/subpages'
import { createSlashExtension } from './extensions/slash'
import { EmptyPageHint } from './extensions/emptyPageHint'
import { slashHandlers } from './slashBridge'
import { SlashMenu } from './SlashMenu'
import { useSlashMenu } from './useSlashMenu'
import { isListControl, SubpageList } from './SubpageList'
import { FormatMenu } from './FormatMenu'
import { MobileToolbar } from './MobileToolbar'
import { TableMenu } from './TableMenu'
import { openDoc, refreshFromDisk, type DocHandle } from '@/lib/db/ydoc'
import { convertChecklists } from '@/lib/db/checklists'
import { repairSubpageTitles } from '@/lib/db/subpages'
import { useDocReady } from '@/lib/db/hooks'
import { refreshDerived } from '@/lib/db/pages'
import { debounce } from '@/lib/util/debounce'
import { isPlainLeftClick, resolveLink } from '@/lib/util/links'
import { useOpenPageId } from '@/lib/util/route'
import { useCoarsePointer } from '@/lib/util/pointer'
import { afterPaint } from '@/lib/util/idle'
import { markStartup } from '@/lib/util/startupTiming'

markStartup('editor-code-ready')

/** Memoised: the workspace around it re-renders whenever the page list does,
 *  which while typing is every few hundred milliseconds, and none of that
 *  concerns the editor. */
export const Editor = memo(function Editor({ pageId }: { pageId: string }) {
  // Keyed, so switching pages remounts with fresh state instead of clearing the
  // old document out from underneath the loader.
  return <Loader key={pageId} pageId={pageId} />
})

function Loader({ pageId }: { pageId: string }) {
  const [handle, setHandle] = useState<DocHandle | null>(null)
  const [failure, setFailure] = useState<unknown>(null)
  // Read from IndexedDB rather than from the handle: a document that arrives
  // mid-wait has to flip this view over on its own, and a mutable field on a
  // plain object is something React cannot see change.
  const ready = useDocReady(pageId)

  useEffect(() => {
    let cancelled = false
    markStartup('document-load-start')
    openDoc(pageId)
      // A document this tab already had open moves on only through other
      // tabs' relays, which a suspended or back-forward cached tab misses, so
      // it is caught up with the disk before it is shown. Cheap when it is
      // already current; a failure leaves it as it was rather than unshown.
      .then((loaded) => refreshFromDisk(loaded).then(() => loaded, () => loaded))
      .then(
        (loaded) => {
          if (!cancelled) setHandle(loaded)
        },
        (error: unknown) => {
          if (!cancelled) setFailure(error ?? new Error('Could not open this page'))
        },
      )
    return () => {
      cancelled = true
    }
  }, [pageId])

  useEffect(() => {
    if (handle && ready) markStartup('document-ready')
  }, [handle, ready])

  // Thrown here, where EditorError can catch it: a rejection in the effect
  // would leave the skeleton up for good.
  if (failure) throw failure
  if (!handle || ready === undefined) return <EditorSkeleton />

  if (!ready) {
    return (
      <div className="px-2 py-16 text-center">
        <p className="text-muted">Fetching this page…</p>
        <p className="mt-1 text-[12.5px] text-faint pointer-coarse:text-[13.5px]">
          It was written on another device and hasn&rsquo;t reached this one yet.
        </p>
      </div>
    )
  }

  return <Surface pageId={pageId} doc={handle.doc} />
}

/** Everything the editor is built from, for one page's document. */
function editorExtensions(doc: Y.Doc, pageId: string): Extensions {
  return [
    ...pageExtensions({
      // The list's React view, which the shared list leaves out so it loads
      // under Node.
      subpages: Subpages.extend({
        addNodeView: () =>
          ReactNodeViewRenderer(SubpageList, {
            // The entries, headings and buttons are the list's own: a click
            // opens a page or adds one and a drag reorders, and
            // ProseMirror would read any of them as an edit to the
            // document. The block's own heading is written in like any other
            // line.
            stopEvent: ({ event }) => event.target instanceof Element && isListControl(event.target),
          }),
      }).configure({ pageId }),
    }),
    Collaboration.configure({ document: doc }),
    Placeholder.configure({
      // Shown on every empty node so the title always reads 'Untitled'. The
      // body's hint, only where the caret is, is EmptyPageHint's.
      showOnlyCurrent: false,
      // Looks inside blocks too, which is where an accordion's heading is.
      includeChildren: true,
      emptyNodeClass: 'is-empty',
      placeholder: ({ node }) => {
        if (node.type.name === 'title') return 'Untitled'
        // An empty heading would leave a chevron with nothing beside it.
        if (node.type.name === 'accordionTitle') return 'Title'
        return ''
      },
    }),
    EmptyPageHint,
    createSlashExtension(slashHandlers),
  ]
}

function Surface({ pageId, doc }: { pageId: string; doc: Y.Doc }) {
  // Stable across renders, so the click handler below can be captured once
  // when the editor is built without going stale.
  const [, openPage] = useOpenPageId()
  const coarse = useCoarsePointer()

  // Two timers, both mirroring the document onto the page row. A title edit
  // gets its own, so typing on into the body straight after naming a page
  // cannot hold the new name back from the sidebar until the typing stops.
  const syncTitle = useMemo(() => debounce(() => void refreshDerived(pageId), 400), [pageId])
  const syncBody = useMemo(() => debounce(() => void refreshDerived(pageId), 400), [pageId])
  useEffect(() => () => syncTitle.flush(), [syncTitle])
  useEffect(() => () => syncBody.flush(), [syncBody])
  const lastTitle = useRef<string | null>(null)
  // Before the editor binds to the page, which would delete any checkbox list
  // still in it outright, and any subpage list without its heading.
  useState(() => {
    convertChecklists(doc)
    repairSubpageTitles(doc)
  })

  const extensions = useMemo(() => editorExtensions(doc, pageId), [doc, pageId])

  const editor = useEditor(
    {
      // The editor is mounted by a client-only dynamic import, but Tiptap still
      // wants this off so React 19 never renders it during hydration.
      immediatelyRender: false,
      extensions,
      editorProps: {
        attributes: {
          spellcheck: 'true',
          autocapitalize: 'sentences',
          'aria-label': 'Page content',
        },
        // An anchor inside a contenteditable does nothing on its own, so
        // following a link is this handler's job.
        handleClick: (_view, _pos, event) => {
          if (!isPlainLeftClick(event)) return false
          const node = event.target
          const anchor = node instanceof HTMLElement ? node.closest('a[href]') : null
          if (!anchor) return false

          const target = resolveLink(anchor.getAttribute('href') ?? '', window.location.href)
          if (!target) return false

          event.preventDefault()
          if (target.kind === 'page') openPage(target.pageId)
          else window.open(target.href, '_blank', 'noopener,noreferrer')
          return true
        },
      },
      onUpdate: ({ editor: instance }) => {
        const title = instance.state.doc.firstChild?.textContent ?? ''
        if (title === lastTitle.current) return syncBody()
        lastTitle.current = title
        syncTitle()
      },
    },
    [doc],
  )

  useEffect(() => {
    if (!editor) return
    // A brand new page opens with the caret in the title, which is where
    // everyone starts typing anyway.
    const title = editor.state.doc.firstChild
    if (title && title.content.size === 0 && editor.state.doc.content.size <= 4) {
      editor.commands.focus('start')
    }
  }, [editor])

  useEffect(() => {
    if (!editor) return
    return afterPaint(() => markStartup('editor-painted'))
  }, [editor])

  if (!editor) return <EditorSkeleton />

  return (
    <>
      <EditorContent editor={editor} />
      {/* A floating bubble is the desktop's way to format; on a phone it sits
          where the system's own copy and paste callout does, so touch screens
          get a bar on top of the keyboard instead. */}
      {coarse ? (
        <MobileToolbar editor={editor} pageId={pageId} />
      ) : (
        <>
          <FormatMenu editor={editor} pageId={pageId} />
          <TableMenu editor={editor} />
          <DesktopSlashMenu />
        </>
      )}
    </>
  )
}

/** The desktop's / menu, against the caret. Its own component so that typing
 *  a filter into it re-renders the menu alone. */
function DesktopSlashMenu() {
  const { slash, pick, hover } = useSlashMenu()
  return slash && <SlashMenu state={slash} onSelect={pick} onHover={hover} />
}

function EditorSkeleton() {
  return (
    <div className="animate-pulse space-y-3 pt-1" aria-hidden="true">
      <div className="h-9 w-2/3 rounded-md bg-[var(--hover)]" />
      <div className="h-4 w-full rounded bg-[var(--hover)]" />
      <div className="h-4 w-11/12 rounded bg-[var(--hover)]" />
      <div className="h-4 w-4/6 rounded bg-[var(--hover)]" />
    </div>
  )
}
