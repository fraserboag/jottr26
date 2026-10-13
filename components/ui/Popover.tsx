'use client'

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'

type Align = 'start' | 'end' | 'center'

/** A small anchored panel: menus, pickers, the account card.
 *
 *  Rendered into a portal at fixed coordinates so it is never clipped by the
 *  sidebar's own scroll container, and flipped above the trigger when there is
 *  no room below. */
export function Popover({
  trigger,
  children,
  align = 'start',
  width = 220,
  className = '',
  label,
}: {
  trigger: (props: { open: boolean; toggle: () => void; ref: (node: HTMLElement | null) => void }) => ReactElement
  children: (close: () => void) => React.ReactNode
  align?: Align
  /** Pixels, or 'auto' to fit the content up to the window's width. */
  width?: number | 'auto'
  className?: string
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  // The anchor lives in state rather than a ref: it is read while positioning
  // the panel, and a callback ref keeps that read out of the render pass.
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => setOpen(false), [])
  const toggle = useCallback(() => setOpen((value) => !value), [])

  useLayoutEffect(() => {
    if (!open || !anchor) return

    // Placing runs on every scroll anywhere on the page while the panel is
    // open; a position that has not moved keeps the same object, so React
    // skips the render.
    const moveTo = (top: number, left: number) =>
      setPosition((current) => (current?.top === top && current.left === left ? current : { top, left }))

    const place = () => {
      const rect = anchor.getBoundingClientRect()
      const height = panelRef.current?.offsetHeight ?? 240
      const panelWidth = width === 'auto' ? (panelRef.current?.offsetWidth ?? 220) : width
      const margin = 8

      let top = rect.bottom + 6
      if (top + height > window.innerHeight - margin) top = rect.top - height - 6
      if (top < margin) top = Math.min(rect.bottom + 6, window.innerHeight - height - margin)

      let left =
        align === 'end'
          ? rect.right - panelWidth
          : align === 'center'
            ? rect.left + rect.width / 2 - panelWidth / 2
            : rect.left
      left = Math.min(Math.max(margin, left), window.innerWidth - panelWidth - margin)

      moveTo(Math.max(margin, top), left)
    }

    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, anchor, align, width])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (panelRef.current?.contains(target) || anchor?.contains(target)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, anchor])

  return (
    <>
      {trigger({ open, toggle, ref: setAnchor })}
      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            aria-label={label}
            style={{
              top: position?.top ?? -9999,
              left: position?.left ?? -9999,
              width: width === 'auto' ? 'max-content' : width,
              maxWidth: 'calc(100vw - 16px)',
              visibility: position ? 'visible' : 'hidden',
            }}
            className={`pop-in fixed z-50 overflow-hidden rounded-xl border border-line bg-raised p-1 text-[13.5px] shadow-[var(--shadow-subtle)] pointer-coarse:text-[15px] ${className}`}
          >
            {children(close)}
          </div>,
          document.body,
        )}
    </>
  )
}

export function MenuItem({
  children,
  onClick,
  tone = 'default',
  icon,
  checked,
}: {
  children: React.ReactNode
  onClick: () => void
  tone?: 'default' | 'danger'
  icon?: React.ReactNode
  checked?: boolean
}) {
  return (
    <button
      type="button"
      role={checked === undefined ? 'menuitem' : 'menuitemradio'}
      aria-checked={checked}
      onClick={onClick}
      className={`flex w-full cursor-default items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors pointer-coarse:py-2.5 hover:bg-[var(--hover)] focus-visible:bg-[var(--hover)] focus:outline-none ${
        tone === 'danger' ? 'text-danger' : 'text-ink'
      }`}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {checked !== undefined && (
        <span className="grid size-4 shrink-0 place-items-center text-muted">
          {checked && <Icon name="check" size={14} />}
        </span>
      )}
    </button>
  )
}

export function MenuSeparator() {
  return <div className="my-1 h-px bg-line" />
}
