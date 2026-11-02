'use client'

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon, type IconName } from '@/components/ui/Icon'
import { activeDatabase } from '@/lib/db/dexie'
import type { EditedTimes } from '@/lib/db/editedAt'
import { createPage, toggleFavorite, trashPage } from '@/lib/db/pages'
import type { PageRow } from '@/lib/db/schema'
import { searchWorkspace, type SearchTexts } from '@/lib/db/search'
import { observeSearchIndex } from '@/lib/db/searchText'
import type { View } from '@/lib/util/route'
import { scrollIntoList } from '@/lib/util/scroll'
import { raiseKeyboard } from '@/lib/util/keyboard'
import { setTheme, useTheme, type Theme } from '@/lib/util/theme'
import { filterCommands, lastDeletedPage, paletteCommands, parsePaletteQuery, type PaletteCommand, type PaletteMode } from './commands'
import { useNoteWorkspaces } from './NoteWorkspacesContext'
import { ancestors } from './pageTrail'
import { useRestoreTrashedPage } from './TrashPage'

type PaletteRow = {
  id: string
  label: string
  description?: string
  icon: IconName
} & (
  | { kind: 'command'; command: PaletteCommand }
  | { kind: 'page'; page: PageRow }
  | { kind: 'space'; spaceId: string }
  | { kind: 'theme'; theme: Theme }
)

const NO_TEXTS: SearchTexts = new Map()
const NO_TIMES: EditedTimes = new Map()
const MAX_RESULTS = 3
const THEMES: { value: Theme; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
]

