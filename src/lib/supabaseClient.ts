import { createClient } from '@supabase/supabase-js';

// Con VITE_MOCK_USER=true (ver zite-auth-sdk.ts) esta app nunca llama a Supabase de verdad,
// pero zite-endpoints-sdk.ts sí llama a `supabase.auth.getSession()` en cada request para
// adjuntar el token si existe. createClient() truena si la URL/key vienen vacías, así que en
// modo simulado (o antes de configurar las variables reales) se usa un placeholder — nunca se
// intenta una sesión real contra él, getSession() solo resuelve `{ session: null }` en local.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co',
  import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder-anon-key',
);
