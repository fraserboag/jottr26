'use client'

import { Icon, type IconName } from '@/components/ui/Icon'

/** The square icon button both editor toolbars are built from. */
export function ToolButton({
  icon,
  label,
  active,
  disabled = false,
  onClick,
}: {
  icon: IconName
  label: string
  /** Left undefined for buttons that act rather than toggle, so they do not
   *  announce a pressed state they never have. */
  active?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      // Keeps focus in the page. Without it a tap moves focus to the button,
      // which on a phone drops the keyboard and the selection with it.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      // Tapping Bold on and straight off again is a double tap, which iOS
      // would otherwise take as a request to zoom the page.
      className={`grid size-8 shrink-0 touch-manipulation place-items-center rounded-md transition-colors disabled:pointer-events-none disabled:opacity-35 pointer-coarse:size-11 pointer-coarse:[&_svg]:size-[22px] ${
        // A filled chip rather than a tint of the icon alone, so what is
        // already on reads at a glance.
        active ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-[var(--hover)] hover:text-ink'
      }`}
    >
      <Icon name={icon} size={19} strokeWidth={active ? 2.1 : 1.8} />
    </button>
  )
}
