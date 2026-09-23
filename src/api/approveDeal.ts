import { z } from 'zod';
import {
  createEndpoint, Deals, Cotizaciones, CotizacionLineItems, Projects, Boards, Tasks,
  ZiteError, pool,
} from '../../server/compat';
import { assertProjectCodeAvailable } from '../serverUtils/assertProjectCodeAvailable';

const DEFAULT_TASKS = [
  'Go Ahead', 'Reclutamiento', 'Envío de guía de tópicos',
  'Aprobación de guía de tópicos', 'Fieldwork', 'Análisis', 'Reporte',
];

export default createEndpoint({
  authenticated: true,
  description: 'Approve a deal: marks it Ganado, approves included cotizaciones and creates the project, with optional line item filtering. El proceso de cobranza ya NO se crea aquí — arranca manualmente al entregar (ver startCollectionProcess.ts). El vínculo Proyecto↔Deal para presupuesto ya NO se hace aquí — es una acción manual y exclusiva de Sergio (ver linkProjectDeal.ts); tampoco se manda ya ningún aviso automático por rubro (rediseño sep 2026, ver getProjectBudget.ts para la visibilidad granular que lo reemplaza)',
  inputSchema: z.object({
    dealId: z.string(),
    createProject: z.boolean().optional(),
    selectedLineItems: z.array(z.object({
      rubroName: z.string(),
      lineItemIds: z.array(z.string()),
    })).optional(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    projectCode: z.string().optional(),
    projectId: z.string().optional(),
    quotedCost: z.number(),
  }),
  execute: async ({ input, context }) => {
    // ── 1. Get the deal ────────────────────────────────────────────────────────
    const deal = await Deals.findOne({ id: input.dealId });
    if (!deal) throw new ZiteError({ code: 'NOT_FOUND', message: 'Deal no encontrado' });

    // ── 2. Find and approve included cotizaciones ──────────────────────────────
    const { records: allCots } = await Cotizaciones.findAll({
      filters: { deal: { contains: input.dealId } },
      limit: 200,
    });
    const included = allCots.filter(c => {
      const ids = Array.isArray(c.deal) ? c.deal : c.deal ? [c.deal] : [];
      return ids.includes(input.dealId) && (c as any).included === true;
    });
    await Promise.all(included.map(c => Cotizaciones.update({ id: c.id, record: { status: 'Aprobada' } })));
    const quotedCost = included.reduce((s, c) => s + ((c as any).clientPrice ?? (c as any).totalCost ?? 0), 0);
    const today = new Date().toISOString().split('T')[0];
    const shouldCreateProject = input.createProject !== false;

    let projectCode: string | undefined;
    let newProjectId: string | undefined;

    if (shouldCreateProject) {
      // ── 3. Create project ────────────────────────────────────────────────────
      projectCode = deal.dealName ?? 'Proyecto ' + Date.now().toString().slice(-4);
      await assertProjectCodeAvailable(pool, projectCode);
      const newProject = await Projects.create({
        record: {
          projectCode,
          fullName: deal.dealName,
          client: deal.client,
          tematica: (deal as any).tematica,
          status: 'En curso',
          budget: deal.clientPrice,
          startDate: today,
          // El vínculo a Deals.dealVinculado (visibilidad de presupuesto)
          // ya NO se hace aquí — es una acción manual y exclusiva de Sergio,
          // ver linkProjectDeal.ts. El proyecto nace sin vincular.
          createdBy: context.user!.email,
          createdAt: new Date().toISOString(),
        } as any,
      });
      newProjectId = newProject.id;

      // Auto-create default boards and tasks
      const [, timelineBoard] = await Promise.all([
        Boards.create({ record: { boardName: 'Calendario', projectCode, boardOrder: 0, boardType: 'calendar' } as any }),
        Boards.create({ record: { boardName: 'Timeline', projectCode, boardOrder: 0, boardType: 'pm' } as any }),
      ]);
      const timelineBoardId = timelineBoard.id;
      await Tasks.bulkCreate({
        records: DEFAULT_TASKS.map((taskName, order) => ({
          taskName, projectCode, boardName: 'Timeline', boardId: timelineBoardId, status: 'Pendiente', order,
        })) as any,
      });

      // ── 4a. Update deal (phase, approvalDate, quotedCost) ────────────────────
      // Deals no tiene columna de vuelta hacia Projects (ver
      // getProjectForDeal.ts, que resuelve el vínculo consultando
      // Projects.dealVinculado) — ese campo ya no se setea aquí, es una
      // acción manual y exclusiva de Sergio (ver linkProjectDeal.ts).
      await Deals.update({
        id: input.dealId,
        record: { phase: 'Ganado', approvalDate: today, quotedCost } as any,
      });

      // Cobranza v2 (sep 2026): ya NO se crea aquí. Sergio corrigió el diseño
      // original — el proceso de cobranza debe arrancar cuando se ENTREGA el
      // proyecto, no cuando se aprueba el deal (son momentos distintos), y
      // debe ser una acción manual ("Iniciar proceso de cobranza" en el Hub
      // del Proyecto, ver startCollectionProcess.ts), no automática. Los
      // procesos que este bloque ya había creado antes de la corrección se
      // dejan tal cual (no se borran, per decisión explícita).
    } else {
      // ── 4b. Update deal (phase, approvalDate, quotedCost only) ───────────────
      await Deals.update({
        id: input.dealId,
        record: { phase: 'Ganado', approvalDate: today, quotedCost } as any,
      });
    }

    // ── 6. Gather line items for included cotizaciones ─────────────────────────
    let allLineItems: any[] = [];
    if (included.length > 0) {
      const results = await Promise.all(
        included.map(c => CotizacionLineItems.findAll({
          filters: { cotizacion: { contains: c.id } },
          limit: 500,
        })),
      );
      allLineItems = results.flatMap((r, i) =>
        r.records.map(li => ({ ...li, _cotizacionName: included[i].cotizacionName ?? `Cotización ${i + 1}` }))
      );
    }

    // ── 7. Stamp includedInBudget on every line item ───────────────────────────
    if (allLineItems.length > 0) {
      const selectedIds = new Set<string>();
      if (input.selectedLineItems && input.selectedLineItems.length > 0) {
        for (const sel of input.selectedLineItems) {
          for (const id of sel.lineItemIds) selectedIds.add(id);
        }
      }
      // Legacy (no selection) → include all; otherwise only the selected ids
      const hasSelection = !!(input.selectedLineItems && input.selectedLineItems.length > 0);
      await Promise.all(
        allLineItems.map(li =>
          CotizacionLineItems.update({
            id: li.id,
            record: { includedInBudget: hasSelection ? selectedIds.has(li.id) : true },
          }),
        ),
      );
    }

    return {
      success: true,
      projectCode,
      projectId: newProjectId,
      quotedCost,
    };
  },
});
