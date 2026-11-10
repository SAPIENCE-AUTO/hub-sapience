import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';
import { exigirAccesoIndicadores } from '../serverUtils/indicadores/acceso';
import { ReclutadorSchema, renombrar, traducirFaltaTablas } from '../serverUtils/indicadores/reclutadoresAlmacen';

/** Cambia el nombre con el que sale un reclutador. No puede repetir el de otro (si son la misma persona, se juntan). */
export default createEndpoint({
  authenticated: true,
  description: 'Cambia el nombre de un reclutador — solo Sergio',
  inputSchema: z.object({ id: z.string().uuid(), nombre: z.string() }),
  outputSchema: z.object({ reclutador: ReclutadorSchema }),
  execute: async ({ input, context }) => {
    exigirAccesoIndicadores(context);
    try {
      return { reclutador: await renombrar(pool, input.id, input.nombre) };
    } catch (err) {
      return traducirFaltaTablas(err);
    }
  },
});
