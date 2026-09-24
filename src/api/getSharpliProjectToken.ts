import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { signEmbedToken } from '../serverUtils/sharpliAuth';

// Nivel 2 del embed de Sharpli (por proyecto, ver SharpliEmbedTab.tsx).
// Token largo (8h): a diferencia del nivel 1, este SÍ se revalida en cada
// llamada de datos mientras se navegan las pestañas internas de Sharpli
// (streamings/clips/reels/análisis) — corto y las llamadas se empiezan a
// caer a media sesión. projectName/brandName los manda el frontend tal
// cual (ya los tiene del proyecto cargado) — no hay resolución ni caché de
// este lado; si el nombre no hace match exacto en Sharpli, es el propio
// iframe el que lo maneja (ofrece "crear proyecto" en vez del real).
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000;

export default createEndpoint({
  authenticated: true,
  description: 'Firma el token de embed (por proyecto) para el iframe de Sharpli',
  inputSchema: z.object({
    projectName: z.string(),
    brandName: z.string(),
  }),
  outputSchema: z.object({ token: z.string() }),
  execute: async ({ input, context }) => {
    const secret = process.env.ZITE_EMBED_SECRET;
    if (!secret) throw new Error('ZITE_EMBED_SECRET no configurada');
    const token = signEmbedToken(
      {
        email: context.user!.email,
        projectName: input.projectName,
        brandName: input.brandName,
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
      },
      secret,
    );
    return { token };
  },
});
