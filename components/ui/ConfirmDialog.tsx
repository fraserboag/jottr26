'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'

/** Mount when confirmation is needed. The modal keeps focus inside and makes
 *  the rest of the app inert until the action is confirmed or cancelled. */
export function ConfirmDialog({ title, description, confirmLabel, onConfirm, onClose }: {
  title: string
  description: string
  confirmLabel: string
  onConfirm: () => Promise<unknown>
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const running = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const id = useId()

  useEffect(() => {
    const modal = dialog.current!
    const previousFocus = document.activeElement
    // showModal supplies focus trapping and Escape handling.
    modal.showModal()
    cancel.current?.focus()
    return () => {
      modal.close()
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true })
      }
    }
  }, [])

  const confirm = async () => {
    if (running.current) return
    running.current = true
    setBusy(true)
    setError('')
    try {
      await onConfirm()
      onClose()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Something went wrong. Please try again.')
    } finally {
      running.current = false
      setBusy(false)
    }
  }

  return createPortal(
    <dialog
      ref={dialog}
      role="alertdialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault()
        if (!running.current) onClose()
      }}
      onKeyDown={(event) => event.stopPropagation()}
      className="pop-in pointer-events-auto fixed inset-0 m-auto max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-[360px] overflow-y-auto rounded-2xl border border-line bg-raised p-5 text-[14.5px] text-ink shadow-[var(--shadow-pop)] backdrop:bg-[var(--overlay)]"
    >
      <Icon name="alert" size={22} className="mb-3 text-danger" />
      <h2 id={`${id}-title`} className="text-base font-semibold break-words">{title}</h2>
      <p id={`${id}-description`} className="mt-2 leading-relaxed text-muted">{description}</p>
      {error && <p role="alert" className="mt-3 text-danger">{error}</p>}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button
          ref={cancel}
          type="button"
          disabled={busy}
          onClick={onClose}
          className="flex h-8 shrink-0 items-center justify-center rounded-md px-3 font-medium text-muted transition-colors hover:bg-[var(--hover)] hover:text-ink disabled:opacity-40"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void confirm()}
          className="flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md bg-sunken px-3 font-medium text-danger shadow-[var(--shadow-subtle)] transition-colors hover:bg-[var(--hover)] disabled:opacity-40"
        >
          {busy && <Icon name="refresh" size={14} className="animate-spin" />}
          {confirmLabel}
        </button>
      </div>
    </dialog>,
    document.body,
  )
}
