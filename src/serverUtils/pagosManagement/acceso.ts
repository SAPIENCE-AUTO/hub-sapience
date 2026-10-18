import { ZiteError } from '../../../server/compat';

// «sólo visible de momento para sergio» (Sergio, 2026-10-17): el candado real vive aquí, en el servidor; el del menú y el de la página son
// cosméticos. Mismo criterio que la conciliación bancaria, los indicadores y el generador de propuestas.
export const PAGOS_MANAGEMENT_ALLOWED_EMAILS = ['sergio@sapience.com.mx'];

export function exigirAccesoPagosManagement(context: { user?: { email?: string } | null }) {
  const email = (context.user?.email ?? '').toLowerCase();
  if (!PAGOS_MANAGEMENT_ALLOWED_EMAILS.includes(email)) {
    throw new ZiteError({ code: 'FORBIDDEN', message: 'Los pagos de análisis y management no están habilitados para tu usuario.' });
  }
}
