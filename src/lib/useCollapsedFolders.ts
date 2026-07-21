import { useEffect, useState } from 'react';

// Device-local, not synced: collapsed/expanded state is a per-device view
// preference, so it deliberately lives in localStorage rather than Firestore.
const STORAGE_KEY = 'jottr:collapsed-folders';

function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

export function useCollapsedFolders() {
  const [collapsedFolderIds, setCollapsedFolderIds] =
    useState<Set<string>>(loadCollapsed);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...collapsedFolderIds]));
    } catch {
      // Ignore write failures (Safari private mode, quota).
    }
  }, [collapsedFolderIds]);

  return [collapsedFolderIds, setCollapsedFolderIds] as const;
}
