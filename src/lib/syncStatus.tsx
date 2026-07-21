import { createContext, useContext, useState, type ReactNode } from 'react';
import type { SaveStatus } from './useAutosave';

type SyncStatusValue = {
  status: SaveStatus;
  setStatus: (status: SaveStatus) => void;
};

const SyncStatusContext = createContext<SyncStatusValue | null>(null);

// Bridges the open note's autosave status up to the header, which sits
// outside the editor's subtree. Defaults to synced when nothing is being edited.
export function SyncStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SaveStatus>('synced');
  return (
    <SyncStatusContext.Provider value={{ status, setStatus }}>
      {children}
    </SyncStatusContext.Provider>
  );
}

export function useSyncStatus(): SyncStatusValue {
  const ctx = useContext(SyncStatusContext);
  if (!ctx) {
    throw new Error('useSyncStatus must be used within a SyncStatusProvider');
  }
  return ctx;
}
