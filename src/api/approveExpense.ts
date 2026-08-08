import { z } from 'zod';
import { createEndpoint, Expenses, ApprovalLimits, PettyCashFunds, ExpenseAuditLog, ZiteError } from '../../server/compat';
import { fmtCurrency } from '../lib/format';

export default createEndpoint({
  authenticated: true,
  description: 'Approve an expense with limit validation',
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    const level = context.user!.purchaseLevel ?? 'Creador';
    if (level !== 'Aprobador' && level !== 'Finanzas' && level !== 'Socios') {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'No tienes permisos para aprobar gastos' });
    }

    const expense = await Expenses.findOne({ id: input.id });
    if (!expense) throw new ZiteError({ code: 'NOT_FOUND', message: 'Gasto no encontrado' });
    if (expense.status !== 'Enviado a aprobación') {
      throw new ZiteError({ code: 'BAD_REQUEST', message: 'Solo se pueden aprobar gastos en estado "Enviado a aprobación"' });
    }

    if (level === 'Aprobador') {
      const costCenters = context.user!.costCenters ?? [];
      if (expense.costCenter && !costCenters.includes(expense.costCenter)) {
        throw new ZiteError({ code: 'FORBIDDEN', message: 'Solo puedes aprobar gastos de tu área' });
      }
    }

    if (level !== 'Socios') {
      const personalLimit = context.user!.maxApprovalAmount;
      let effectiveLimit: number | null = null;

      if (personalLimit != null && personalLimit > 0) {
        effectiveLimit = personalLimit;
      } else {
        const { records: limits } = await ApprovalLimits.findAll({
          filters: { approvalLevel: level, costCenter: expense.costCenter } as never,
          limit: 1,
        });
        if (limits.length > 0 && limits[0].maxAmount != null) {
          effectiveLimit = limits[0].maxAmount;
        }
      }

      if (effectiveLimit != null) {
        const amt = expense.amount ?? 0;
        if (amt > effectiveLimit) {
          throw new ZiteError({
            code: 'FORBIDDEN',
            message: `El monto (${fmtCurrency(amt)}) excede tu límite de aprobación (${fmtCurrency(effectiveLimit)})`,
          });
        }
      }
    }

    await Expenses.update({ id: input.id, record: { status: 'Aprobado', approvedBy: context.user!.email } });

    // Deduct from petty cash fund if applicable
    if (expense.paymentMethod === 'Caja chica') {
      const fund = expense.pettyCashFund;
      const fundId = Array.isArray(fund) ? fund[0] : (fund ? String(fund) : null);
      if (fundId) {
        const pcFund = await PettyCashFunds.findOne({ id: fundId });
        if (pcFund && pcFund.currentBalance != null) {
          await PettyCashFunds.update({
            id: fundId,
            record: { currentBalance: pcFund.currentBalance - (expense.amount ?? 0) },
          });
        }
      }
    }

    const userName = [context.user!.firstName, context.user!.lastName].filter(Boolean).join(' ') || context.user!.email;
    await ExpenseAuditLog.create({
      record: {
        timestamp: new Date().toISOString(),
        expense: input.id,
        action: 'Aprobado',
        userEmail: context.user!.email,
        userName,
        expenseNumber: String(expense.expenseNumber ?? ''),
      },
    });

    return { success: true };
  },
});
