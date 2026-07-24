import { Archive, LogOut } from 'lucide-react';
import styles from './AppHeader.module.css';
import SyncPill from './SyncPill';

// Omit onOpenTrash on the trash page itself, which has its own way back.
type AppHeaderProps = { onSignOut: () => void; onOpenTrash?: () => void };

function AppHeader({ onSignOut, onOpenTrash }: AppHeaderProps) {
  return (
    <header className={styles.header}>
      <h1>Jottr</h1>
      <div className={styles.actions}>
        {onOpenTrash && (
          <button type='button' className={styles.action} onClick={onOpenTrash}>
            <Archive size={16} />
            Trash
          </button>
        )}
        <button type='button' className={styles.action} onClick={onSignOut}>
          <LogOut size={16} />
          Sign out
        </button>
      </div>
      <SyncPill />
    </header>
  );
}

export default AppHeader;
