import { z } from 'zod';
import { createEndpoint, PurchaseOrders } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  authenticated: true,
  description: 'Get PO IDs that need attention for the current user',
  inputSchema: z.object({}),
  outputSchema: z.object({
    items: z.array(z.object({ id: z.string(), status: z.string() })),
  }),
  execute: async ({ context }) => {
    if (!context?.user) return { items: [] };
    const { user } = context;
    const level = user.purchaseLevel ?? 'Creador';
    const items: { id: string; status: string }[] = [];
    const seenIds = new Set<string>();

    // 1. ODCs pending approval (if user has approval permissions)
    if (level !== 'Creador') {
      const { records: pending } = await PurchaseOrders.findAll({
        filters: { status: 'Enviada a aprobación' } as never,
        fields: ['id', 'status', 'category', 'createdBy'],
        limit: 500,
      });

      for (const po of pending) {
        // Skip own ODCs (you don't approve your own)
        if (po.createdBy === user.email) continue;
        // Área: only see their cost centers
        if (level === 'Aprobador') {
          const costCenters = user.costCenters ?? [];
          if (po.category && !costCenters.includes(po.category)) continue;
        }
        if (!seenIds.has(po.id)) {
          items.push({ id: po.id, status: po.status ?? 'Enviada a aprobación' });
          seenIds.add(po.id);
        }
      }
    }

    // 2. ODCs created by this user that reached Aprobada or Cancelada
    const { records: myChanged } = await PurchaseOrders.findAll({
      filters: { createdBy: user.email, status: { in: ['Aprobada', 'Cancelada'] } } as never,
      fields: ['id', 'status'],
      limit: 500,
    });
    for (const po of myChanged) {
      if (!seenIds.has(po.id)) {
        items.push({ id: po.id, status: po.status ?? '' });
        seenIds.add(po.id);
      }
    }

    return { items };
  },
});
