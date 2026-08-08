import { z } from 'zod';
import { createEndpoint, PettyCashFunds, ZiteError } from '../../server/compat';

export default createEndpoint({
  authenticated: true,
  description: 'Create or update a petty cash fund, or replenish its balance',
  inputSchema: z.object({
    id: z.string().optional(),
    action: z.enum(['save', 'replenish']),
    fundName: z.string().optional(),
    initialAmount: z.number().optional(),
    costCenter: z.string().optional(),
    status: z.string().optional(),
    notes: z.string().optional(),
    replenishAmount: z.number().optional(),
  }),
  outputSchema: z.object({ id: z.string(), success: z.boolean() }),
  execute: async ({ input, context }) => {
    const role = context.user!.role ?? '';
    if (!['Admin', 'Admin Financiero', 'Finanzas'].includes(role)) {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'No tienes permisos para gestionar fondos de caja chica' });
    }

    if (input.action === 'replenish') {
      if (!input.id) throw new ZiteError({ code: 'BAD_REQUEST', message: 'Se requiere el ID del fondo' });
      const fund = await PettyCashFunds.findOne({ id: input.id });
      if (!fund) throw new ZiteError({ code: 'NOT_FOUND', message: 'Fondo no encontrado' });
      await PettyCashFunds.update({
        id: input.id,
        record: {
          currentBalance: (fund.currentBalance ?? 0) + (input.replenishAmount ?? 0),
          lastReplenishmentDate: new Date().toISOString().split('T')[0],
        },
      });
      return { id: input.id, success: true };
    }

    if (input.id) {
      await PettyCashFunds.update({
        id: input.id,
        record: {
          fundName: input.fundName,
          costCenter: input.costCenter,
          status: input.status,
          notes: input.notes,
        },
      });
      return { id: input.id, success: true };
    }

    if (!input.fundName) throw new ZiteError({ code: 'BAD_REQUEST', message: 'El nombre del fondo es requerido' });
    const created = await PettyCashFunds.create({
      record: {
        fundName: input.fundName,
        initialAmount: input.initialAmount,
        currentBalance: input.initialAmount,
        costCenter: input.costCenter,
        status: 'Activo',
        notes: input.notes,
      },
    });
    return { id: created.id, success: true };
  },
});
