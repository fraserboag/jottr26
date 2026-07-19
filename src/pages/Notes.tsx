import { useAuth } from '@/lib/auth';

function Notes() {
  const { user, signOut } = useAuth();

  if (!user) {
    return null;
  }

  return (
    <main>
      <h1>Notes</h1>

      <dl>
        <dt>Name</dt>
        <dd>{user.displayName ?? '—'}</dd>
        <dt>Email</dt>
        <dd>{user.email ?? '—'}</dd>
        <dt>Email verified</dt>
        <dd>{user.emailVerified ? 'yes' : 'no'}</dd>
        <dt>Provider</dt>
        <dd>{user.providerData.map((p) => p.providerId).join(', ')}</dd>
        <dt>User ID</dt>
        <dd>{user.uid}</dd>
        <dt>Account created</dt>
        <dd>{user.metadata.creationTime ?? '—'}</dd>
        <dt>Last signed in</dt>
        <dd>{user.metadata.lastSignInTime ?? '—'}</dd>
      </dl>

      <button type='button' onClick={() => void signOut()}>
        Sign out
      </button>
    </main>
  );
}

export default Notes;
