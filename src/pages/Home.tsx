import { Navigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth';

function Home() {
  const { user, signInError, signIn } = useAuth();

  if (user) {
    return <Navigate to='/notes' replace />;
  }

  return (
    <main>
      <h1>Jottr</h1>

      {signInError && <p role='alert'>Sign-in failed: {signInError.message}</p>}

      <button type='button' onClick={() => void signIn()}>
        Sign in with Google
      </button>
    </main>
  );
}

export default Home;
