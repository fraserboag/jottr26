import { Outlet } from 'react-router-dom';
import { useAuth } from '@/lib/auth';

// Gating here keeps every route below free of the loading case: a null user
// downstream means signed out, not undetermined.
function App() {
  const { loading } = useAuth();

  if (loading) {
    return <main>Checking sign-in status…</main>;
  }

  return <Outlet />;
}

export default App;
