import { createClient } from '@supabase/supabase-js';

/**
 * Cliente de Supabase con la service_role key — salta RLS y puede usar
 * `auth.admin.*`. Solo para uso server-side (nunca exponer al frontend).
 * Hoy sirve para aprovisionar auth.users al crear un usuario en la app
 * (ver src/api/inviteUsers.ts) sin mandar correo de invitación.
 */
let client: ReturnType<typeof createClient> | null = null;

export function getSupabaseAdmin() {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY');
  client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  return client;
}
