import { ZiteError } from '../../../server/compat';
import { puedeVerGuias } from '../../lib/guias/acceso';

// El candado real de las guías de tópicos vive aquí; el de la pestaña es cosmético. Por defecto entra todo el equipo (src/lib/guias/acceso.ts). Con GUIAS_ALLOWED_EMAILS
// (correos separados por coma, o «*» para todo el equipo) se puede acotar sin tocar el código; sin esa variable no cambia nada.
export function exigirAccesoGuias(context: { user?: { email?: string } | null }) {
  const email = (context.user?.email ?? '').toLowerCase();
  if (!email) throw new ZiteError({ code: 'UNAUTHORIZED', message: 'Inicia sesión' });
  const lista = (process.env.GUIAS_ALLOWED_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const permitido = lista.length ? lista.includes('*') || lista.includes(email) : puedeVerGuias(email);
  if (!permitido) throw new ZiteError({ code: 'FORBIDDEN', message: 'Las guías de tópicos no están habilitadas para tu usuario.' });
}

// Tope de llamadas a Claude por persona y por hora (en memoria del proceso), para que un error o un bucle no se coma el presupuesto de la API.
// Una guía de 6 bloques son unas 8 llamadas.
const LIMITE_POR_HORA = Number(process.env.GUIAS_LIMITE_HORA || 150);
const uso = new Map<string, { inicio: number; n: number }>();
export function cuotaIA(context: { user?: { email?: string } | null }) {
  const k = (context.user?.email ?? '').toLowerCase();
  const ahora = Date.now();
  const u = uso.get(k);
  if (!u || ahora - u.inicio > 3_600_000) { uso.set(k, { inicio: ahora, n: 1 }); return; }
  if (++u.n > LIMITE_POR_HORA) {
    throw new ZiteError({ code: 'FORBIDDEN', message: 'Llegaste al límite de uso de la IA por ahora. Intenta de nuevo en un rato.' });
  }
}

/** Solo para las pruebas: borra lo contado. */
export const reiniciarCuota = () => uso.clear();
