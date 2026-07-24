import { Check, CircleAlert, Cloud, RefreshCw } from 'lucide-react';
import type { ComponentType } from 'react';
import { useSyncStatus } from '@/lib/syncStatus';
import type { SaveStatus } from '@/lib/useAutosave';
import styles from './SyncPill.module.css';

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

function SyncPill() {
  const { status } = useSyncStatus();
  const SyncIcon = SYNC_ICONS[status];

  return (
    <span className={styles.pill} data-status={status} aria-live='polite'>
      <SyncIcon size={14} />
      {SYNC_LABELS[status]}
    </span>
  );
}

export default SyncPill;
