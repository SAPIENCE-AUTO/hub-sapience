// Reemplazo de 'zite-auth-sdk'. Único export usado en el código: useAuth (20 archivos).
//
// Zite manejaba magic link + Google sign-in. El destino natural es Supabase Auth,
// que soporta los dos. Mientras eso se conecta, esto devuelve un usuario simulado
// para poder ver la interfaz sin backend: pon VITE_MOCK_USER=true en tu .env.local

import { useEffect, useState } from 'react';

export interface AuthUser {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  [k: string]: unknown;
}

const MOCK: AuthUser = {
  id: '00000000-0000-0000-0000-000000000001',
  email: 'sergio@sapience.mx',
  firstName: 'Sergio',
  lastName: 'Velasco',
};

export function useAuth() {
  const mock = import.meta.env.VITE_MOCK_USER === 'true';
  const [user, setUser] = useState<AuthUser | null>(mock ? MOCK : null);
  const [loading, setLoading] = useState(!mock);

  useEffect(() => {
    if (mock) return;
    // TODO: reemplazar por supabase.auth.getSession() + onAuthStateChange
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/me', { credentials: 'include' });
        if (!cancelled) setUser(res.ok ? await res.json() : null);
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [mock]);

  return {
    user,
    loading,
    isAuthenticated: !!user,
    signOut: async () => {
      // TODO: supabase.auth.signOut()
      setUser(null);
    },
  };
}
