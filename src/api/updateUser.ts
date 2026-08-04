import { z } from 'zod';
import { createEndpoint, ZiteError, Users } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  authenticated: true,
  description: 'Update permission fields for a user. Requires Administrar access in at least one section.',
  inputSchema: z.object({
    id: z.string(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    role: z.string().optional(),
    departamento: z.string().optional(),
    accessComercial: z.string().optional(),
    accessOperacion: z.string().optional(),
    accessAdmin: z.string().optional(),
    accessFinanzas: z.string().optional(),
    accessOtros: z.string().optional(),
    purchaseLevel: z.string().optional(),
    costCenters: z.array(z.string()).optional(),
    maxApprovalAmount: z.number().optional(),
    visiblePages: z.array(z.string()).optional(),
    dashboardWidgets: z.array(z.string()).optional(),
    hiddenFromChat: z.boolean().optional(),
    cotizacionRubros: z.array(z.string()).optional(),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    const u = context.user!;
    const isAdmin = u.role === 'Owner' || u.role === 'Socio' ||
      u.accessComercial === 'Administrar' ||
      u.accessOperacion === 'Administrar' ||
      u.accessAdmin === 'Administrar' ||
      u.accessFinanzas === 'Administrar' ||
      u.accessOtros === 'Administrar';

    if (!isAdmin) throw new ZiteError({ code: 'FORBIDDEN', message: 'No tienes permisos para editar usuarios' });

    await Users.update({
      id: input.id,
      record: {
        firstName: input.firstName,
        lastName: input.lastName,
        role: input.role,
        departamento: input.departamento,
        accessComercial: input.accessComercial,
        accessOperacion: input.accessOperacion,
        accessAdmin: input.accessAdmin,
        accessFinanzas: input.accessFinanzas,
        accessOtros: input.accessOtros,
        purchaseLevel: input.purchaseLevel,
        costCenters: input.costCenters,
        maxApprovalAmount: input.maxApprovalAmount,
        visiblePages: input.visiblePages,
        dashboardWidgets: input.dashboardWidgets,
        hiddenFromChat: input.hiddenFromChat,
        cotizacionRubros: input.cotizacionRubros as any,
      },
    });

    return { success: true };
  },
});
