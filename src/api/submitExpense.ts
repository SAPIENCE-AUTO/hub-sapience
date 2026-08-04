import { z } from 'zod';
import { createEndpoint, Expenses, ExpenseAuditLog, ZiteError } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  authenticated: true,
  description: 'Submit an expense for approval',
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    const expense = await Expenses.findOne({ id: input.id });
    if (!expense) throw new ZiteError({ code: 'NOT_FOUND', message: 'Gasto no encontrado' });
    if (expense.createdBy !== context.user!.email) {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Solo el creador puede enviar este gasto a aprobación' });
    }
    if (expense.status !== 'Borrador' && expense.status !== 'Rechazado') {
      throw new ZiteError({ code: 'BAD_REQUEST', message: 'Solo se pueden enviar gastos en estado Borrador o Rechazado' });
    }

    await Expenses.update({ id: input.id, record: { status: 'Enviado a aprobación' } });

    const userName = [context.user!.firstName, context.user!.lastName].filter(Boolean).join(' ') || context.user!.email;
    await ExpenseAuditLog.create({
      record: {
        timestamp: new Date().toISOString(),
        expense: input.id,
        action: 'Enviado a aprobación',
        userEmail: context.user!.email,
        userName,
        expenseNumber: String(expense.expenseNumber ?? ''),
      },
    });

    return { success: true };
  },
});
