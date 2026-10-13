'use client'

/** Shared by the Settings controls so their spacing and selected state match. */
export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  const optionClassName = (optionValue: T) =>
    `rounded-[5px] px-2 py-0.5 text-[12.5px] font-medium transition-colors pointer-coarse:py-1 pointer-coarse:text-[13.5px] ${
      value === optionValue ? 'bg-[var(--selected)] text-ink' : 'text-muted hover:bg-[color-mix(in_srgb,var(--selected)_50%,transparent)] hover:text-ink'
    }`

  if (options.length === 2) {
    const selectedOption = options.find((option) => option.value === value)
    const nextOption = options.find((option) => option.value !== value)!

    return (
      <button
        type="button"
        aria-label={`${label}: ${selectedOption?.label ?? value}`}
        onClick={() => onChange(nextOption.value)}
        className="flex shrink-0 cursor-pointer rounded-md border border-line p-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {options.map((option) => (
          <span key={option.value} aria-hidden="true" className={optionClassName(option.value)}>
            {option.label}
          </span>
        ))}
      </button>
    )
  }

  return (
    <div role="group" aria-label={label} className="flex shrink-0 rounded-md border border-line p-px">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`${optionClassName(option.value)} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
