import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';
import { exigirAccesoFormularios } from '../serverUtils/formularios/acceso';
import { reunionesDelProyecto } from '../serverUtils/formularios/insumos';

/** Reuniones de Notetaker con transcripción del proyecto del filtro (o de su deal), para usarlas como insumo. */
export default createEndpoint({
  authenticated: true,
  description: 'Lista las reuniones de Notetaker con transcripción del proyecto de un filtro',
  inputSchema: z.object({ formularioId: z.string() }),
  outputSchema: z.object({
    reuniones: z.array(z.object({ id: z.string(), titulo: z.string(), fecha: z.string().optional(), tipo: z.string().optional() })),
  }),
  execute: async ({ input, context }) => {
    exigirAccesoFormularios(context);
    const { rows: [f] } = await pool.query(`select proyecto_id from formularios where id = $1`, [input.formularioId]);
    if (!f?.proyecto_id) return { reuniones: [] };
    return { reuniones: await reunionesDelProyecto(f.proyecto_id) };
  },
});
