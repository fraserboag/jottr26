/** The Jottr mark: the same drawing as `app/icon.svg`, inline so it paints with
 *  the page and stays sharp at any size. Sized by `className`. Decorative: it
 *  always sits beside the name, which carries the meaning. */
export function Logo({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" className={`shrink-0 ${className}`} aria-hidden="true">
      <rect width="512" height="512" rx="120" fill="#1a1a19" />
      <rect x="102" y="128" width="308" height="42" rx="21" fill="#ffffff" />
      <rect x="102" y="231" width="236" height="42" rx="21" fill="#ffffff" opacity="0.72" />
      <rect x="102" y="334" width="154" height="42" rx="21" fill="#6e9cff" />
    </svg>
  )
}
