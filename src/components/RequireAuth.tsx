import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/lib/auth';

// App gates on `loading`, so a null user here means genuinely signed out.
function RequireAuth() {
  const { user } = useAuth();

  if (!user) {
    return <Navigate to='/' replace />;
  }

  return <Outlet />;
}

export default RequireAuth;
