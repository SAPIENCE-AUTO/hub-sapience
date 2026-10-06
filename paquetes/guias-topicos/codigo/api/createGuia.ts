import { z } from 'zod';
import { createEndpoint, GuiasTopicos } from '../../server/compat';
import { exigirAccesoGuias } from '../serverUtils/guias/acceso';
import { estadoVacio } from '../serverUtils/guias/types';

export default createEndpoint({
  authenticated: true,
  description: 'Crea una guía de tópicos vacía (opcionalmente ligada a un proyecto)',
  inputSchema: z.object({ titulo: z.string().trim().max(200).optional(), projectId: z.string().optional(), proyecto: z.string().max(300).optional() }),
  outputSchema: z.object({ id: z.string(), version: z.number() }),
  execute: async ({ input, context }) => {
    exigirAccesoGuias(context);
    const estado = { ...estadoVacio(), proyecto: input.proyecto ?? '' };
    const g: any = await GuiasTopicos.create({
      record: {
        titulo: input.titulo || input.proyecto || 'Guía sin nombre',
        estado, version: 1,
        ...(input.projectId ? { project: [input.projectId] } : {}),
        createdBy: [context.user!.id],
      } as any,
    });
    return { id: g.id, version: 1 };
  },
});
