import { createClient } from '@supabase/supabase-js';
import { Users, pool } from './compat';
import type { AuthUser } from './compat/endpoint';

/**
 * Resuelve quién llama. Dos modos:
 *
 * - VITE_MOCK_USER=true (dev local): nunca toca Supabase, inyecta el mismo
 *   usuario de siempre (por email, vía VITE_MOCK_EMAIL) — igual que el
 *   comportamiento anterior en server/index.ts.
 * - Modo real: verifica el JWT contra el Auth server de Supabase
 *   (`auth.getUser`, no JWKS local — a este volumen de tráfico la llamada de
 *   red es imperceptible, y de paso invalida sesiones de verdad si el
 *   usuario se borra/banea, algo que un JWT local no detecta hasta que expira).
 */
const MOCK_MODE = process.env.VITE_MOCK_USER === 'true';
const MOCK_USER_EMAIL = process.env.VITE_MOCK_EMAIL ?? 'sergio@sapience.com.mx';

const supabase = MOCK_MODE
  ? null
  : createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);

let mockUser: AuthUser | null = null;
async function loadMockUser(): Promise<AuthUser> {
  if (mockUser) return mockUser;
  const { records } = await Users.findAll({ filters: { email: MOCK_USER_EMAIL }, limit: 1 });
  const user = records[0];
  if (!user) throw new Error(`MOCK_USER_EMAIL '${MOCK_USER_EMAIL}' no existe en la tabla users`);
  return (mockUser = user as unknown as AuthUser);
}

// Cache de verificación: pocas docenas de usuarios, tokens de ~1h de vida.
// 60s de TTL evita pegarle a Supabase en cada request sin construir nada elaborado.
const verifiedCache = new Map<string, { supaEmail: string; expiresAt: number }>();
const CACHE_TTL_MS = 60_000;

export interface AuthResolution {
  user: AuthUser | null;
  /** Sesión de Supabase válida, pero el correo no existe en `users` — distinto de "no hay sesión". */
  notProvisioned: boolean;
}

export async function resolveAuth(authHeader: string | undefined): Promise<AuthResolution> {
  if (MOCK_MODE) return { user: await loadMockUser(), notProvisioned: false };

  const token = authHeader?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return { user: null, notProvisioned: false };

  let supaEmail: string | undefined;
  const cached = verifiedCache.get(token);
  if (cached && cached.expiresAt > Date.now()) {
    supaEmail = cached.supaEmail;
  } else {
    const { data, error } = await supabase!.auth.getUser(token);
    if (error || !data.user?.email) return { user: null, notProvisioned: false };
    supaEmail = data.user.email;
    verifiedCache.set(token, { supaEmail, expiresAt: Date.now() + CACHE_TTL_MS });
  }

  // Comparación case-insensitive: la tabla tiene `unique index on users (lower(email))`,
  // pero los filtros de la capa compat solo hacen igualdad exacta — una consulta cruda
  // puntual es más simple que enseñarle case-insensitivity al filtro genérico.
  const { rows } = await pool.query<{ id: string }>(
    'select id from users where lower(email) = lower($1) limit 1',
    [supaEmail],
  );
  if (!rows[0]) return { user: null, notProvisioned: true };

  const appUser = await Users.findOne({ id: rows[0].id });
  return { user: appUser as unknown as AuthUser, notProvisioned: false };
}
