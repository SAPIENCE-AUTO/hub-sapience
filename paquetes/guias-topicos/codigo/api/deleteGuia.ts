import { z } from 'zod';
import { createEndpoint, pool, ZiteError } from '../../server/compat';
import { exigirAccesoGuias } from '../serverUtils/guias/acceso';
import { cargarGuia, puedeBorrar } from '../serverUtils/guias/datos';

export default createEndpoint({
  authenticated: true,
  description: 'Borra una guía de tópicos (quien la creó)',
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async ({ input, context }) => {
    exigirAccesoGuias(context);
    const g = await cargarGuia(input.id);
    if (!puedeBorrar(context, g)) throw new ZiteError({ code: 'FORBIDDEN', message: 'Solo quien creó la guía la puede borrar.' });
    await pool.query('update guias_topicos set deleted_at = now() where id = $1', [input.id]);
    return { ok: true };
  },
});
