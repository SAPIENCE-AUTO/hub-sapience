import { ZiteError } from '../../../server/compat';

// Quién usa el generador. Sin GUIAS_ALLOWED_EMAILS, todo el equipo autenticado; con la variable
// (correos separados por coma), solo esas personas — útil para probarlo antes de abrirlo.
export function exigirAccesoGuias(context: { user?: { email?: string } | null }) {
  const lista = (process.env.GUIAS_ALLOWED_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const email = (context.user?.email ?? '').toLowerCase();
  if (!email) throw new ZiteError({ code: 'UNAUTHORIZED', message: 'Inicia sesión' });
  if (lista.length && !lista.includes(email)) {
    throw new ZiteError({ code: 'FORBIDDEN', message: 'El generador de guías no está habilitado para tu usuario.' });
  }
}

// Tope de llamadas a Claude por persona y por hora (en memoria del proceso), para que un error o un
// bucle no se coma el presupuesto de la API. Una guía de 6 bloques son unas 8 llamadas.
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
