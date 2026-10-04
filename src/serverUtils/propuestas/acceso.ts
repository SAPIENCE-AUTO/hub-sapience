import { ZiteError } from '../../../server/compat';

// "esto debe ir en 'deals' pero sólo habilitado para sergio" (Sergio) — el gate
// real vive aquí, en el servidor; el de la UI (DealDetailSheet) es cosmético.
export const PROPUESTAS_ALLOWED_EMAILS = ['sergio@sapience.com.mx'];

export function exigirAccesoPropuestas(context: { user?: { email?: string } | null }) {
  if (!PROPUESTAS_ALLOWED_EMAILS.includes(context.user?.email ?? '')) {
    throw new ZiteError({ code: 'FORBIDDEN', message: 'El generador de propuestas no está habilitado para tu usuario.' });
  }
}
