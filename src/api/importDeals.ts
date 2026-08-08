import { z } from 'zod';
import { createEndpoint, Deals, ZiteError } from '../../server/compat';

const dealSchema = z.object({
  dealName: z.string().optional(),
  statusPropuesta: z.string().optional(),
  phase: z.string().optional(),
  client: z.string().optional(),
  tematica: z.string().optional(),
  empresaOperadora: z.string().optional(),
  puntoDeContacto: z.string().optional(),
  proposalDate: z.string().optional(),
  hechaPor: z.string().optional(),
  approvalDate: z.string().optional(),
  currency: z.string().optional(),
  clientPrice: z.number().optional(),
  taxesPct: z.number().optional(),
  quotedCost: z.number().optional(),
  fechaDeBrief: z.string().optional(),
  fechaPerdida: z.string().optional(),
  projectType: z.string().optional(),
  gerente: z.string().optional(),
});

export default createEndpoint({
  authenticated: true,
  description: 'Import deals from CSV. Admin only.',
  inputSchema: z.object({
    deals: z.array(dealSchema),
  }),
  outputSchema: z.object({
    created: z.number(),
    total: z.number(),
  }),
  execute: async ({ input, context }) => {
    if (context.user!.role !== 'Owner' && context.user!.role !== 'Socio') {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Solo administradores pueden importar datos.' });
    }

    const records = input.deals.map(d => ({
      dealName: d.dealName,
      statusPropuesta: d.statusPropuesta,
      phase: d.phase,
      client: d.client,
      tematica: d.tematica,
      empresaOperadora: d.empresaOperadora,
      puntoDeContacto: d.puntoDeContacto,
      proposalDate: d.proposalDate || undefined,
      hechaPor: d.hechaPor,
      approvalDate: d.approvalDate || undefined,
      currency: d.currency,
      clientPrice: d.clientPrice,
      taxesPct: d.taxesPct,
      quotedCost: d.quotedCost,
      fechaDeBrief: d.fechaDeBrief || undefined,
      fechaPerdida: d.fechaPerdida || undefined,
      projectType: d.projectType,
      gerente: d.gerente,
    }));

    const CHUNK = 100;
    let created = 0;
    for (let i = 0; i < records.length; i += CHUNK) {
      const chunk = records.slice(i, i + CHUNK);
      const result = await Deals.bulkCreate({ records: chunk });
      created += result.records.length;
    }

    return { created, total: input.deals.length };
  },
});
