import { z } from 'zod';
import { createEndpoint, Expenses, ExpenseAuditLog, ZiteError } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  authenticated: true,
  description: 'Reject an expense and return it to Rechazado status',
  inputSchema: z.object({ id: z.string(), rejectionReason: z.string() }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    const level = context.user!.purchaseLevel ?? 'Creador';
    if (level !== 'Aprobador' && level !== 'Finanzas' && level !== 'Socios') {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'No tienes permisos para rechazar gastos' });
    }

    const expense = await Expenses.findOne({ id: input.id });
    if (!expense) throw new ZiteError({ code: 'NOT_FOUND', message: 'Gasto no encontrado' });
    if (expense.status !== 'Enviado a aprobación') {
      throw new ZiteError({ code: 'BAD_REQUEST', message: 'Solo se pueden rechazar gastos en estado "Enviado a aprobación"' });
    }

    await Expenses.update({
      id: input.id,
      record: {
        status: 'Rechazado',
        rejectionReason: input.rejectionReason,
        approvedBy: context.user!.email,
      },
    });

    const userName = [context.user!.firstName, context.user!.lastName].filter(Boolean).join(' ') || context.user!.email;
    await ExpenseAuditLog.create({
      record: {
        timestamp: new Date().toISOString(),
        expense: input.id,
        action: 'Rechazado',
        userEmail: context.user!.email,
        userName,
        comments: input.rejectionReason,
        expenseNumber: String(expense.expenseNumber ?? ''),
      },
    });

    return { success: true };
  },
});
