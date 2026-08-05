import { z } from 'zod';
import { createEndpoint, Deals } from '../../server/compat';

const DealOut = z.object({
  id: z.string(),
  dealName: z.string().optional(),
  phase: z.string().optional(),
  client: z.string().optional(),
  projectType: z.string().optional(),
  tematica: z.string().optional(),
  owner: z.array(z.string()).optional(),
  proposalDate: z.string().optional(),
  approvalDate: z.string().optional(),
  currency: z.string().optional(),
  clientPrice: z.number().optional(),
  taxesPct: z.number().optional(),
  retencionesPct: z.number().optional(),
  quotedCost: z.number().optional(),
  notes: z.string().optional(),
  empresaOperadora: z.string().optional(),
  exchangeRate: z.number().optional(),
  rowIndex: z.number().optional(),
});

export default createEndpoint({
  authenticated: true,
  description: 'Get all deals',
  inputSchema: z.object({}),
  outputSchema: z.object({ deals: z.array(DealOut) }),
  execute: async () => {
    const result = await Deals.findAll({});
    return {
      deals: result.records.map((d, i) => ({
        rowIndex: i,
        id: d.id,
        dealName: d.dealName,
        phase: d.phase,
        client: d.client,
        projectType: d.projectType,
        tematica: d.tematica,
        owner: Array.isArray(d.owner) ? d.owner : d.owner ? [d.owner] : undefined,
        proposalDate: d.proposalDate,
        approvalDate: d.approvalDate,
        currency: d.currency,
        clientPrice: d.clientPrice,
        taxesPct: d.taxesPct,
        retencionesPct: d.retenciones,
        quotedCost: d.quotedCost,
        notes: d.notes,
        empresaOperadora: d.empresaOperadora,
        exchangeRate: d.exchangeRate,
      })),
    };
  },
});
