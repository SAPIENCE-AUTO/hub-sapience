import { z } from 'zod';
import { createEndpoint, ZiteError, ClientEntities, pool } from '../../server/compat';
import { exigirAccesoClientes } from '../serverUtils/clientes/acceso';

export default createEndpoint({
  authenticated: true,
  description: 'Desactiva o reactiva una razón social sin tocar sus datos: desactivada deja de ofrecerse al arrancar procesos de cobranza, pero no se borra — restringido a Owner o Finanzas',
  inputSchema: z.object({ id: z.string(), active: z.boolean() }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    exigirAccesoClientes(context);
    const { rows } = await pool.query(`select 1 from client_entities where id = $1`, [input.id]);
    if (!rows[0]) throw new ZiteError({ code: 'NOT_FOUND', message: 'Razón social no encontrada' });
    await ClientEntities.update({ id: input.id, record: { deactivatedAt: input.active ? null : new Date().toISOString() } });
    return { success: true };
  },
});
