import { z } from 'zod';
import { createEndpoint, ZiteError, PurchaseOrders } from '../../server/compat';

export default createEndpoint({
  authenticated: true,
  description: 'Get the stored PDF base64 for a purchase order',
  inputSchema: z.object({ poId: z.string() }),
  outputSchema: z.object({ pdfBase64: z.string().nullable() }),
  execute: async ({ input }) => {
    const po = await PurchaseOrders.findOne({ id: input.poId, fields: ['pdfBase64'] });
    if (!po) throw new ZiteError({ code: 'NOT_FOUND', message: 'OC no encontrada' });
    return { pdfBase64: po.pdfBase64 ?? null };
  },
});
