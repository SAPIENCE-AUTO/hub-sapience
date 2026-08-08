import { z } from 'zod';
import { createEndpoint, ZiteError, Users } from '../../server/compat';

const TEST_EMAILS = ['antonio.velasco@agcmx.com', 'sergiovelascor@yahoo.com'];

export default createEndpoint({
  authenticated: true,
  description: 'Get all users with their permission fields. Requires Administrar access in at least one section.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    users: z.array(z.object({
      id: z.string(),
      email: z.string(),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      role: z.string().optional(),
      departamento: z.string().optional(),
      lastActiveAt: z.string().optional(),
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
      hiddenFromChat: z.boolean().optional(),
      cotizacionRubros: z.array(z.string()).optional(),
    })),
  }),
  execute: async ({ context }) => {
    const u = context.user!;
    const isAdmin = u.role === 'Owner' || u.role === 'Socio' ||
      u.accessComercial === 'Administrar' ||
      u.accessOperacion === 'Administrar' ||
      u.accessAdmin === 'Administrar' ||
      u.accessFinanzas === 'Administrar' ||
      u.accessOtros === 'Administrar';

    if (!isAdmin) throw new ZiteError({ code: 'FORBIDDEN', message: 'No tienes permisos para ver usuarios' });

    const { records } = await Users.findAll({ limit: 500 });

    const isTestUser = TEST_EMAILS.includes(u.email ?? '');

    return {
      users: records
        .filter(r => isTestUser || !r.hiddenFromChat)
        .map(r => ({
          id: r.id,
          email: r.email ?? '',
          firstName: r.firstName,
          lastName: r.lastName,
          role: r.role,
          departamento: r.departamento,
          lastActiveAt: r.lastActiveAt,
          purchaseLevel: r.purchaseLevel,
          costCenters: r.costCenters ?? [],
          accessComercial: r.accessComercial,
          accessOperacion: r.accessOperacion,
          accessAdmin: r.accessAdmin,
          accessFinanzas: r.accessFinanzas,
          accessOtros: r.accessOtros,
          maxApprovalAmount: r.maxApprovalAmount,
          visiblePages: r.visiblePages ?? [],
          dashboardWidgets: r.dashboardWidgets ?? [],
          hiddenFromChat: r.hiddenFromChat ?? false,
          cotizacionRubros: (r as any).cotizacionRubros ?? [],
        })),
    };
  },
});
