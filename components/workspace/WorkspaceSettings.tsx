'use client'

import { useEffect, useRef, useState } from 'react'
import { createWorkspace, deleteWorkspace, updateWorkspace } from '@/lib/db/workspaces'
import type { NoteWorkspaceRow } from '@/lib/db/schema'
import { Icon } from '@/components/ui/Icon'
import { useNoteWorkspaces } from './NoteWorkspacesContext'
import { useWorkspaceOrderDrag } from './useWorkspaceOrderDrag'

const actionClass = 'flex h-8 shrink-0 items-center justify-center rounded-md px-2 text-[12.5px] font-medium text-muted transition-colors hover:bg-[var(--hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40 pointer-coarse:h-10 pointer-coarse:text-[13.5px]'
const nameInputClass = 'workspace-name-input mr-auto h-8 min-w-0 max-w-64 flex-1 cursor-text border-0 bg-transparent p-0 text-ink pointer-coarse:h-10'

export function WorkspaceSettings() {
  const { active } = useNoteWorkspaces()
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const ordering = useWorkspaceOrderDrag(active, setError)

  return (
    <section className="mt-10" aria-labelledby="workspaces-title">
      <h2 id="workspaces-title" className="page-title" style={{ marginBottom: '0.75rem' }}>Spaces</h2>
      <ul className="divide-y divide-line">
        {active.map((workspace) => <WorkspaceSetting key={workspace.id} workspace={workspace} canDelete={active.length > 1} ordering={ordering} />)}
        {adding && <NewWorkspaceSetting onClose={() => setAdding(false)} />}
      </ul>
      <button type="button" disabled={adding} onClick={() => setAdding(true)} className="mt-2 flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-sunken px-3 font-medium text-ink shadow-[var(--shadow-subtle)] transition-colors hover:bg-[var(--hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40 pointer-coarse:h-10"><Icon name="workspacePlus" size={14} />New space</button>
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
    </section>
  )
}

function NewWorkspaceSetting({ onClose }: { onClose: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  const saving = useRef(false)
  const [name, setName] = useState('New space')
  const [edited, setEdited] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])

  const save = async () => {
    if (saving.current) return
    if (!edited || !name.trim()) {
      onClose()
      return
    }
    saving.current = true
    setBusy(true)
    setError('')
    try {
      await createWorkspace(name)
      onClose()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Space creation failed.')
    } finally {
      saving.current = false
      setBusy(false)
    }
  }

  return (
    <li className="relative min-h-14 py-3 pointer-coarse:min-h-16">
      <div className="flex flex-wrap items-center gap-2">
        <span aria-hidden="true" className="w-5 shrink-0 pointer-coarse:w-6" />
        <input
          ref={input}
          aria-label="New space name"
          aria-invalid={!!error}
          aria-describedby={error ? 'new-workspace-error' : undefined}
          value={name}
          readOnly={busy}
          onChange={(event) => { setName(event.target.value); setEdited(true) }}
          onBlur={() => void save()}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || busy) return
            if (event.key === 'Enter') {
              event.preventDefault()
              event.currentTarget.blur()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              onClose()
            }
          }}
          maxLength={80}
          className={nameInputClass}
        />
      </div>
      {error && <p id="new-workspace-error" role="alert" className="mt-2 text-sm text-danger">{error}</p>}
    </li>
  )
}

function WorkspaceSetting({ workspace, canDelete, ordering }: { workspace: NoteWorkspaceRow; canDelete: boolean; ordering: ReturnType<typeof useWorkspaceOrderDrag> }) {
  const [name, setName] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const run = async (work: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    setError('')
    try { await work() } catch (error) { setError(error instanceof Error ? error.message : 'Space change failed.') }
    finally { setBusy(false) }
  }
  return (
    <li className={`relative min-h-14 py-3 pointer-coarse:min-h-16 ${ordering.dragging === workspace.id ? 'opacity-40' : ''}`} {...ordering.containerProps(workspace.id)}>
      {ordering.drop?.id === workspace.id && <span aria-hidden="true" className={`pointer-events-none absolute inset-x-0 h-0.5 bg-accent ${ordering.drop.side === 'before' ? 'top-0' : 'bottom-0'}`} />}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" {...ordering.handleProps(workspace.id)} disabled={busy} className="grid h-8 w-5 shrink-0 cursor-grab place-items-center rounded-md text-faint hover:bg-[var(--hover)] focus-visible:outline-2 focus-visible:outline-accent active:cursor-grabbing pointer-coarse:h-10 pointer-coarse:w-6"><Icon name="grip" size={15} strokeWidth={2.8} /></button>
        <input
          aria-label="Space name"
          aria-invalid={!!error}
          aria-describedby={error ? `workspace-${workspace.id}-error` : undefined}
          value={name ?? workspace.name}
          readOnly={busy}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => {
            if (name === null) return
            if (!name.trim()) {
              setName(null)
              setError('')
              return
            }
            void run(async () => {
              if (name.trim() !== workspace.name) await updateWorkspace(workspace.id, { name })
              setName(null)
            })
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault()
              event.currentTarget.blur()
            }
          }}
          maxLength={80}
          className={nameInputClass}
        />
        {canDelete && <span className="hidden shrink-0 gap-1 pointer-coarse:flex">
          {(['up', 'down'] as const).map((direction) => <button key={direction} type="button"
            disabled={busy || !ordering.canStep(workspace.id, direction)}
            aria-label={`Move ${workspace.name} ${direction}`}
            className={`${actionClass} w-10 touch-manipulation`}
            onClick={() => ordering.step(workspace.id, direction)}>
            <Icon name={direction === 'up' ? 'chevronUp' : 'chevronDown'} size={16} />
          </button>)}
        </span>}
        <button type="button" disabled={busy || !canDelete} aria-label={`Delete ${workspace.name}`} title={canDelete ? 'Delete space' : 'Keep at least one space'} className={`${actionClass} w-8 text-danger disabled:opacity-40 pointer-coarse:w-10`} onClick={() => void run(async () => {
          if (!window.confirm('Deleting this space will move all of its pages to Trash.')) return
          await deleteWorkspace(workspace.id)
        })}><Icon name="trash" size={16} /></button>
      </div>
      {error && <p id={`workspace-${workspace.id}-error`} role="alert" className="mt-2 text-sm text-danger">{error}</p>}
    </li>
  )
}
