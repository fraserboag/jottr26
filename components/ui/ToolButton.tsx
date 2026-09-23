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
      className={`grid size-7 shrink-0 place-items-center rounded-md transition-colors hover:bg-[var(--hover)] disabled:pointer-events-none disabled:opacity-35 pointer-coarse:size-10 pointer-coarse:[&_svg]:size-[18px] ${
        active ? 'text-accent' : 'text-muted'
      }`}
    >
      <Icon name={icon} size={15} strokeWidth={active ? 2.1 : 1.8} />
    </button>
  )
}
