/**
 * Rate limit burdo en memoria, por IP + endpoint.
 *
 * Único propósito: la Sala de observación tiene endpoints públicos
 * (`authenticated: false`) sin ningún login de por medio — el link circula
 * por correo a un cliente, y basta un script trivial para llenar
 * `observers`/`observation_chat`/`observer_heartbeats`. No es un ataque
 * sofisticado, es abuso trivial que un límite burdo ya detiene.
 *
 * Ventana fija (no sliding) en memoria del proceso — si Render llega a correr
 * más de una instancia de `hub-sapience-api`, el límite deja de ser global
 * (cada proceso cuenta aparte). Límite conocido, aceptable para este alcance.
 */

interface Bucket { count: number; windowStart: number }

const buckets = new Map<string, Bucket>();

// Evita que el Map crezca sin límite en un proceso de larga vida si alguien
// rota de IP en IP — no es un LRU real, solo un tope burdo como el resto de
// este archivo.
const MAX_BUCKETS = 50_000;

/** true si la petición cabe en el límite; false si hay que rechazarla (429). */
export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || now - existing.windowStart >= windowMs) {
    if (buckets.size >= MAX_BUCKETS) buckets.clear();
    buckets.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (existing.count >= limit) return false;
  existing.count += 1;
  return true;
}

/** Primer salto de X-Forwarded-For — suficiente para este propósito, no para auditoría legal. */
export function clientIp(forwardedFor: string | null | undefined): string {
  return forwardedFor?.split(',')[0]?.trim() || 'unknown';
}
