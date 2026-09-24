import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { signEmbedToken } from '../serverUtils/sharpliAuth';

// Nivel 1 del embed de Sharpli (app completa, ver Layout.tsx nav item
// "Sharpli" + SharpliPage.tsx). Token corto (~5 min) — se usa una sola vez
// para arrancar la sesión ahí, no se revalida después (a diferencia del
// nivel 2, por proyecto). El Hub solo firma identidad; si el correo no
// tiene cuenta en Sharpli, es el propio iframe el que lo rechaza — no hay
// nada que validar de este lado.
const TOKEN_TTL_MS = 5 * 60 * 1000;

export default createEndpoint({
  authenticated: true,
  description: 'Firma el token de embed (app completa) para el iframe de Sharpli — sin proyecto/marca',
  inputSchema: z.object({}),
  outputSchema: z.object({ token: z.string() }),
  execute: async ({ context }) => {
    const secret = process.env.ZITE_EMBED_SECRET;
    if (!secret) throw new Error('ZITE_EMBED_SECRET no configurada');
    const token = signEmbedToken(
      { email: context.user!.email, expiresAt: new Date(Date.now() + TOKEN_TTL_MS).toISOString() },
      secret,
    );
    return { token };
  },
});
