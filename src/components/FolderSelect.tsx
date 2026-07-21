import type { Folder } from '@/lib/folders';

type FolderSelectProps = {
  folders: Folder[];
  value: string | null;
  onChange: (folderId: string | null) => void;
};

function FolderSelect({ folders, value, onChange }: FolderSelectProps) {
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      aria-label='Folder'
    >
      <option value=''>Unfiled</option>
      {folders.map((folder) => (
        <option key={folder.id} value={folder.id}>
          {folder.name}
        </option>
      ))}
    </select>
  );
}

export default FolderSelect;
