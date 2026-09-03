import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'crypto';

/**
 * Auth propia para el portal de participante de Prework — no toca
 * server/auth.ts (Supabase, solo para el equipo interno) ni el par
 * token+password de Suppliers (SupplierPortalPage). A diferencia de ese
 * portal, que compara `portalPassword` en texto plano
 * (ver src/api/getSupplierPortalData.ts), acá se guarda hasheada: los datos
 * de un diario de investigación son más sensibles que una clave de acceso a
 * un PDF de orden de compra, y el hash no cuesta nada extra.
 *
 * scrypt en vez de bcrypt/jsonwebtoken: ninguna de las dos está instalada en
 * package.json y `crypto` (built-in de Node) ya cubre hash con salt y HMAC
 * sin agregar una dependencia nueva.
 */

const SCRYPT_KEYLEN = 64;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 días — portal de diario, no una sesión de oficina

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return { hash, salt };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const candidate = scryptSync(password, salt, SCRYPT_KEYLEN);
  const stored = Buffer.from(hash, 'hex');
  // Buffer.length distinto haría explotar timingSafeEqual antes de comparar
  // (p.ej. un hash corrupto/truncado) — se trata como "no coincide", no error.
  if (candidate.length !== stored.length) return false;
  return timingSafeEqual(candidate, stored);
}

function getSecret(): string {
  const secret = process.env.PREWORK_SESSION_SECRET;
  if (!secret) throw new Error('Falta PREWORK_SESSION_SECRET');
  return secret;
}

/** Token de sesión firmado: `<participanteId>.<expiraEn>.<firma>`, todo base64url. */
export function createSessionToken(participanteId: string): string {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const payload = `${participanteId}.${expiresAt}`;
  const signature = createHmac('sha256', getSecret()).update(payload).digest('base64url');
  return Buffer.from(payload).toString('base64url') + '.' + signature;
}

export function verifySessionToken(token: string | undefined | null): { participanteId: string } | null {
  if (!token) return null;
  const lastDot = token.lastIndexOf('.');
  if (lastDot === -1) return null;
  const encodedPayload = token.slice(0, lastDot);
  const signature = token.slice(lastDot + 1);

  let payload: string;
  try {
    payload = Buffer.from(encodedPayload, 'base64url').toString('utf8');
  } catch {
    return null;
  }

  const expectedSignature = createHmac('sha256', getSecret()).update(payload).digest('base64url');
  const a = Buffer.from(signature);
  const b = Buffer.from(expectedSignature);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const [participanteId, expiresAtStr] = payload.split('.');
  const expiresAt = Number(expiresAtStr);
  if (!participanteId || !Number.isFinite(expiresAt) || Date.now() > expiresAt) return null;

  return { participanteId };
}
