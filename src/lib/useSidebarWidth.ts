import { useEffect, useState } from 'react';

// Device-local, not synced: sidebar width is a per-device view preference,
// so it deliberately lives in localStorage rather than Firestore.
const STORAGE_KEY = 'jottr:sidebar-width';

export const DEFAULT_SIDEBAR_WIDTH = 256;
export const MIN_SIDEBAR_WIDTH = 180;
export const MAX_SIDEBAR_WIDTH = 480;

export function clampSidebarWidth(width: number) {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(width)));
}

function loadWidth(): number {
  try {
    const stored = Number(localStorage.getItem(STORAGE_KEY));
    return stored ? clampSidebarWidth(stored) : DEFAULT_SIDEBAR_WIDTH;
  } catch {
    return DEFAULT_SIDEBAR_WIDTH;
  }
}

export function useSidebarWidth() {
  const [sidebarWidth, setSidebarWidth] = useState(loadWidth);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(sidebarWidth));
    } catch {
      // Ignore write failures (Safari private mode, quota).
    }
  }, [sidebarWidth]);

  return [sidebarWidth, setSidebarWidth] as const;
}
