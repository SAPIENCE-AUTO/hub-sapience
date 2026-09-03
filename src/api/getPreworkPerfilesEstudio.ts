import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { getPerfilesParticipantes } from '../serverUtils/preworkPerfiles';

export default createEndpoint({
  authenticated: true,
  description: 'Perfil (género/edad/NSE/región) de cada participante de un estudio, jalado de Reclutamiento',
  inputSchema: z.object({ estudioId: z.string() }),
  outputSchema: z.object({
    perfiles: z.array(z.object({
      participanteId: z.string(),
      genero: z.string().optional(),
      edad: z.string().optional(),
      nse: z.string().optional(),
      region: z.string().optional(),
    })),
  }),
  execute: async ({ input }) => {
    const mapa = await getPerfilesParticipantes(input.estudioId);
    return {
      perfiles: [...mapa.entries()].map(([participanteId, p]) => ({ participanteId, ...p })),
    };
  },
});
