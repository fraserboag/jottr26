import { useState, type FormEvent } from 'react';
import { FolderPlus } from 'lucide-react';
import styles from './NewFolderForm.module.css';

type NewFolderFormProps = {
  onCreate: (name: string) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
};

function NewFolderForm({ onCreate, onCancel, autoFocus }: NewFolderFormProps) {
  const [name, setName] = useState('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      onCancel?.();
      return;
    }
    onCreate(trimmed);
    setName('');
  };

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onCancel?.()}
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
