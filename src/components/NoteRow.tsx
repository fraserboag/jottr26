import type { CSSProperties } from 'react';
import { FileText, Trash2 } from 'lucide-react';
import type { Note } from '@/lib/notes';
import styles from './NoteRow.module.css';

type NoteRowProps = {
  note: Note;
  isSelected: boolean;
  indent: CSSProperties;
  onSelect: () => void;
  onDelete: () => void;
};

function NoteRow({ note, isSelected, indent, onSelect, onDelete }: NoteRowProps) {
  const label = note.title || 'Untitled';

  return (
    <div className={styles.row} style={indent}>
      <button
        type='button'
        className={styles.name}
        aria-current={isSelected}
        onClick={onSelect}
      >
        <FileText size={16} className={styles.icon} />
        <span className={styles.label}>{label}</span>
      </button>
      <button
        type='button'
        className={styles.deleteButton}
        aria-label={`Delete ${label}`}
        onClick={onDelete}
      >
        <Trash2 size={16} />
      </button>
    </div>
  );
}

export default NoteRow;
