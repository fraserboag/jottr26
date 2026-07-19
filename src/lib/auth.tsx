import { createContext, use, useEffect, useState, type ReactNode } from 'react';
import {
  GoogleAuthProvider,
  getRedirectResult,
  onAuthStateChanged,
  signInWithRedirect,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import { auth } from '@/lib/firebase';

type AuthState = {
  user: User | null;
  loading: boolean;
  signInError: Error | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
};

const googleProvider = new GoogleAuthProvider();

const AuthContext = createContext<AuthState | null>(null);

function toError(value: unknown) {
  return value instanceof Error ? value : new Error(String(value));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [signInError, setSignInError] = useState<Error | null>(null);

  useEffect(
    () =>
      onAuthStateChanged(auth, (next) => {
        setUser(next);
        setLoading(false);
      }),
    [],
  );

  // Only to surface a failed redirect sign-in. The resulting session arrives
  // via onAuthStateChanged, so nothing waits on this resolving.
  useEffect(() => {
    getRedirectResult(auth).catch((error: unknown) => {
      setSignInError(toError(error));
    });
  }, []);

  const value: AuthState = {
    user,
    loading,
    signInError,
    signIn: async () => {
      setSignInError(null);
      try {
        await signInWithRedirect(auth, googleProvider);
      } catch (error: unknown) {
        setSignInError(toError(error));
      }
    },
    signOut: () => firebaseSignOut(auth),
  };

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth() {
  const value = use(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return value;
}
