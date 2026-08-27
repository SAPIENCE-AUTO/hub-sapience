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
 * MODO REAL: Supabase Auth (magic link + Google). La sesión de Supabase solo trae
 * email/id — el perfil completo (role, purchaseLevel, access*) se hidrata llamando
 * a `getMe`, que resuelve el registro de `users` en el servidor. Si el correo autenticado
 * no existe en `users` (NOT_PROVISIONED), se cierra la sesión y se expone `error` para
 * que LoginPage muestre un mensaje claro en vez de rebotar en silencio.
 */

import { useEffect, useState } from 'react';
import { getUsers, getMe, ApiError } from 'zite-endpoints-sdk';
import { supabase } from '@/lib/supabaseClient';

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
  /** Ruta a la que redirige "/" para este usuario en vez del default global. */
  homePage?: string;
  [k: string]: unknown;
}

/** Último recurso si no se encuentra el usuario en la base (solo en modo simulado). */
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    // Último user.id ya hidratado — Supabase re-emite onAuthStateChange (p.ej.
    // TOKEN_REFRESHED) cada vez que la pestaña vuelve a estar visible, sin que
    // el usuario haya cambiado. Sin este control, cada regreso a la pestaña
    // ponía isLoading en true y volvía a pedir getMe(), lo que se veía como
    // un reload completo de la app.
    let ultimoUserId: string | null = null;

    /** Con una sesión de Supabase activa, hidrata el perfil completo desde `users` vía getMe. */
    async function hydrate(hasSession: boolean, sessionUserId: string | null) {
      if (!hasSession) {
        ultimoUserId = null;
        if (!cancelado) { setUser(null); setError(null); }
        return;
      }
      try {
        const perfil = await getMe({});
        ultimoUserId = sessionUserId;
        if (!cancelado) { setUser(perfil); setError(null); }
      } catch (e) {
        ultimoUserId = null;
        if (e instanceof ApiError && e.code === 'NOT_PROVISIONED') {
          await supabase.auth.signOut();
          if (!cancelado) {
            setUser(null);
            setError('Tu correo no está registrado en Hub Sapience. Contacta a un administrador.');
          }
        } else {
          console.error('[auth] getMe falló:', e);
          if (!cancelado) { setUser(null); setError('No se pudo cargar tu perfil. Intenta de nuevo.'); }
        }
      }
    }

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

        const { data: { session } } = await supabase.auth.getSession();
        await hydrate(!!session, session?.user?.id ?? null);
      } catch (e) {
        console.error('[auth] falló la resolución del usuario:', e);
        if (!cancelado) setUser(esSimulado() ? OWNER_SINTETICO : null);
      } finally {
        if (!cancelado) setIsLoading(false);
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (esSimulado() || cancelado) return;
      const sessionUserId = session?.user?.id ?? null;
      // Mismo usuario que ya teníamos hidratado (o seguimos sin sesión):
      // no es un login/logout real, solo Supabase revalidando el token.
      if (sessionUserId === ultimoUserId) return;
      setIsLoading(true);
      await hydrate(!!session, sessionUserId);
      if (!cancelado) setIsLoading(false);
    });

    return () => { cancelado = true; sub.subscription.unsubscribe(); };
  }, []);

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    /** "Tu correo no está registrado", u otro error de carga del perfil — null si no hay ninguno. */
    error,

    /** En Zite abría el flujo de magic link / Google. Aquí manda a /login, que ofrece ambos. */
    loginWithRedirect: async (opts?: { redirectUrl?: string }) => {
      if (esSimulado()) {
        console.info('[auth] modo simulado: loginWithRedirect no hace nada');
        return;
      }
      const target = opts?.redirectUrl;
      window.location.href = target ? `/login?redirect=${encodeURIComponent(target)}` : '/login';
    },

    logout: async (opts?: { returnTo?: string }) => {
      if (!esSimulado()) await supabase.auth.signOut();
      setUser(null);
      window.location.href = opts?.returnTo ?? '/login';
    },
  };
}
