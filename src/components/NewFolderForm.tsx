import { useRef, useState, type FormEvent } from 'react';
import { FolderPlus } from 'lucide-react';
import styles from './NewFolderForm.module.css';

type NewFolderFormProps = {
  onCreate: (name: string) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
};

function NewFolderForm({ onCreate, onCancel, autoFocus }: NewFolderFormProps) {
  const [name, setName] = useState('');
  // Guards against a second commit when both blur and submit/escape fire for the
  // same interaction (e.g. tapping the submit button blurs the input first).
  const committedRef = useRef(false);

  // Committing on blur handles iOS keyboard dismiss as well as desktop
  // click-away: create when titled, discard when empty.
  const commit = () => {
    if (committedRef.current) return;
    committedRef.current = true;
    const trimmed = name.trim();
    if (trimmed) {
      onCreate(trimmed);
    } else {
      onCancel?.();
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    commit();
  };

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            committedRef.current = true;
            onCancel?.();
          }
        }}
        onBlur={commit}
        autoFocus={autoFocus}
        placeholder='New folder name'
        aria-label='New folder name'
      />
      <button type='submit' aria-label='Add folder'>
        <FolderPlus size={16} />
      </button>
    </form>
  );
}

export default NewFolderForm;
