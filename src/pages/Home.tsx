import { useAuth } from '@/lib/auth';

function Home() {
  const { user, loading, signInError, signIn, signOut } = useAuth();

  if (loading) {
    return <main>Checking sign-in status…</main>;
  }

  return (
    <main>
      <h1>Jottr</h1>

      {signInError && <p role='alert'>Sign-in failed: {signInError.message}</p>}

      {user ? (
        <section>
          <h2>Signed in</h2>
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
        </section>
      ) : (
        <section>
          <h2>Signed out</h2>
          <button type='button' onClick={() => void signIn()}>
            Sign in with Google
          </button>
        </section>
      )}
    </main>
  );
}

export default Home;
