import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { exigirAccesoGuias } from '../serverUtils/guias/acceso';
import { cargarGuia, puedeBorrar } from '../serverUtils/guias/datos';

export default createEndpoint({
  authenticated: true,
  description: 'Una guía de tópicos completa',
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ id: z.string(), titulo: z.string(), estado: z.any(), version: z.number(), projectId: z.string().optional(), puedeBorrar: z.boolean() }),
  execute: async ({ input, context }) => {
    exigirAccesoGuias(context);
    const g: any = await cargarGuia(input.id);
    const project = Array.isArray(g.project) ? g.project[0] : g.project;
    return { id: g.id, titulo: g.titulo, estado: g.estado, version: Number(g.version ?? 1), projectId: project ?? undefined, puedeBorrar: puedeBorrar(context, g) };
  },
});
