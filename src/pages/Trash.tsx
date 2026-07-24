import { Link } from 'react-router-dom';
import { formatDistanceToNow, formatDistanceToNowStrict } from 'date-fns';
import { ArrowLeft, FileText, Folder, Undo2 } from 'lucide-react';
import type { Timestamp } from 'firebase/firestore';
import { useAuth } from '@/lib/auth';
import { restoreNote, useTrashedNotes, type Note } from '@/lib/notes';
import {
  getCascadedIds,
  restoreFolder,
  useTrashedFolders,
  type Folder as FolderType,
} from '@/lib/folders';
import { useReapExpired } from '@/lib/reap';
import { SyncStatusProvider } from '@/lib/syncStatus';
import { TRASH_RETENTION_DAYS, isExpired, reapsAt } from '@/lib/trash';
import AppHeader from '@/components/AppHeader';
import styles from './Trash.module.css';

type Entry =
  | {
      kind: 'folder';
      deletedAt: Timestamp;
      folder: FolderType;
      contains: number;
    }
  | { kind: 'note'; deletedAt: Timestamp; note: Note };

function Trash() {
  const { user, signOut } = useAuth();
  const { folders, loading: foldersLoading } = useTrashedFolders(
    user?.uid ?? null,
  );
  const { notes, loading: notesLoading } = useTrashedNotes(user?.uid ?? null);
  useReapExpired(user?.uid ?? null);

  if (!user) {
    return null;
  }

  const trash = { folders, notes };

  // Only what the user deleted directly gets a row. A document tombstoned by a
  // folder's cascade (deletedWith set) comes back with that folder, so listing
  // it separately would offer a restore that isn't its own to make. Expired
  // tombstones are dropped too — the TTL reaper may not have collected them
  // yet, but they're past the point of being restorable.
  const entries: Entry[] = [
    ...folders
      .filter((folder) => isRestorable(folder))
      .map((folder): Entry => {
        const cascaded = getCascadedIds(folder.id, trash);
        return {
          kind: 'folder',
          deletedAt: folder.deletedAt as Timestamp,
          folder,
          contains: cascaded.folderIds.length + cascaded.noteIds.length,
        };
      }),
    ...notes
      .filter((note) => isRestorable(note))
      .map((note): Entry => ({
        kind: 'note',
        deletedAt: note.deletedAt as Timestamp,
        note,
      })),
  ].sort((a, b) => b.deletedAt.toMillis() - a.deletedAt.toMillis());

  return (
    <SyncStatusProvider>
      <div className={styles.layout}>
        <AppHeader onSignOut={() => void signOut()} />

        <main className={styles.main}>
          <div className={styles.heading}>
            <Link to='/notes' className={styles.back}>
              <ArrowLeft size={16} />
              Back to notes
            </Link>
            <h2>Trash</h2>
            <p className={styles.note}>
              Deleted notes and folders are kept for {TRASH_RETENTION_DAYS} days,
              then removed for good.
            </p>
          </div>

          {entries.length > 0 ? (
            <ul className={styles.list}>
              {entries.map((entry) => (
                <li key={entryId(entry)} className={styles.row}>
                  {entry.kind === 'folder' ? (
                    <Folder size={16} className={styles.icon} />
                  ) : (
                    <FileText size={16} className={styles.icon} />
                  )}
                  <div className={styles.details}>
                    <span className={styles.label}>{entryLabel(entry)}</span>
                    <span className={styles.meta}>
                      Deleted{' '}
                      {formatDistanceToNow(entry.deletedAt.toDate(), {
                        addSuffix: true,
                      })}
                      {' · '}
                      {formatDistanceToNowStrict(reapsAt(entry.deletedAt))} left
                      {entryContents(entry)}
                    </span>
                  </div>
                  <button
                    type='button'
                    className={styles.restore}
                    onClick={() =>
                      entry.kind === 'folder'
                        ? void restoreFolder(user.uid, entry.folder.id, trash)
                        : void restoreNote(user.uid, entry.note.id)
                    }
                  >
                    <Undo2 size={16} />
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          ) : foldersLoading || notesLoading ? (
            <p className={styles.message}>Loading…</p>
          ) : (
            <p className={styles.message}>Trash is empty.</p>
          )}
        </main>
      </div>
    </SyncStatusProvider>
  );
}

// deletedAt is non-null for everything these queries return, but a tombstone
// whose serverTimestamp hasn't landed yet reads as null locally.
function isRestorable(doc: {
  deletedAt: Timestamp | null;
  deletedWith?: string | null;
}) {
  return (
    doc.deletedAt !== null &&
    (doc.deletedWith ?? null) === null &&
    !isExpired(doc.deletedAt)
  );
}

const entryId = (entry: Entry) =>
  entry.kind === 'folder' ? entry.folder.id : entry.note.id;

const entryLabel = (entry: Entry) =>
  entry.kind === 'folder' ? entry.folder.name : entry.note.title || 'New Note';

// What a folder brings back with it — the cascade this restore also undoes.
function entryContents(entry: Entry): string {
  if (entry.kind !== 'folder' || entry.contains === 0) {
    return '';
  }
  return ` · with ${entry.contains} item${entry.contains === 1 ? '' : 's'}`;
}

export default Trash;
