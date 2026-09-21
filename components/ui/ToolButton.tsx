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
      onClick={onClick}
      className={`grid size-7 place-items-center rounded-md transition-colors hover:bg-[var(--hover)] disabled:pointer-events-none disabled:opacity-35 ${
        active ? 'text-accent' : 'text-muted'
      }`}
    >
      <Icon name={icon} size={15} strokeWidth={active ? 2.1 : 1.8} />
    </button>
  )
}
