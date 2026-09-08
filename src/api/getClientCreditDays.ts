import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';

export default createEndpoint({
  authenticated: true,
  description: 'Días de crédito precargados para un cliente (registro clients) — usado al arrancar un proceso de cobranza',
  inputSchema: z.object({ client: z.string() }),
  outputSchema: z.object({ creditDays: z.number().nullable() }),
  execute: async ({ input }) => {
    const name = input.client.trim();
    if (!name) return { creditDays: null };
    const { rows } = await pool.query(
      `select credit_days from clients where lower(name) = lower($1) limit 1`,
      [name],
    );
    return { creditDays: rows[0]?.credit_days ?? null };
  },
});
