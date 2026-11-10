import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';
import { exigirAccesoIndicadores } from '../serverUtils/indicadores/acceso';
import { AliasSchema, DestinoSchema, ReclutadorSchema, asignar, traducirFaltaTablas } from '../serverUtils/indicadores/reclutadoresAlmacen';

/**
 * Junta formas de escribir el nombre bajo un reclutador (uno que ya existe o uno nuevo), las marca «no es reclutador» o las deja sin
 * asignar otra vez. Devuelve la lista de reclutadores y lo que cambió, para que la pantalla no tenga que volver a pedirlo todo.
 */
export default createEndpoint({
  authenticated: true,
  description: 'Asigna formas de escribir el nombre del reclutador a un reclutador, o las marca «no es reclutador» — solo Sergio',
  inputSchema: z.object({
    asignaciones: z.array(z.object({
      claves: z.array(z.string().min(1).max(160)).min(1).max(3000),
      destino: DestinoSchema,
    })).min(1).max(100),
  }),
  outputSchema: z.object({ reclutadores: z.array(ReclutadorSchema), cambios: z.array(AliasSchema) }),
  execute: async ({ input, context }) => {
    exigirAccesoIndicadores(context);
    try {
      // Con `strict` apagado zod deja `destino` como opcional en el tipo; el esquema de arriba ya lo exige.
      return await asignar(pool, input.asignaciones as Parameters<typeof asignar>[1], context.user?.email ?? '');
    } catch (err) {
      return traducirFaltaTablas(err);
    }
  },
});
