import { ZiteError } from '../../../server/compat';

// «para sergio» (Sergio, 2026-10-17): el candado real vive aquí, en el servidor; el del menú y el de la página son cosméticos.
// Mismo criterio que la conciliación bancaria y el generador de propuestas.
export const INDICADORES_ALLOWED_EMAILS = ['sergio@sapience.com.mx'];

export function exigirAccesoIndicadores(context: { user?: { email?: string } | null }) {
  const email = (context.user?.email ?? '').toLowerCase();
  if (!INDICADORES_ALLOWED_EMAILS.includes(email)) {
    throw new ZiteError({ code: 'FORBIDDEN', message: 'Los indicadores no están habilitados para tu usuario.' });
  }
}
