import { useAuth } from '@/lib/auth';

function Home() {
  const { user, loading, signInError, signIn, signOut } = useAuth();

  if (loading) {
    return <main>Loading…</main>;
  }

  return (
    <main>
      <h1>Jottr</h1>
      {signInError && <p role='alert'>Sign-in failed: {signInError.message}</p>}
      {user ? (
        <>
          <p>Signed in as {user.email}</p>
          <button onClick={() => void signOut()}>Sign out</button>
        </>
      ) : (
        <button onClick={() => void signIn()}>Sign in with Google</button>
      )}
    </main>
  );
}

export default Home;
