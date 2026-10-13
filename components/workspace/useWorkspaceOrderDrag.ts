'use client'

import { useState, type DragEvent, type KeyboardEvent } from 'react'
import { reorderWorkspace } from '@/lib/db/workspaces'
import type { NoteWorkspaceRow } from '@/lib/db/schema'

const TYPE = 'application/x-jottr-workspace'

export function useWorkspaceOrderDrag(workspaces: NoteWorkspaceRow[], onError: (message: string) => void) {
  const [dragging, setDragging] = useState<string | null>(null)
  const [drop, setDrop] = useState<{ id: string; side: 'before' | 'after' } | null>(null)
  const move = (id: string, target: string, side: 'before' | 'after') => {
    void reorderWorkspace(id, target, side).catch((error: Error) => onError(error.message))
  }
  const position = (event: DragEvent<HTMLElement>) =>
    event.clientY < event.currentTarget.getBoundingClientRect().top + event.currentTarget.getBoundingClientRect().height / 2 ? 'before' as const : 'after' as const

  return {
    dragging,
    drop,
    step: (id: string, direction: 'up' | 'down') => {
      const index = workspaces.findIndex((row) => row.id === id)
      const target = workspaces[index + (direction === 'up' ? -1 : 1)]
      if (index >= 0 && target) move(id, target.id, direction === 'up' ? 'before' : 'after')
    },
    canStep: (id: string, direction: 'up' | 'down') => {
      const index = workspaces.findIndex((row) => row.id === id)
      return index >= 0 && (direction === 'up' ? index > 0 : index < workspaces.length - 1)
    },
    containerProps: (id: string) => ({
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (!event.dataTransfer.types.includes(TYPE)) return
        event.preventDefault()
        event.stopPropagation()
        event.dataTransfer.dropEffect = 'move'
        if (id === dragging) return
        const side = position(event)
        setDrop((current) => current?.id === id && current.side === side ? current : { id, side })
      },
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrop(null)
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        if (!event.dataTransfer.types.includes(TYPE)) return
        event.preventDefault()
        event.stopPropagation()
        const source = event.dataTransfer.getData(TYPE)
        if (source) move(source, id, position(event))
        setDragging(null)
        setDrop(null)
      },
    }),
    handleProps: (id: string) => ({
      draggable: workspaces.length > 1,
      onDragStart: (event: DragEvent<HTMLElement>) => {
        event.stopPropagation()
        event.dataTransfer.setData(TYPE, id)
        event.dataTransfer.effectAllowed = 'move'
        setDragging(id)
      },
      onDragEnd: () => { setDragging(null); setDrop(null) },
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        const index = workspaces.findIndex((row) => row.id === id)
        const target = event.key === 'ArrowUp' ? workspaces[index - 1] : event.key === 'ArrowDown' ? workspaces[index + 1] : undefined
        if (!target) return
        event.preventDefault()
        move(id, target.id, event.key === 'ArrowUp' ? 'before' : 'after')
      },
      'aria-label': `Reorder ${workspaces.find((row) => row.id === id)?.name ?? 'space'}`,
      title: 'Drag to reorder, or use the up and down arrow keys',
    }),
  }
}
