'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type * as Y from 'yjs'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import { Placeholder } from '@tiptap/extension-placeholder'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { JottrDocument, Title } from './extensions/title'
import { createSlashExtension, type SlashHandlers, type SlashItem } from './extensions/slash'
import { claimSlashBridge, releaseSlashBridge, slashHandlers } from './slashBridge'
import { SlashMenu, type SlashMenuState } from './SlashMenu'
import { FormatMenu } from './FormatMenu'
import { openDoc, type DocHandle } from '@/lib/db/ydoc'
import { useDocReady } from '@/lib/db/hooks'
import { refreshDerived } from '@/lib/db/pages'
import { debounce } from '@/lib/util/debounce'

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
          heading: { levels: [1, 2, 3] },
          link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer' } },
          codeBlock: { HTMLAttributes: { spellcheck: 'false' } },
        }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Collaboration.configure({ document: doc }),
        Placeholder.configure({
          // Shown on every empty node so the title always reads 'Untitled',
          // while body placeholders appear only where the caret is.
          showOnlyCurrent: false,
          emptyNodeClass: 'is-empty',
          placeholder: ({ node, hasAnchor }) => {
            if (node.type.name === 'title') return 'Untitled'
            if (!hasAnchor) return ''
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
