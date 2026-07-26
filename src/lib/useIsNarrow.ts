import { useEffect, useState } from 'react';

// Must stay in step with the media query in Sidebar.module.css — the sidebar's
// overlay layout is driven by CSS, while whether picking a note dismisses it is
// driven by this hook, and the two disagreeing would strand it open.
export const NARROW_QUERY = '(max-width: 40rem)';

export function useIsNarrow(): boolean {
  const [isNarrow, setIsNarrow] = useState(
    () => window.matchMedia(NARROW_QUERY).matches,
  );

  useEffect(() => {
    const query = window.matchMedia(NARROW_QUERY);
    const sync = () => setIsNarrow(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  return isNarrow;
}
