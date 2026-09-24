import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { getRecallBot, latestBotStatus, botDownloadUrl } from '../serverUtils/recallClient';

// Piloto notetaker (sep 2026): el frontend hace polling de esto mientras el
// bot está activo. Sin webhook todavía a propósito — para el piloto es más
// rápido de probar que exponer un endpoint público y configurarlo en el
// dashboard de Recall; eso es el siguiente paso una vez que la mecánica
// básica (crear bot, se une, se puede bajar la grabación) esté confirmada.
export default createEndpoint({
  authenticated: true,
  description: 'Piloto notetaker: status actual de un bot de Recall.ai (para hacer polling desde el Hub)',
  inputSchema: z.object({
    botId: z.string(),
  }),
  outputSchema: z.object({
    status: z.string(),
    downloadUrl: z.string().optional(),
  }),
  execute: async ({ input }) => {
    const bot = await getRecallBot(input.botId);
    return { status: latestBotStatus(bot), downloadUrl: botDownloadUrl(bot) };
  },
});
