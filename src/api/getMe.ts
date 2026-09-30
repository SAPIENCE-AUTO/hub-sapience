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
    homePage: z.string().optional(),
    // Sin esto, zod descarta el campo en silencio (no truena, solo lo quita
    // del output) porque un z.object() por default tira cualquier llave no
    // declarada — canSeeBudget en ProjectHubPage.tsx siempre veía
    // user.cotizacionRubros como undefined para cualquiera que no fuera
    // Owner/Socio/Finanzas, aunque el campo sí existiera en la base (bug
    // real: Itzel ya tenía "Reclutamiento e incentivos" marcado y aun así no
    // le aparecía la pestaña Presupuesto).
    cotizacionRubros: z.array(z.string()).optional(),
  }),
  execute: async ({ context }) => ({ ...context.user! }) as any,
});
