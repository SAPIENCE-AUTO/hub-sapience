import { z } from 'zod';
import { createEndpoint, Suppliers, PurchaseOrders } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  authenticated: true,
  description: 'Merge duplicate supplier records: reassigns POs from duplicates to the primary supplier name, then deletes the duplicate supplier records.',
  inputSchema: z.object({
    primarySupplierId: z.string(),
    duplicateSupplierIds: z.array(z.string()),
  }),
  outputSchema: z.object({
    posUpdated: z.number(),
    suppliersDeleted: z.number(),
  }),
  execute: async ({ input }) => {
    // Get primary supplier name
    const primary = await Suppliers.findOne({ id: input.primarySupplierId });
    if (!primary || !primary.supplierName) {
      throw new Error('Proveedor principal no encontrado');
    }
    const primaryName = primary.supplierName;

    // Get all duplicate suppliers to know their names
    const duplicates: { id: string; name: string }[] = [];
    for (const id of input.duplicateSupplierIds) {
      const s = await Suppliers.findOne({ id });
      if (s && s.supplierName) duplicates.push({ id, name: s.supplierName });
    }

    // Reassign POs from each duplicate supplier name to the primary name
    let posUpdated = 0;
    for (const dup of duplicates) {
      if (dup.name === primaryName) continue;
      const { records: posToUpdate } = await PurchaseOrders.findAll({
        filters: { supplierName: dup.name },
        fields: ['id'],
        limit: 2000,
      });
      for (const po of posToUpdate) {
        await PurchaseOrders.update({ id: po.id, record: { supplierName: primaryName } });
        posUpdated++;
      }
    }

    // Delete duplicate supplier records
    let suppliersDeleted = 0;
    for (const dup of duplicates) {
      await Suppliers.delete({ id: dup.id });
      suppliersDeleted++;
    }

    return { posUpdated, suppliersDeleted };
  },
});
