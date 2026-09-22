'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type * as Y from 'yjs'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import { Placeholder } from '@tiptap/extension-placeholder'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { TableKit } from '@tiptap/extension-table'
import { FinanceTable } from './extensions/finance'
import { JottrDocument, Title } from './extensions/title'
import { createSlashExtension, type SlashHandlers, type SlashItem } from './extensions/slash'
import { claimSlashBridge, releaseSlashBridge, slashHandlers } from './slashBridge'
import { SlashMenu, type SlashMenuState } from './SlashMenu'
import { FormatMenu } from './FormatMenu'
import { TableMenu } from './TableMenu'
import { openDoc, type DocHandle } from '@/lib/db/ydoc'
import { useDocReady } from '@/lib/db/hooks'
import { refreshDerived } from '@/lib/db/pages'
import { debounce } from '@/lib/util/debounce'
import { resolveLink } from '@/lib/util/links'
import { useOpenPageId } from '@/lib/util/route'

export function Editor({ pageId }: { pageId: string }) {
  // Keyed, so switching pages remounts with fresh state instead of clearing the
  // old document out from underneath the loader.
  return <Loader key={pageId} pageId={pageId} />
}

function Loader({ pageId }: { pageId: string }) {
  const [handle, setHandle] = useState<DocHandle | null>(null)
  // Read from IndexedDB rather than from the handle: a document that arrives
  // mid-wait has to flip this view over on its own, and a mutable field on a
  // plain object is something React cannot see change.
  const ready = useDocReady(pageId)

  useEffect(() => {
    let cancelled = false
    void openDoc(pageId).then((loaded) => {
      if (!cancelled) setHandle(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [pageId])

  if (!handle || ready === undefined) return <EditorSkeleton />

  if (!ready) {
    return (
      <div className="px-2 py-16 text-center">
        <p className="text-[13.5px] text-muted">Fetching this page…</p>
        <p className="mt-1 text-[12.5px] text-faint">
          It was written on another device and hasn&rsquo;t reached this one yet.
        </p>
      </div>
    )
  }

  // Keyed by page: each page is a separate Y.Doc, so it gets its own editor
  // instance rather than having its content swapped underneath it.
  return <Surface key={pageId} pageId={pageId} doc={handle.doc} />
}

function Surface({ pageId, doc }: { pageId: string; doc: Y.Doc }) {
  // Stable across renders, so the click handler below can be captured once
  // when the editor is built without going stale.
  const [, openPage] = useOpenPageId()
  const [slash, setSlash] = useState<SlashMenuState | null>(null)
  const slashRef = useRef<{ items: SlashItem[]; index: number; command: (item: SlashItem) => void }>({
    items: [],
    index: 0,
    command: () => {},
  })
  const move = useCallback((delta: number) => {
    const { items, index } = slashRef.current
    if (items.length === 0) return
    const next = (index + delta + items.length) % items.length
    slashRef.current.index = next
    setSlash((current) => (current ? { ...current, index: next } : current))
  }, [])

  useEffect(() => {
    const handlers: SlashHandlers = {
      onStart: (props) => {
        slashRef.current = { items: props.items, index: 0, command: props.command }
        setSlash({ items: props.items, index: 0, rect: props.clientRect?.() ?? null })
      },
      onUpdate: (props) => {
        const index = Math.min(slashRef.current.index, Math.max(0, props.items.length - 1))
        slashRef.current = { items: props.items, index, command: props.command }
        setSlash({ items: props.items, index, rect: props.clientRect?.() ?? null })
      },
      onKeyDown: ({ event }) => {
        if (slashRef.current.items.length === 0 && event.key !== 'Escape') return false
        if (event.key === 'ArrowDown') {
          move(1)
          return true
        }
        if (event.key === 'ArrowUp') {
          move(-1)
          return true
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          const item = slashRef.current.items[slashRef.current.index]
          if (!item) return false
          slashRef.current.command(item)
          return true
        }
        if (event.key === 'Escape') {
          setSlash(null)
          return true
        }
        return false
      },
      onExit: () => setSlash(null),
    }
    claimSlashBridge(handlers)
    return () => releaseSlashBridge(handlers)
  })

  const syncTitle = useMemo(
    () => debounce(() => void refreshDerived(pageId), 400),
    [pageId],
  )
  useEffect(() => () => syncTitle.flush(), [syncTitle])

  const editor = useEditor(
    {
      // The editor is mounted by a client-only dynamic import, but Tiptap still
      // wants this off so React 19 never renders it during hydration.
      immediatelyRender: false,
      extensions: [
        JottrDocument,
        Title,
        StarterKit.configure({
          document: false,
          // Collaboration brings its own Yjs-aware undo stack. Keeping
          // ProseMirror's would undo other devices' edits along with yours.
          undoRedo: false,
          // StarterKit brings Heading unless this is exactly false. Section
          // headings here are bold body text, not their own block.
          heading: false,
          link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer' } },
          codeBlock: { HTMLAttributes: { spellcheck: 'false' } },
        }),
        TaskList,
        TaskItem.configure({ nested: true }),
        // Rows, cells and headers come from the kit; the table node itself is
        // the finance-aware one, so its extra attribute and plugin are in the
        // schema from the start.
        TableKit.configure({ table: false }),
        FinanceTable.configure({
          resizable: true,
          // Dragging writes a colwidth onto one column only, so the rest stay
          // unsized and the table keeps filling the page. It pins to an exact
          // width just once every column has been dragged, which by then is
          // what was asked for.
          cellMinWidth: 40,
          // Only reaches serialised HTML: while the editor is editable the
          // resizing plugin renders the table through TableView, which brings
          // the wrapper the sideways scroll hangs off.
          renderWrapper: true,
        }),
        Collaboration.configure({ document: doc }),
        Placeholder.configure({
          // Shown on every empty node so the title always reads 'Untitled',
          // while body placeholders appear only where the caret is.
          showOnlyCurrent: false,
          emptyNodeClass: 'is-empty',
          placeholder: ({ editor: instance, node, hasAnchor }) => {
            if (node.type.name === 'title') return 'Untitled'
            if (!hasAnchor) return ''
            // Every cell holds an empty paragraph, and prompting in each one
            // would fill the grid with the same sentence.
            if (instance.isActive('table')) return ''
            if (node.type.name === 'paragraph') return "Write something, or press '/' for blocks"
            return ''
          },
        }),
        createSlashExtension(slashHandlers),
      ],
      editorProps: {
        attributes: {
          spellcheck: 'true',
          autocapitalize: 'sentences',
          'aria-label': 'Page content',
        },
        // An anchor inside a contenteditable does nothing on its own, so
        // following a link is this handler's job.
        handleClick: (_view, _pos, event) => {
          // A held modifier or a middle click is the browser being asked for a
          // tab or a window explicitly; the anchor's href is real, so letting
          // it through does the right thing for internal links too.
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
            return false
          }
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
      onUpdate: () => syncTitle(),
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

  if (!editor) return <EditorSkeleton />

  return (
    <>
      <EditorContent editor={editor} />
      <FormatMenu editor={editor} />
      <TableMenu editor={editor} />
      {slash && (
        <SlashMenu
          state={slash}
          onSelect={(item) => slashRef.current.command(item)}
          onHover={(index) => {
            slashRef.current.index = index
            setSlash((current) => (current ? { ...current, index } : current))
          }}
        />
      )}
    </>
  )
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