/** Mounted only while open: body text and edit times stay out of startup. */
export function CommandPalette({ pages, page, trashedPages, onOpen, onOpenView, onEmptyTrash, onClose }: {
  pages: PageRow[]
  page: PageRow | null
  trashedPages: PageRow[]
  onOpen: (id: string) => void
  onOpenView: (view: View) => void
  onEmptyTrash: () => void
  onClose: () => void
}) {
  const { active: spaces, selectedId, select, inline, setInline } = useNoteWorkspaces()
  const restore = useRestoreTrashedPage()
  const theme = useTheme()
  const [choosingTheme, setChoosingTheme] = useState(false)
  const [mode, setMode] = useState<PaletteMode>('notes')
  const [query, setQuery] = useState('')
  const searchQuery = query.trim()
  const showResults = choosingTheme || searchQuery.length > 0
  const [index, setIndex] = useState(0)
  const [texts, setTexts] = useState(NO_TEXTS)
  const [edited, setEdited] = useState(NO_TIMES)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const running = useRef(false)
  const restoreFocus = useRef(true)
  const pointer = useRef({ x: -1, y: -1 })
  const id = useId()
  const spaceName = spaces.find((space) => space.id === selectedId)?.name ?? ''
  const byId = useMemo(() => new Map(pages.map((row) => [row.id, row])), [pages])
  const lastDeleted = useMemo(() => lastDeletedPage(trashedPages), [trashedPages])

  useLayoutEffect(() => {
    const modal = dialog.current!
    const previousFocus = document.activeElement
    // On phones the keyboard shrinks the visual viewport while the layout
    // viewport (and often dvh) still reaches underneath it.
    const viewport = window.visualViewport
    const place = () => {
      modal.style.setProperty('--palette-viewport-top', `${viewport?.offsetTop ?? 0}px`)
      modal.style.setProperty('--palette-viewport-height', `${viewport?.height ?? window.innerHeight}px`)
    }
    place()
    viewport?.addEventListener('resize', place)
    viewport?.addEventListener('scroll', place)
    window.addEventListener('resize', place)
    modal.showModal()
    input.current?.focus({ preventScroll: true })
    return () => {
      viewport?.removeEventListener('resize', place)
      viewport?.removeEventListener('scroll', place)
      window.removeEventListener('resize', place)
      modal.close()
      if (restoreFocus.current && previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true })
      }
    }
  }, [])

  useEffect(() => {
    const db = activeDatabase()
    if (!db) return
    const subscription = observeSearchIndex(db).subscribe({
      next: ({ texts, edited }) => {
        setTexts(texts)
        setEdited(edited)
      },
      error: () => {}, // Titles and commands remain available if the index cannot be read.
    })
    return () => subscription.unsubscribe()
  }, [])

  const commands = useMemo(() => mode === 'commands' && searchQuery ? filterCommands(paletteCommands(page, spaceName, { trashCount: trashedPages.length, inline, lastDeleted }), searchQuery).slice(0, MAX_RESULTS) : [], [page, spaceName, trashedPages.length, inline, lastDeleted, searchQuery, mode])
  const hits = useMemo(() => mode === 'notes' ? searchWorkspace(pages, spaces, searchQuery, texts, edited, MAX_RESULTS) : [], [pages, spaces, searchQuery, texts, edited, mode])
  const rows: PaletteRow[] = (choosingTheme ? THEMES
    .filter((option) => option.label.toLowerCase().includes(searchQuery.toLowerCase()))
    .map((option): PaletteRow => ({
      kind: 'theme', id: `theme:${option.value}`, theme: option.value,
      label: option.label, icon: 'settings',
      description: option.value === theme ? 'Current theme' : option.value === 'system' ? 'Follow your device’s appearance' : undefined,
    })) : [
    ...commands.map((command): PaletteRow => ({ ...command, kind: 'command', command })),
    ...hits.map((hit): PaletteRow => {
      if (hit.kind === 'space') {
        const { space } = hit
        return {
          kind: 'space', id: `space:${space.id}`, spaceId: space.id,
          label: space.name, icon: 'panel',
          description: space.id === selectedId ? 'Current space' : 'Space',
        }
      }
      const { page: found, snippet } = hit
      const space = spaces.find((space) => space.id === found.workspaceId)?.name
      const path = [space, ...ancestors(byId, found).reverse().map((parent) => parent.title || 'Untitled')].filter(Boolean).join(' / ')
      return {
        kind: 'page', id: `page:${found.id}`, page: found,
        label: found.title || 'Untitled', icon: 'file',
        description: snippet ? `${path ? `${path} — ` : ''}${snippet}` : path,
      }
    }),
  ]).slice(0, MAX_RESULTS)
  const selected = Math.min(index, rows.length - 1)
  const selectedRowId = rows[selected]?.id

  useEffect(() => {
    const container = list.current
    const option = container?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (container && option) scrollIntoList(container, option)
  }, [selectedRowId])

  const close = (returnFocus = true) => {
    restoreFocus.current = returnFocus
    // Release the modal before navigating so the next editor can take focus.
    dialog.current?.close()
    onClose()
  }

  const prepareNewPage = () => {
    const modal = dialog.current
    if (!modal || !window.matchMedia('(pointer: coarse)').matches) return
    // Release the modal and focus the stand-in inside the tap itself. It
    // keeps the keyboard up through IndexedDB and the sidebar's closing slide.
    restoreFocus.current = false
    modal.close()
    raiseKeyboard()
  }

  const choose = async (row: PaletteRow) => {
    if (running.current) return
    if (row.kind === 'page') {
      close(false)
      onOpen(row.page.id)
      return
    }

    running.current = true
    setBusy(true)
    setError('')
    try {
      if (row.kind === 'space') {
        await select(row.spaceId)
        close(false)
        return
      }
      if (row.kind === 'theme') {
        setTheme(row.theme)
        close()
        return
      }
      switch (row.command.id) {
        case 'new-page': {
          prepareNewPage()
          const pageId = await createPage({ workspaceId: selectedId })
          close(false)
          onOpen(pageId)
          break
        }
        case 'new-subpage': {
          if (!page) break
          prepareNewPage()
          const pageId = await createPage({ parentId: page.id })
          close(false)
          onOpen(pageId)
          break
        }
        case 'favorite':
          if (!page) break
          await toggleFavorite(page.id)
          close()
          break
        case 'trash-page':
          if (!page) break
          await trashPage(page.id)
          close(false)
          break
        case 'empty-trash':
          close()
          onEmptyTrash()
          break
        case 'toggle-spaces':
          await setInline(!inline)
          close()
          break
        case 'restore-last-deleted':
          if (lastDeleted && await restore(lastDeleted)) close()
          break
        case 'theme':
          setChoosingTheme(true)
          setQuery('')
          setIndex(0)
          break
        case 'settings':
        case 'trash':
          close(false)
          onOpenView(row.command.id)
          break
      }
    } catch (error) {
      const modal = dialog.current
      if (modal && !modal.open) {
        restoreFocus.current = true
        modal.showModal()
        input.current?.focus({ preventScroll: true })
      }
      setError(error instanceof Error ? error.message : 'Could not run this command. Please try again.')
    } finally {
      running.current = false
      setBusy(false)
    }
  }

  return createPortal(
    <dialog
      ref={dialog}
      data-command-palette
      aria-label="Command palette"
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault()
        if (!running.current) close()
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget || running.current) return
        const bounds = event.currentTarget.getBoundingClientRect()
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close()
      }}
      onKeyDown={(event) => event.stopPropagation()}
      className="command-palette pop-in fixed inset-x-0 bottom-auto mx-auto my-0 max-w-[560px] flex-col overflow-hidden rounded-xl border border-line bg-raised p-0 text-ink shadow-[var(--shadow-pop)] backdrop:bg-[var(--overlay)] open:flex"
    >
      <div className={`flex shrink-0 items-center gap-2.5 px-3 py-2.5 pointer-coarse:gap-3${showResults || error ? ' border-b border-line' : ''}`}>
        <Icon name={busy ? 'refresh' : choosingTheme ? 'settings' : mode === 'commands' ? 'forwardSlash' : 'search'} size={19} className={`text-faint pointer-coarse:hidden${busy ? ' animate-spin' : ''}`} />
        {/* The icon takes 20px of layout space; its invisible tap area is 44px.
            The touch gap keeps that area clear of the input text. */}
        <button
          type="button"
          aria-label={choosingTheme ? 'Back to commands' : 'Command mode'}
          aria-pressed={choosingTheme ? undefined : mode === 'commands'}
          title={choosingTheme ? 'Back to commands' : mode === 'commands' ? 'Search notes and spaces' : 'Search commands'}
          disabled={busy}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (running.current) return
            if (choosingTheme) {
              setChoosingTheme(false)
              setQuery('')
            } else {
              setMode(mode === 'notes' ? 'commands' : 'notes')
            }
            setIndex(0)
            setError('')
            input.current?.focus({ preventScroll: true })
          }}
          className={`relative hidden size-5 shrink-0 touch-manipulation place-items-center rounded-md transition-colors after:absolute after:-inset-3 after:content-[''] hover:bg-[var(--hover)] disabled:opacity-40 pointer-coarse:grid ${mode === 'commands' ? 'bg-[var(--selected)] text-muted' : 'text-faint'}`}
        >
          <Icon name={busy ? 'refresh' : choosingTheme ? 'arrowLeft' : mode === 'commands' ? 'forwardSlash' : 'search'} size={18} className={busy ? 'animate-spin' : ''} />
        </button>
        <input
          ref={input}
          role="combobox"
          aria-label={choosingTheme ? 'Choose theme' : mode === 'commands' ? 'Search commands' : 'Search notes and spaces'}
          aria-autocomplete="list"
          aria-expanded={showResults}
          aria-controls={showResults ? `${id}-results` : undefined}
          aria-activedescendant={selectedRowId ? `${id}-option-${selected}` : undefined}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          readOnly={busy}
          value={query}
          placeholder={choosingTheme ? 'Choose a theme…' : mode === 'commands' ? 'New page, restore, theme…' : 'Search notes or spaces, / for commands'}
          onChange={(event) => {
            if (mode === 'notes') {
              const next = parsePaletteQuery(event.target.value)
              setMode(next.mode)
              setQuery(next.text)
            } else {
              setQuery(event.target.value)
            }
            setIndex(0)
            setError('')
          }}
          onKeyDown={(event) => {
            if (busy || event.nativeEvent.isComposing || event.keyCode === 229) return
            if (event.key === 'Backspace' && query.length === 0) {
              event.preventDefault()
              if (choosingTheme) {
                setChoosingTheme(false)
                setIndex(0)
                setError('')
              } else if (mode === 'commands') {
                setMode('notes')
                setIndex(0)
                setError('')
              } else {
                close()
              }
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              const step = event.key === 'ArrowDown' ? 1 : -1
              setIndex(rows.length ? (selected + step + rows.length) % rows.length : 0)
            } else if (event.key === 'Enter') {
              event.preventDefault()
              if (rows[selected]) void choose(rows[selected])
            }
          }}
          className="min-w-0 flex-1 bg-transparent py-1 text-[16px] outline-none placeholder:text-faint pointer-fine:text-[14.5px]"
        />
      </div>

      {error && <p role="alert" className="shrink-0 px-3.5 pt-3 text-danger">{error}</p>}
      {showResults && <div ref={list} id={`${id}-results`} role="listbox" aria-label={choosingTheme ? 'Themes' : mode === 'commands' ? 'Commands' : 'Notes and spaces'} className="scrollbar-none relative min-h-0 overflow-y-auto overscroll-contain p-1.5">
        {rows.length === 0 && <p role="status" className="px-2 py-7 text-center text-[13.5px] text-faint pointer-coarse:text-[14.5px]">No {choosingTheme ? 'themes' : mode === 'commands' ? 'commands' : 'notes or spaces'} match “{searchQuery}”.</p>}
        {rows.map((row, i) => (
          <div key={row.id} role="presentation">
            {row.kind !== 'command' && i === 0 && (
              <p role="presentation" className="px-2.5 pb-1.5 pt-2 text-[11.5px] font-semibold uppercase tracking-wide text-faint pointer-coarse:text-[12.5px]">
                {row.kind === 'theme' ? 'Themes' : 'Notes and spaces'}
              </p>
            )}
            <button
              id={`${id}-option-${i}`}
              type="button"
              role="option"
              aria-selected={i === selected}
              aria-disabled={busy}
              tabIndex={-1}
              onMouseDown={(event) => event.preventDefault()}
              onMouseMove={(event) => {
                const { clientX: x, clientY: y } = event
                if (x === pointer.current.x && y === pointer.current.y) return
                pointer.current = { x, y }
                if (!busy) setIndex(i)
              }}
              onClick={() => void choose(row)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors pointer-coarse:min-h-11 ${i === selected ? 'bg-[var(--active)]' : ''}`}
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-md border border-line bg-sunken text-muted">
                <Icon name={row.icon} size={14} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{row.label}</span>
                {row.description && <span className="block truncate text-[11.5px] text-faint pointer-coarse:text-[12.5px]" title={row.description}>{row.description}</span>}
              </span>
              {row.kind === 'page' && row.page.isFavorite === 1 && <Icon name="star" size={13} filled className="text-star" />}
              {row.kind === 'theme' && row.theme === theme && <Icon name="check" size={14} className="text-muted" />}
            </button>
          </div>
        ))}
      </div>}
    </dialog>,
    document.body,
  )
}
