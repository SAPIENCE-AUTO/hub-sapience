import { z } from 'zod';
import { createEndpoint, Expenses, ExpenseAuditLog, ZiteError } from '../../server/compat';

export default createEndpoint({
  authenticated: true,
  description: 'Delete an expense (only Borrador/Rechazado, only creator or Admin)',
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    const expense = await Expenses.findOne({ id: input.id });
    if (!expense) throw new ZiteError({ code: 'NOT_FOUND', message: 'Gasto no encontrado' });

    const role = context.user!.role ?? '';
    const isAdmin = ['Admin', 'Admin Financiero'].includes(role);
    if (expense.createdBy !== context.user!.email && !isAdmin) {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Solo el creador puede eliminar este gasto' });
    }
    if (expense.status !== 'Borrador' && expense.status !== 'Rechazado') {
      throw new ZiteError({ code: 'BAD_REQUEST', message: 'Solo se pueden eliminar gastos en estado Borrador o Rechazado' });
    }

    const userName = [context.user!.firstName, context.user!.lastName].filter(Boolean).join(' ') || context.user!.email;
    await ExpenseAuditLog.create({
      record: {
        timestamp: new Date().toISOString(),
        expense: input.id,
        action: 'Eliminado',
        userEmail: context.user!.email,
        userName,
        expenseNumber: String(expense.expenseNumber ?? ''),
      },
    });

    await Expenses.delete({ id: input.id });
    return { success: true };
  },
});
