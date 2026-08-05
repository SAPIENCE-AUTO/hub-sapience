/**
 * Reemplazo de 'zite-auth-sdk'.
 *
 * Superficie exacta que espera el código (contada en los 20 archivos que lo importan):
 *   user (21 usos) · loginWithRedirect (6) · isLoading (4) · logout (1)
 *
 * Ojo con los nombres: el front usa `isLoading`, no `loading`, y `logout`, no `signOut`.
 *
 * Campos del usuario que el front lee, por frecuencia:
 *   email (44) · role (34) · id (24) · firstName (21) · lastName (13)
 *   purchaseLevel (10) · visiblePages (7) · dashboardWidgets (5)
 *   accessFinanzas (5) · accessOtros (3) · accessOperacion (3) · accessComercial (3)
 *
 * Sin `role` ni los campos de acceso, `canSeeSection` de Layout.tsx esconde todas las
 * secciones: la app se ve vacía aunque los datos estén en la base.
 *
 * MODO SIMULADO (VITE_MOCK_USER=true): trae tu usuario real de la base por correo,
 * usando VITE_MOCK_EMAIL. Así los permisos son los de verdad. Si no lo encuentra,
 * cae a un Owner sintético para no bloquear el desarrollo.
 *
 * PENDIENTE: conectar con Supabase Auth (magic link + Google, como en Zite).
 * Los puntos exactos están marcados con TODO.
 */

import { useEffect, useState } from 'react';
import { getUsers } from 'zite-endpoints-sdk';

export interface AuthUser {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role?: string;
  purchaseLevel?: string;
  visiblePages?: string[];
  dashboardWidgets?: string[];
  accessComercial?: string;
  accessOperacion?: string;
  accessAdmin?: string;
  accessFinanzas?: string;
  accessOtros?: string;
  maxApprovalAmount?: number;
  costCenters?: string[];
  [k: string]: unknown;
}

/** Último recurso si no se encuentra el usuario en la base. */
const OWNER_SINTETICO: AuthUser = {
  id: '00000000-0000-0000-0000-000000000001',
  email: 'dev@local',
  firstName: 'Dev',
  lastName: 'Local',
  role: 'Owner',
  purchaseLevel: 'Socios',
  accessComercial: 'Administrar',
  accessOperacion: 'Administrar',
  accessAdmin: 'Administrar',
  accessFinanzas: 'Administrar',
  accessOtros: 'Administrar',
};

const esSimulado = () => import.meta.env.VITE_MOCK_USER === 'true';

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelado = false;

    (async () => {
      try {
        if (esSimulado()) {
          const correo = import.meta.env.VITE_MOCK_EMAIL as string | undefined;
          if (correo) {
            const res = await getUsers({});
            const encontrado = (res?.users ?? []).find(
              (u: AuthUser) => u.email?.toLowerCase() === correo.toLowerCase(),
            );
            if (encontrado) {
              if (!cancelado) setUser(encontrado);
              return;
            }
            console.warn(
              '[auth] No se encontró "' + correo + '" en la tabla users. ' +
              'Usando Owner sintético. Revisa que la carga incluyera tu usuario.',
            );
          }
          if (!cancelado) setUser(OWNER_SINTETICO);
          return;
        }

        // TODO: supabase.auth.getSession() + onAuthStateChange, y resolver
        // el registro de `users` por el correo de la sesión.
        const res = await fetch('/api/me', { credentials: 'include' });
        if (!cancelado) setUser(res.ok ? await res.json() : null);
      } catch (e) {
        console.error('[auth] falló la resolución del usuario:', e);
        if (!cancelado) setUser(esSimulado() ? OWNER_SINTETICO : null);
      } finally {
        if (!cancelado) setIsLoading(false);
      }
    })();

    return () => { cancelado = true; };
  }, []);

  return {
    user,
    isLoading,
    isAuthenticated: !!user,

    /** En Zite abría el flujo de magic link / Google. */
    loginWithRedirect: async () => {
      if (esSimulado()) {
        console.info('[auth] modo simulado: loginWithRedirect no hace nada');
        return;
      }
      // TODO: supabase.auth.signInWithOtp / signInWithOAuth({ provider: 'google' })
      window.location.href = '/login';
    },

    logout: async () => {
      // TODO: supabase.auth.signOut()
      setUser(null);
      if (!esSimulado()) window.location.href = '/login';
    },
  };
}
