import { z } from 'zod';
import { createEndpoint, Expenses, ExpenseLineItems } from 'zite-integrations-backend-sdk';

const expenseOut = z.object({
  id: z.string(),
  expenseNumber: z.number().optional().nullable(),
  description: z.string().optional().nullable(),
  amount: z.number().optional().nullable(),
  category: z.string().optional().nullable(),
  paymentMethod: z.string().optional().nullable(),
  costCenter: z.string().optional().nullable(),
  projectCode: z.string().optional().nullable(),
  currency: z.string().optional().nullable(),
  expenseDate: z.string().optional().nullable(),
  status: z.string().optional().nullable(),
  receipt: z.array(z.object({ url: z.string() })).optional().nullable(),
  notes: z.string().optional().nullable(),
  createdBy: z.string().optional().nullable(),
  approvedBy: z.string().optional().nullable(),
  rejectionReason: z.string().optional().nullable(),
  pettyCashFundId: z.string().optional().nullable(),
  createdAt: z.string().optional().nullable(),
  lineItemCount: z.number(),
});

export default createEndpoint({
  authenticated: true,
  description: 'Get expenses with optional filters',
  inputSchema: z.object({
    status: z.string().optional(),
    category: z.string().optional(),
    paymentMethod: z.string().optional(),
    costCenter: z.string().optional(),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
  }),
  outputSchema: z.object({
    expenses: z.array(expenseOut),
    isFinanceUser: z.boolean(),
  }),
  execute: async ({ input, context }) => {
    const isFinance = ['Finanzas', 'Admin', 'Admin Financiero'].includes(context.user!.role ?? '');

    const filters: Record<string, unknown> = {};
    if (input.status) filters.status = input.status;
    if (input.category) filters.category = input.category;
    if (input.paymentMethod) filters.paymentMethod = input.paymentMethod;
    if (input.costCenter) filters.costCenter = input.costCenter;
    if (!isFinance) filters.createdBy = context.user!.email;

    const { records } = await Expenses.findAll({ filters: filters as never, limit: 500 });

    let expenses = records;
    if (input.dateFrom || input.dateTo) {
      expenses = records.filter(e => {
        if (!e.expenseDate) return true;
        if (input.dateFrom && e.expenseDate < input.dateFrom) return false;
        if (input.dateTo && e.expenseDate > input.dateTo) return false;
        return true;
      });
    }

    expenses.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));

    // Batch fetch line item counts
    const lineCountMap: Record<string, number> = {};
    try {
      const { records: liRecords } = await ExpenseLineItems.findAll({
        limit: 2000,
        fields: ['expense'],
      });
      for (const li of liRecords) {
        const expId = Array.isArray(li.expense) ? li.expense[0] : li.expense;
        if (expId && typeof expId === 'string') {
          lineCountMap[expId] = (lineCountMap[expId] ?? 0) + 1;
        }
      }
    } catch {
      // non-critical — fallback to 0 counts
    }

    return {
      expenses: expenses.map(e => {
        const fund = e.pettyCashFund;
        const fundId = Array.isArray(fund) ? (fund[0] ?? null) : (fund ? String(fund) : null);
        return {
          id: e.id,
          expenseNumber: typeof e.expenseNumber === 'number' ? e.expenseNumber : null,
          description: e.description ?? null,
          amount: e.amount ?? null,
          category: e.category ?? null,
          paymentMethod: e.paymentMethod ?? null,
          costCenter: e.costCenter ?? null,
          projectCode: e.projectCode ?? null,
          currency: e.currency ?? null,
          expenseDate: e.expenseDate ?? null,
          status: e.status ?? null,
          receipt: (e.receipt as { url: string }[] | undefined) ?? null,
          notes: e.notes ?? null,
          createdBy: e.createdBy ?? null,
          approvedBy: e.approvedBy ?? null,
          rejectionReason: e.rejectionReason ?? null,
          pettyCashFundId: fundId,
          createdAt: e.createdAt ?? null,
          lineItemCount: lineCountMap[e.id] ?? 0,
        };
      }),
      isFinanceUser: isFinance,
    };
  },
});
