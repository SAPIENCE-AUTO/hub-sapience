import { z } from 'zod';
import { createEndpoint, Expenses, ExpenseLineItems, ExpenseAuditLog, ZiteError } from '../../server/compat';

const lineItemSchema = z.object({
  id: z.string().optional(),
  description: z.string(),
  category: z.string(),
  amount: z.number(),
  date: z.string().optional(),
  receipt: z.array(z.object({ url: z.string(), name: z.string() })).optional(),
  notes: z.string().optional(),
});

export default createEndpoint({
  authenticated: true,
  description: 'Create or update an expense with optional line items',
  inputSchema: z.object({
    id: z.string().optional(),
    description: z.string(),
    amount: z.number().optional(),
    category: z.string().optional(),
    paymentMethod: z.string(),
    costCenter: z.string(),
    projectCode: z.string().optional(),
    currency: z.string().optional(),
    expenseDate: z.string().optional(),
    notes: z.string().optional(),
    receipt: z.array(z.object({ url: z.string(), name: z.string() })).optional(),
    pettyCashFundId: z.string().optional(),
    lineItems: z.array(lineItemSchema).optional(),
    deletedLineItemIds: z.array(z.string()).optional(),
  }),
  outputSchema: z.object({ id: z.string(), success: z.boolean() }),
  execute: async ({ input, context }) => {
    const userName = [context.user!.firstName, context.user!.lastName].filter(Boolean).join(' ') || context.user!.email;
    const fundLink = input.pettyCashFundId ? [input.pettyCashFundId] : ([] as string[]);
    const receiptAttachments = input.receipt?.map(r => ({ url: r.url }));

    // Calculate total from line items if provided
    const hasLines = input.lineItems && input.lineItems.length > 0;
    const linesTotal = hasLines
      ? input.lineItems!.reduce((s, l) => s + (l.amount ?? 0), 0)
      : undefined;
    const amount = linesTotal ?? input.amount ?? 0;

    let expenseId: string;

    if (input.id) {
      const existing = await Expenses.findOne({ id: input.id });
      if (!existing) throw new ZiteError({ code: 'NOT_FOUND', message: 'Gasto no encontrado' });

      const isAdmin = ['Admin', 'Admin Financiero', 'Finanzas'].includes(context.user!.role ?? '');
      if (existing.createdBy !== context.user!.email && !isAdmin) {
        throw new ZiteError({ code: 'FORBIDDEN', message: 'Solo el creador puede editar este gasto' });
      }
      if (existing.status !== 'Borrador' && existing.status !== 'Rechazado') {
        throw new ZiteError({ code: 'BAD_REQUEST', message: 'Solo se pueden editar gastos en estado Borrador o Rechazado' });
      }

      await Expenses.update({
        id: input.id,
        record: {
          description: input.description,
          amount,
          category: input.category,
          paymentMethod: input.paymentMethod,
          costCenter: input.costCenter,
          projectCode: input.projectCode,
          currency: input.currency ?? 'MXN',
          expenseDate: input.expenseDate,
          notes: input.notes,
          receipt: receiptAttachments as { url: string }[] | undefined,
          pettyCashFund: fundLink,
        },
      });

      expenseId = input.id;

      await ExpenseAuditLog.create({
        record: {
          timestamp: new Date().toISOString(),
          expense: input.id,
          action: 'Editado',
          userEmail: context.user!.email,
          userName,
          expenseNumber: String(existing.expenseNumber ?? ''),
        },
      });
    } else {
      const created = await Expenses.create({
        record: {
          description: input.description,
          amount,
          category: input.category,
          paymentMethod: input.paymentMethod,
          costCenter: input.costCenter,
          projectCode: input.projectCode,
          currency: input.currency ?? 'MXN',
          expenseDate: input.expenseDate,
          notes: input.notes,
          receipt: receiptAttachments as { url: string }[] | undefined,
          status: 'Borrador',
          createdBy: context.user!.email,
          pettyCashFund: fundLink,
        },
      });

      expenseId = created.id;

      await ExpenseAuditLog.create({
        record: {
          timestamp: new Date().toISOString(),
          expense: created.id,
          action: 'Creado',
          userEmail: context.user!.email,
          userName,
          expenseNumber: String((created as unknown as { expenseNumber?: number }).expenseNumber ?? ''),
        },
      });
    }

    // Handle deletions
    if (input.deletedLineItemIds?.length) {
      await Promise.all(input.deletedLineItemIds.map(id => ExpenseLineItems.delete({ id })));
    }

    // Handle line items creates/updates
    if (input.lineItems && input.lineItems.length > 0) {
      const toCreate = input.lineItems.filter(li => !li.id);
      const toUpdate = input.lineItems.filter(li => !!li.id);

      if (toCreate.length > 0) {
        await ExpenseLineItems.bulkCreate({
          records: toCreate.map(li => ({
            description: li.description,
            expense: expenseId,
            category: li.category,
            amount: li.amount,
            date: li.date,
            receipt: li.receipt?.map(r => ({ url: r.url })) as { url: string }[] | undefined,
            notes: li.notes,
          })),
        });
      }

      for (const li of toUpdate) {
        await ExpenseLineItems.update({
          id: li.id!,
          record: {
            description: li.description,
            category: li.category,
            amount: li.amount,
            date: li.date,
            receipt: li.receipt?.map(r => ({ url: r.url })) as { url: string }[] | undefined,
            notes: li.notes,
          },
        });
      }
    }

    return { id: expenseId, success: true };
  },
});
