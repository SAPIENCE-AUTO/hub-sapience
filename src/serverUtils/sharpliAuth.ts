import crypto from 'node:crypto';

// Formato de token para el embed de Sharpli, verificado en vivo contra el
// código real de Sharpli (validateEmbedToken) — el HMAC se calcula sobre el
// payload YA codificado en base64url, no sobre el JSON crudo, y la firma va
// en hex minúsculas (no base64/base64url). Compartido entre los dos niveles
// de embed (app completa y por proyecto, ver getSharpliAppToken.ts /
// getSharpliProjectToken.ts) — mismo secreto (ZITE_EMBED_SECRET) en ambos.
function base64url(input: string): string {
  return Buffer.from(input, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function signEmbedToken(payload: Record<string, unknown>, secret: string): string {
  const payloadB64 = base64url(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', secret).update(payloadB64).digest('hex');
  return `${payloadB64}.${signature}`;
}
