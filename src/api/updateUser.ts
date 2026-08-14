import { z } from 'zod';
import { createEndpoint, ZiteError, Users } from '../../server/compat';

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

    // Los <Select> del front inicializan estos campos en '' cuando el usuario
    // no tiene valor guardado (p.ej. departamento nunca asignado) — sus CHECK
    // constraints en Postgres solo permiten null o un valor de la lista, no
    // '' (ver users_departamento_chk y similares en schema.sql). '' truena
    // el guardado con un error de constraint que el front solo ve como
    // "Error al guardar" genérico. Tratarlo como "sin cambio" es lo correcto:
    // no hay una opción real de "vaciar" estos selects en la UI.
    const orUndef = (v?: string) => (v === '' ? undefined : v);

    await Users.update({
      id: input.id,
      record: {
        firstName: input.firstName,
        lastName: input.lastName,
        role: orUndef(input.role),
        departamento: orUndef(input.departamento),
        accessComercial: orUndef(input.accessComercial),
        accessOperacion: orUndef(input.accessOperacion),
        accessAdmin: orUndef(input.accessAdmin),
        accessFinanzas: orUndef(input.accessFinanzas),
        accessOtros: orUndef(input.accessOtros),
        purchaseLevel: orUndef(input.purchaseLevel),
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
