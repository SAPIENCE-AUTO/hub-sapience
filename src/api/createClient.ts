import { z } from 'zod';
import { createEndpoint, ZiteError, Clients, pool } from '../../server/compat';
import { exigirAccesoClientes } from '../serverUtils/clientes/acceso';

export default createEndpoint({
  authenticated: true,
  description: 'Crea un cliente en el catálogo (solo el nombre; razones sociales y condiciones de cobro se capturan en su ficha) — restringido a Owner o Finanzas',
  inputSchema: z.object({ name: z.string() }),
  outputSchema: z.object({ id: z.string(), name: z.string() }),
  execute: async ({ input, context }) => {
    exigirAccesoClientes(context);
    const name = input.name.replace(/\s+/g, ' ').trim();
    if (name.length < 2 || name.length > 120) {
      throw new ZiteError({ code: 'BAD_REQUEST', message: 'Escribe el nombre del cliente (entre 2 y 120 caracteres).' });
    }
    // Mismo criterio que el índice único de `clients`: sin importar mayúsculas ni espacios de los lados.
    const { rows } = await pool.query(`select name from clients where lower(trim(name)) = lower(trim($1)) limit 1`, [name]);
    if (rows[0]) {
      throw new ZiteError({ code: 'BAD_REQUEST', message: `Ya existe un cliente llamado «${rows[0].name}».` });
    }
    const record = await Clients.create({ record: { name } });
    return { id: record.id, name };
  },
});
