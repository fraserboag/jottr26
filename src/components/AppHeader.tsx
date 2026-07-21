import { Check, CircleAlert, Cloud, LogOut, RefreshCw } from 'lucide-react';
import type { ComponentType } from 'react';
import { useSyncStatus } from '@/lib/syncStatus';
import type { SaveStatus } from '@/lib/useAutosave';
import styles from './AppHeader.module.css';

const SYNC_LABELS: Record<SaveStatus, string> = {
  synced: 'Synced',
  pending: 'Unsaved changes',
  saving: 'Saving…',
  error: 'Sync failed',
};

const SYNC_ICONS: Record<SaveStatus, ComponentType<{ size?: number }>> = {
  synced: Check,
  pending: Cloud,
  saving: RefreshCw,
  error: CircleAlert,
};

type AppHeaderProps = { onSignOut: () => void };

function AppHeader({ onSignOut }: AppHeaderProps) {
  const { status } = useSyncStatus();
  const SyncIcon = SYNC_ICONS[status];

  return (
    <header className={styles.header}>
      <h1>Jottr</h1>
      <div className={styles.actions}>
        <span className={styles.sync} data-status={status}>
          <SyncIcon size={14} />
          {SYNC_LABELS[status]}
        </span>
        <button type='button' className={styles.signOut} onClick={onSignOut}>
          <LogOut size={16} />
          Sign out
        </button>
      </div>
    </header>
  );
}

export default AppHeader;
