import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';
import { exigirAccesoIndicadores } from '../serverUtils/indicadores/acceso';
import { eliminar, traducirFaltaTablas } from '../serverUtils/indicadores/reclutadoresAlmacen';

/** Borra a un reclutador; las formas de escribir su nombre quedan sin asignar otra vez (se devuelven cuáles). */
export default createEndpoint({
  authenticated: true,
  description: 'Borra un reclutador y deja sin asignar las formas de escribir su nombre — solo Sergio',
  inputSchema: z.object({ id: z.string().uuid() }),
  outputSchema: z.object({ claves: z.array(z.string()) }),
  execute: async ({ input, context }) => {
    exigirAccesoIndicadores(context);
    try {
      return { claves: await eliminar(pool, input.id) };
    } catch (err) {
      return traducirFaltaTablas(err);
    }
  },
});
