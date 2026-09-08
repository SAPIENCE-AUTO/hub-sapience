import { z } from 'zod';
import { createEndpoint, ZiteError, CollectionProcesses, Deals, Projects, Users } from '../../server/compat';

const processSchema = z.object({
  id: z.string(),
  projectCode: z.string().optional(),
  dealId: z.string().optional(),
  dealName: z.string().optional(),
  projectId: z.string().optional(),
  client: z.string().optional(),
  currency: z.string().optional(),
  quotedAmount: z.number().optional(),
  collectionAmount: z.number().optional(),
  phase: z.string().optional(),
  scheduledPaymentDate: z.string().optional(),
  paidAt: z.string().optional(),
  invoiceNumber: z.string().optional(),
  status: z.string().optional(),
  effectiveStatus: z.string().optional(),
  responsibleUserId: z.string().optional(),
  responsibleUserName: z.string().optional(),
  createdAt: z.string().optional(),
});

// Un solo link (kind: 'link') se guarda/regresa como arreglo de un elemento
// — mismo patrón defensivo que ya usa approveDeal.ts para Cotizaciones.deal.
function firstLinkId(v: unknown): string | undefined {
  if (Array.isArray(v)) return v[0];
  return (v as string | undefined) ?? undefined;
}

// "status" es 100% manual y por default siempre "Al día" — confirmado en
// vivo que los 20 procesos reales seguían diciendo "Al día" aunque llevan
// meses sin moverse. effectiveStatus lo corrige SOLO cuando hay dato real
// para hacerlo (scheduledPaymentDate ya calculada y vencida) — si no hay
// fecha todavía (procesos legacy sin completar), no se inventa un atraso.
function computeEffectiveStatus(status: string | undefined, scheduledPaymentDate: string | undefined): string {
  if (status === 'Pagado') return 'Pagado';
  if (scheduledPaymentDate) {
    const today = new Date().toISOString().split('T')[0];
    if (scheduledPaymentDate.split('T')[0] < today) return 'Atrasado';
  }
  return status ?? 'Al día';
}

export default createEndpoint({
  authenticated: true,
  description: 'Lista los procesos de cobranza, con nombre de deal/proyecto para mostrar — restringido a Owner o Finanzas',
  inputSchema: z.object({
    projectCode: z.string().optional(),
    phase: z.string().optional(),
    status: z.string().optional(),
  }),
  outputSchema: z.object({
    processes: z.array(processSchema),
    userRole: z.string().optional(),
    userLevel: z.string().optional(),
  }),
  execute: async ({ input, context }) => {
    const role = context.user!.role as string | undefined;
    const level = (context.user!.purchaseLevel as string | undefined) ?? 'Creador';
    if (role !== 'Owner' && level !== 'Finanzas') {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'No tienes permisos para ver Cobranza' });
    }

    const filters: Record<string, unknown> = {};
    if (input.projectCode) filters.projectCode = input.projectCode;
    if (input.phase) filters.phase = input.phase;
    if (input.status) filters.status = input.status;

    const { records } = await CollectionProcesses.findAll({ filters: filters as never, limit: 2000 });

    const dealIds = [...new Set(records.map(r => firstLinkId(r.deal)).filter((v): v is string => !!v))];
    const projectCodes = [...new Set(records.map(r => r.projectCode).filter((v): v is string => !!v))];
    const responsibleIds = [...new Set(records.map(r => firstLinkId(r.responsibleUser)).filter((v): v is string => !!v))];

    const [dealsRes, projectsRes, usersRes] = await Promise.all([
      dealIds.length > 0
        ? Deals.findAll({ filters: { id: { in: dealIds } } as never, fields: ['dealName'], limit: dealIds.length })
        : Promise.resolve({ records: [] as { id: string; dealName?: string }[], hasMore: false }),
      projectCodes.length > 0
        ? Projects.findAll({ filters: { projectCode: { in: projectCodes } } as never, fields: ['projectCode'], limit: projectCodes.length })
        : Promise.resolve({ records: [] as { id: string; projectCode?: string }[], hasMore: false }),
      responsibleIds.length > 0
        ? Users.findAll({ filters: { id: { in: responsibleIds } } as never, fields: ['firstName', 'lastName'], limit: responsibleIds.length })
        : Promise.resolve({ records: [] as { id: string; firstName?: string; lastName?: string }[], hasMore: false }),
    ]);

    const dealNameById = new Map<string, string>(dealsRes.records.map(d => [d.id as string, (d.dealName as string) ?? ''] as [string, string]));
    const projectIdByCode = new Map<string, string>(projectsRes.records.map(p => [(p.projectCode as string) ?? '', p.id as string] as [string, string]));
    const userNameById = new Map<string, string>(usersRes.records.map(u => [u.id as string, [u.firstName, u.lastName].filter(Boolean).join(' ')] as [string, string]));

    return {
      processes: records.map(r => {
        const dealId = firstLinkId(r.deal);
        const responsibleUserId = firstLinkId(r.responsibleUser);
        return {
          id: r.id,
          projectCode: r.projectCode,
          dealId,
          dealName: dealId ? dealNameById.get(dealId) : undefined,
          projectId: r.projectCode ? projectIdByCode.get(r.projectCode) : undefined,
          client: r.client,
          currency: r.currency,
          quotedAmount: r.quotedAmount,
          collectionAmount: r.collectionAmount,
          phase: r.phase,
          scheduledPaymentDate: r.scheduledPaymentDate,
          paidAt: r.paidAt,
          invoiceNumber: r.invoiceNumber,
          status: r.status,
          effectiveStatus: computeEffectiveStatus(r.status, r.scheduledPaymentDate),
          responsibleUserId,
          responsibleUserName: responsibleUserId ? userNameById.get(responsibleUserId) : undefined,
          createdAt: r.createdAt,
        };
      }),
      userRole: role,
      userLevel: level,
    };
  },
});
