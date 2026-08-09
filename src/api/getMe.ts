import { z } from 'zod';
import { createEndpoint } from '../../server/compat';

export default createEndpoint({
  authenticated: true,
  description: 'Returns the profile of the currently authenticated user (resolved from the users table).',
  inputSchema: z.object({}),
  outputSchema: z.object({
    id: z.string(),
    email: z.string(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    role: z.string().optional(),
    purchaseLevel: z.string().optional(),
    costCenters: z.array(z.string()).optional(),
    accessComercial: z.string().optional(),
    accessOperacion: z.string().optional(),
    accessAdmin: z.string().optional(),
    accessFinanzas: z.string().optional(),
    accessOtros: z.string().optional(),
    maxApprovalAmount: z.number().optional(),
    visiblePages: z.array(z.string()).optional(),
    dashboardWidgets: z.array(z.string()).optional(),
  }),
  execute: async ({ context }) => ({ ...context.user! }) as any,
});
