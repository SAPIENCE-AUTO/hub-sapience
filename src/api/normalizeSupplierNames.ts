import { z } from 'zod';
import { createEndpoint, Suppliers, PurchaseOrders } from '../../server/compat';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export default createEndpoint({
  authenticated: true,
  description: 'Normalize supplier name variants in Purchase Orders to a single canonical name. Optionally creates a Supplier record.',
  inputSchema: z.object({
    canonicalName: z.string(),
    variantNames: z.array(z.string()),
    createSupplier: z.boolean(),
  }),
  outputSchema: z.object({
    posUpdated: z.number(),
    supplierCreated: z.boolean(),
  }),
  execute: async ({ input }) => {
    const { canonicalName, variantNames, createSupplier } = input;

    // Variants to replace (exclude canonical itself if included)
    const toReplace = new Set(variantNames.filter(n => n !== canonicalName));
    if (toReplace.size === 0 && !createSupplier) {
      return { posUpdated: 0, supplierCreated: false };
    }

    let posUpdated = 0;

    if (toReplace.size > 0) {
      let offset = 0;
      while (true) {
        const { records, hasMore } = await PurchaseOrders.findAll({
          fields: ['supplierName'],
          limit: 500,
          offset,
        });

        const toUpdate = records.filter(po => toReplace.has(po.supplierName ?? ''));

        for (let i = 0; i < toUpdate.length; i++) {
          await PurchaseOrders.update({ id: toUpdate[i].id, record: { supplierName: canonicalName } });
          posUpdated++;
          if (i > 0 && i % 10 === 0) await sleep(200);
        }

        if (!hasMore) break;
        offset += records.length;
        await sleep(150);
      }
    }

    let supplierCreated = false;
    if (createSupplier) {
      await Suppliers.bulkCreate({
        records: [{ supplierName: canonicalName }],
        matchOn: ['supplierName'],
      });
      supplierCreated = true;
    }

    return { posUpdated, supplierCreated };
  },
});
