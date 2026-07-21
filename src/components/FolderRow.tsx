import type { CSSProperties } from 'react';
import {
  ChevronDown,
  ChevronRight,
  FilePlus,
  FolderPlus,
  Trash2,
} from 'lucide-react';
import type { Folder } from '@/lib/folders';
import styles from './FolderRow.module.css';

type FolderRowProps = {
  folder: Folder;
  isCollapsed: boolean;
  indent: CSSProperties;
  onToggle: () => void;
  onNewNote: () => void;
  onAddSubfolder: () => void;
  onDelete: () => void;
};

function FolderRow({
  folder,
  isCollapsed,
  indent,
  onToggle,
  onNewNote,
  onAddSubfolder,
  onDelete,
}: FolderRowProps) {
  return (
    <div className={styles.row} style={indent}>
      <button
        type='button'
        className={styles.name}
        aria-expanded={!isCollapsed}
        onClick={onToggle}
      >
        {isCollapsed ? (
          <ChevronRight size={16} className={styles.icon} />
        ) : (
          <ChevronDown size={16} className={styles.icon} />
        )}
        <span className={styles.label}>{folder.name}</span>
      </button>
      <button
        type='button'
        className={styles.action}
        aria-label={`New note in ${folder.name}`}
        onClick={onNewNote}
      >
        <FilePlus size={16} />
      </button>
      <button
        type='button'
        className={styles.action}
        aria-label={`New folder in ${folder.name}`}
        onClick={onAddSubfolder}
      >
        <FolderPlus size={16} />
      </button>
      <button
        type='button'
        className={styles.action}
        aria-label={`Delete ${folder.name}`}
        onClick={onDelete}
      >
        <Trash2 size={16} />
      </button>
    </div>
  );
}

export default FolderRow;
