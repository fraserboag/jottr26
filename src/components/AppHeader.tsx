import { Archive, LogOut, PanelLeft, PanelLeftClose } from 'lucide-react';
import styles from './AppHeader.module.css';
import SyncPill from './SyncPill';

// Omit onOpenTrash on the trash page itself, which has its own way back, and
// onToggleSidebar wherever there is no sidebar to toggle.
type AppHeaderProps = {
  onSignOut: () => void;
  onOpenTrash?: () => void;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
};

function AppHeader({
  onSignOut,
  onOpenTrash,
  sidebarOpen,
  onToggleSidebar,
}: AppHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.left}>
        {onToggleSidebar && (
          <button
            type='button'
            className={styles.action}
            aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            aria-expanded={sidebarOpen}
            onClick={onToggleSidebar}
          >
            {sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeft size={16} />}
          </button>
        )}
        <h1>Jottr</h1>
      </div>
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
