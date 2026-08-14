import { z } from 'zod';
import {
  createEndpoint, Deals, Cotizaciones, CotizacionLineItems, Projects, Boards, Tasks,
  ChatConversations, Messages, Users, ZiteError, CollectionProcesses,
} from '../../server/compat';
import { parseMembers } from '../lib/chatJson';
import { publishEvent, safeUserChannel } from '../lib/ably';

const DEFAULT_TASKS = [
  'Go Ahead', 'Reclutamiento', 'Envío de guía de tópicos',
  'Aprobación de guía de tópicos', 'Fieldwork', 'Análisis', 'Reporte',
];

export default createEndpoint({
  authenticated: true,
  description: 'Approve a deal: marks it Ganado, approves included cotizaciones, creates project + collection process, sends per-rubro DM notifications with optional line item filtering',
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
    collectionProcessId: z.string().optional(),
    notificationsSent: z.number(),
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
    let collectionProcessId: string | undefined;

    if (shouldCreateProject) {
      // ── 3. Create project ────────────────────────────────────────────────────
      projectCode = deal.dealName ?? 'Proyecto ' + Date.now().toString().slice(-4);
      const newProject = await Projects.create({
        record: {
          projectCode,
          fullName: deal.dealName,
          client: deal.client,
          tematica: (deal as any).tematica,
          status: 'En curso',
          budget: deal.clientPrice,
          startDate: today,
          dealVinculado: [input.dealId],
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
      // El link real Proyecto↔Deal ya quedó puesto arriba vía
      // Projects.dealVinculado — Deals no tiene columna de vuelta hacia
      // Projects (ver getProjectForDeal.ts), así que no hay nada que
      // guardar aquí de ese lado.
      await Deals.update({
        id: input.dealId,
        record: { phase: 'Ganado', approvalDate: today, quotedCost } as any,
      });

      // ── 5. Create collection process record ──────────────────────────────────
      const rawCurrency = (deal.currency ?? 'MXN').replace(/ 🇲🇽| 🇺🇸| 🇪🇺/g, '').trim();
      const collectionProcess = await CollectionProcesses.create({
        record: {
          projectCode,
          deal: [input.dealId],
          client: deal.client,
          currency: rawCurrency as any,
          quotedAmount: deal.clientPrice ?? 0,
          collectionAmount: deal.clientPrice ?? 0,
          phase: 'Por iniciar',
          status: 'Al día',
        },
      });
      collectionProcessId = collectionProcess.id;
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

    // ── 7. Load all users with cotizacionRubros assigned ──────────────────────
    const { records: allUsers } = await Users.findAll({
      limit: 300,
      fields: ['id', 'email', 'firstName', 'lastName', 'cotizacionRubros'],
    });

    // Build map: rubro → list of users assigned to it
    const rubroToUsers = new Map<string, typeof allUsers>();
    for (const user of allUsers) {
      const rubros = (user as any).cotizacionRubros as string[] | undefined;
      if (!rubros || rubros.length === 0) continue;
      for (const rubro of rubros) {
        if (!rubroToUsers.has(rubro)) rubroToUsers.set(rubro, []);
        rubroToUsers.get(rubro)!.push(user);
      }
    }

    const senderEmail = 'sistema@sapience.com.mx';
    const senderName = 'Sapience Ops';
    const now = new Date().toISOString();
    let notificationsSent = 0;
    const sym = deal.currency?.includes('USD') ? 'USD ' : deal.currency?.includes('EUR') ? 'EUR ' : '$';

    // ── 7b. Stamp includedInBudget on every line item ─────────────────────────
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

    // ── 8. Send DMs per rubro per assigned user (only when project was created) ─
    if (!shouldCreateProject) {
      return {
        success: true,
        projectCode,
        projectId: newProjectId,
        collectionProcessId,
        notificationsSent: 0,
        quotedCost,
      };
    }

    for (const [rubroName, recipients] of rubroToUsers.entries()) {
      // Filter line items: use selection if provided, otherwise use all
      let rubroItems: any[];
      if (input.selectedLineItems && input.selectedLineItems.length > 0) {
        const selection = input.selectedLineItems.find(s => s.rubroName === rubroName);
        if (!selection || selection.lineItemIds.length === 0) continue;
        rubroItems = allLineItems.filter((li: any) =>
          li.rubro === rubroName && selection.lineItemIds.includes(li.id),
        );
      } else {
        rubroItems = allLineItems.filter((li: any) => li.rubro === rubroName);
      }
      if (rubroItems.length === 0) continue;

      const fmtNum = (n: number) => sym + Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

      // Group rubroItems by cotizacion name for DM message
      const cotGroups = new Map<string, any[]>();
      for (const li of rubroItems) {
        const key = li._cotizacionName ?? '—';
        if (!cotGroups.has(key)) cotGroups.set(key, []);
        cotGroups.get(key)!.push(li);
      }
      const showCotHeaders = cotGroups.size > 1;
      const itemLines = [...cotGroups.entries()].map(([cotName, items]) => {
        const lines = items.map((li: any) => {
          const cant = li.cantidad ?? 1;
          const unit = li.unitCost ?? 0;
          const comp = li.componentes ?? 1;
          const total = cant * comp * unit;
          return `  - ${li.subRubro ?? 'Concepto'} — ${cant} ud × ${comp} comp × ${fmtNum(unit)} = ${fmtNum(total)}`;
        }).join('\n');
        return showCotHeaders ? `**${cotName}**\n${lines}` : lines;
      }).join('\n\n');
      const rubroTotal = rubroItems.reduce((s: number, li: any) =>
        s + (li.cantidad ?? 1) * (li.unitCost ?? 0) * (li.componentes ?? 1), 0);

      const encodedProjectCode = encodeURIComponent(projectCode!);
      const projectUrl = `${process.env.ZITE_APP_URL}/operacion/proyectos/${encodedProjectCode}?tab=presupuesto`;

      const content = [
        `**${projectCode}**`,
        deal.client ? `Cliente: ${deal.client}` : '',
        '',
        `Presupuesto **${rubroName.toUpperCase()}**`,
        '',
        itemLines,
        '',
        `Total del rubro: **${fmtNum(rubroTotal)}**`,
        '',
        `Ver proyecto → ${projectUrl}`,
      ].filter(line => line !== null && line !== undefined).join('\n');

      for (const recipient of recipients) {
        const recipientEmail = recipient.email as string;
        if (!recipientEmail || recipientEmail === senderEmail) continue;

        // Find or create DM conversation
        const { records: existingDMs } = await ChatConversations.findAll({
          filters: { type: 'DM' },
          limit: 500,
        });
        let convId: string;
        const existingDM = existingDMs.find(r => {
          const m = parseMembers(r.members);
          return m.includes(senderEmail) && m.includes(recipientEmail);
        });
        if (existingDM) {
          convId = existingDM.id;
        } else {
          const conv = await ChatConversations.create({
            record: {
              conversationName: '',
              type: 'DM',
              members: JSON.stringify([senderEmail, recipientEmail]),
            } as any,
          });
          convId = conv.id;
        }

        const msgRecord = await Messages.create({
          record: { channel: convId, content, senderName, senderEmail, sentAt: now } as any,
        });

        // Publish real-time events (non-fatal)
        try {
          await publishEvent(`chat:${convId}`, 'message.created', {
            id: msgRecord.id, channel: convId, content, senderName, senderEmail,
            sentAt: now, pinned: false,
          });
          await publishEvent(safeUserChannel(recipientEmail), 'notification.new_message', {
            channel: convId, messageId: msgRecord.id, senderName, senderEmail,
            hasMention: true, sentAt: now,
          });
        } catch {
          // Non-fatal
        }

        notificationsSent++;
      }
    }

    return {
      success: true,
      projectCode,
      projectId: newProjectId,
      collectionProcessId,
      notificationsSent,
      quotedCost,
    };
  },
});
