import { z } from 'zod';
import { createEndpoint, ZiteError } from '../../server/compat';
import { exigirAccesoIndicadores } from '../serverUtils/indicadores/acceso';
import { MENSAJE_SIN_TABLAS, faltaLaTabla, guardarMeta } from '../serverUtils/indicadores/almacen';

/** Guarda (o borra, con valor null) la meta de un indicador. Todas las metas de Reclutamiento son porcentajes. */
export default createEndpoint({
  authenticated: true,
  description: 'Guarda la meta de un indicador de área — solo Sergio',
  inputSchema: z.object({
    area: z.literal('reclutamiento'),
    indicador: z.string().regex(/^(noElegibles|avisosRespetados|duplicados|repetidores_[2-5])$/),
    valor: z.number().min(0).max(100).nullable(),
  }),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async ({ input, context }) => {
    exigirAccesoIndicadores(context);
    try {
      await guardarMeta(input.area, input.indicador, input.valor, context.user?.email ?? '');
    } catch (err) {
      if (faltaLaTabla(err)) throw new ZiteError({ code: 'INTERNAL_ERROR', message: MENSAJE_SIN_TABLAS });
      throw err;
    }
    return { ok: true };
  },
});
