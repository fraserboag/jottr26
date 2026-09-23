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

type Align = 'start' | 'end' | 'center'
type Side = 'bottom' | 'top' | 'right'

/** A small anchored panel: menus, pickers, the account card.
 *
 *  Rendered into a portal at fixed coordinates so it is never clipped by the
 *  sidebar's own scroll container, and flipped above the trigger when there is
 *  no room below. A panel to the right sits level with the trigger and flips to
 *  its left when the window runs out. */
export function Popover({
  trigger,
  children,
  align = 'start',
  side = 'bottom',
  width = 220,
  className = '',
  role = 'menu',
  shadow = 'pop',
}: {
  trigger: (props: { open: boolean; toggle: () => void; ref: (node: HTMLElement | null) => void }) => ReactElement
  children: (close: () => void) => React.ReactNode
  align?: Align
  side?: Side
  /** Pixels, or 'auto' to fit the content up to the window's width. */
  width?: number | 'auto'
  className?: string
  role?: 'menu' | 'dialog'
  shadow?: 'pop' | 'soft'
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

    const place = () => {
      const rect = anchor.getBoundingClientRect()
      const height = panelRef.current?.offsetHeight ?? 240
      const panelWidth = width === 'auto' ? (panelRef.current?.offsetWidth ?? 220) : width
      const margin = 8

      if (side === 'right') {
        let left = rect.right + 6
        if (left + panelWidth > window.innerWidth - margin) left = rect.left - panelWidth - 6
        setPosition({ top: rect.top + rect.height / 2 - height / 2, left: Math.max(margin, left) })
        return
      }

      let top = side === 'bottom' ? rect.bottom + 6 : rect.top - height - 6
      if (top + height > window.innerHeight - margin) top = rect.top - height - 6
      if (top < margin) top = Math.min(rect.bottom + 6, window.innerHeight - height - margin)

      let left =
        align === 'end'
          ? rect.right - panelWidth
          : align === 'center'
            ? rect.left + rect.width / 2 - panelWidth / 2
            : rect.left
      left = Math.min(Math.max(margin, left), window.innerWidth - panelWidth - margin)

      setPosition({ top: Math.max(margin, top), left })
    }

    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, anchor, align, side, width])

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
            role={role}
            style={{
              top: position?.top ?? -9999,
              left: position?.left ?? -9999,
              width: width === 'auto' ? 'max-content' : width,
              maxWidth: 'calc(100vw - 16px)',
              visibility: position ? 'visible' : 'hidden',
            }}
            className={`fixed z-50 overflow-hidden rounded-xl border border-line bg-raised p-1 ${
              shadow === 'soft' ? 'shadow-[var(--shadow-soft)]' : 'shadow-[var(--shadow-pop)]'
            } ${className}`}
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
}: {
  children: React.ReactNode
  onClick: () => void
  tone?: 'default' | 'danger'
  icon?: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors pointer-coarse:py-2.5 hover:bg-[var(--hover)] ${
        tone === 'danger' ? 'text-danger' : 'text-ink'
      }`}
    >
      {icon}
      <span className="truncate">{children}</span>
    </button>
  )
}

export function MenuSeparator() {
  return <div className="my-1 h-px bg-line" />
}
