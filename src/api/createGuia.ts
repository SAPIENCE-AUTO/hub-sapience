import { z } from 'zod';
import { createEndpoint, GuiasTopicos, pool } from '../../server/compat';
import { exigirAccesoGuias } from '../serverUtils/guias/acceso';
import { estadoVacio } from '../lib/guias/types';

// Una guía nueva se llama como el proyecto; si ya hay otra con ese nombre en el mismo proyecto, «(2)», «(3)»… para poder distinguirlas en la lista.
// Se puede renombrar desde el editor. El título guardado no pasa de 200 letras (lo mismo que acepta saveGuia).
const TOPE_TITULO = 200;

export default createEndpoint({
  authenticated: true,
  description: 'Crea una guía de tópicos vacía (opcionalmente ligada a un proyecto)',
  inputSchema: z.object({ titulo: z.string().trim().max(200).optional(), projectId: z.string().optional(), proyecto: z.string().max(300).optional() }),
  outputSchema: z.object({ id: z.string(), version: z.number() }),
  execute: async ({ input, context }) => {
    exigirAccesoGuias(context);
    const estado = { ...estadoVacio(), proyecto: input.proyecto ?? '' };
    const base = (input.titulo || input.proyecto || 'Guía sin nombre').trim().slice(0, TOPE_TITULO - 10);
    let titulo = base;
    if (input.projectId) {
      const { rows } = await pool.query('select titulo from guias_topicos where project_id = $1::uuid and deleted_at is null', [input.projectId]);
      const usados = new Set(rows.map((r: { titulo: string }) => r.titulo));
      for (let n = 2; usados.has(titulo); n++) titulo = `${base} (${n})`;
    }
    const g: any = await GuiasTopicos.create({
      record: {
        titulo,
        estado, version: 1,
        ...(input.projectId ? { project: [input.projectId] } : {}),
        createdBy: [context.user!.id],
      } as any,
    });
    return { id: g.id, version: 1 };
  },
});
