import { z } from 'zod';
import { createEndpoint, PettyCashFunds } from '../../server/compat';

export default createEndpoint({
  authenticated: true,
  description: 'Get petty cash funds — all for finance roles, active-only for others',
  inputSchema: z.object({}),
  outputSchema: z.object({
    funds: z.array(z.object({
      id: z.string(),
      fundName: z.string().optional().nullable(),
      initialAmount: z.number().optional().nullable(),
      currentBalance: z.number().optional().nullable(),
      costCenter: z.string().optional().nullable(),
      status: z.string().optional().nullable(),
      lastReplenishmentDate: z.string().optional().nullable(),
      notes: z.string().optional().nullable(),
    })),
  }),
  execute: async ({ context }) => {
    const isFinance = ['Admin', 'Admin Financiero', 'Finanzas'].includes(context.user!.role ?? '');
    const filters = isFinance ? {} : { status: 'Activo' };

    const { records } = await PettyCashFunds.findAll({ filters: filters as never });
    return {
      funds: records.map(f => ({
        id: f.id,
        fundName: f.fundName ?? null,
        initialAmount: f.initialAmount ?? null,
        currentBalance: f.currentBalance ?? null,
        costCenter: f.costCenter ?? null,
        status: f.status ?? null,
        lastReplenishmentDate: f.lastReplenishmentDate ?? null,
        notes: f.notes ?? null,
      })),
    };
  },
});
