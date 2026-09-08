import { z } from 'zod';
import { createEndpoint, ZiteError, CollectionProcesses, pool } from '../../server/compat';

// Solo 6 de las 10 fases tienen su propio timestamp en Collection Processes
// (ver schema-map.ts) — 'Pagada' sella "paidAt" en vez de un campo "*At", y
// 'Por iniciar'/'Cobranza programada'/'Atrasada' no tienen timestamp propio.
const PHASE_TIMESTAMP_FIELD: Record<string, string> = {
  'Proforma creada': 'proformaCreatedAt',
  'Proforma enviada': 'proformaSentAt',
  'Factura creada': 'invoiceCreatedAt',
  'Factura enviada': 'invoiceSentAt',
  'Subida al portal': 'portalUploadedAt',
  'GR / Migo': 'grMigoAt',
};

function addDays(iso: string, days: number): string {
  const d = new Date(iso.split('T')[0] + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

async function logAudit(params: { collectionProcessId: string; action: string; userEmail: string; userName: string; comments?: string; projectCode?: string }) {
  await pool.query(
    `insert into collection_audit_log (collection_process_id, action, user_email, user_name, comments, project_code)
     values ($1, $2, $3, $4, $5, $6)`,
    [params.collectionProcessId, params.action, params.userEmail, params.userName, params.comments ?? null, params.projectCode ?? null],
  );
}

export default createEndpoint({
  authenticated: true,
  description: 'Actualiza un proceso de cobranza (fase, estatus, fecha programada, folio, notas, responsable) — restringido a Owner o Finanzas',
  inputSchema: z.object({
    id: z.string(),
    phase: z.string().optional(),
    status: z.string().optional(),
    scheduledPaymentDate: z.string().optional(),
    invoiceNumber: z.string().optional(),
    invoiceCreatedAt: z.string().optional(),
    creditDays: z.number().optional(),
    notes: z.string().optional(),
    responsibleUser: z.string().optional(),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    const role = context.user!.role;
    const level = context.user!.purchaseLevel ?? 'Creador';
    if (role !== 'Owner' && level !== 'Finanzas') {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'No tienes permisos para editar Cobranza' });
    }

    const current = await CollectionProcesses.findOne({ id: input.id });
    if (!current) throw new ZiteError({ code: 'NOT_FOUND', message: 'Proceso de cobranza no encontrado' });

    const userName = [context.user!.firstName, context.user!.lastName].filter(Boolean).join(' ') || context.user!.email;
    const record: Record<string, unknown> = {};

    if (input.scheduledPaymentDate !== undefined) record.scheduledPaymentDate = input.scheduledPaymentDate;
    if (input.invoiceNumber !== undefined) record.invoiceNumber = input.invoiceNumber;
    if (input.invoiceCreatedAt !== undefined) record.invoiceCreatedAt = input.invoiceCreatedAt;
    if (input.creditDays !== undefined) record.creditDays = input.creditDays;
    if (input.notes !== undefined) record.notes = input.notes;
    if (input.responsibleUser !== undefined) record.responsibleUser = [input.responsibleUser];

    // Los 20 procesos legacy (creados antes de que Cobranza pidiera folio/
    // fecha/días de crédito al arrancar) se completan a mano desde la
    // pestaña — en cuanto quedan invoiceCreatedAt + creditDays completos
    // (los que se acaban de mandar, o los que ya estaban guardados), la
    // fecha tentativa se recalcula sola, igual que hace startCollectionProcess.ts,
    // salvo que este mismo request ya traiga una fecha explícita (no se pisa
    // un ajuste manual intencional).
    if (input.scheduledPaymentDate === undefined) {
      const invoiceDate = input.invoiceCreatedAt ?? current.invoiceCreatedAt;
      const creditDays = input.creditDays ?? current.creditDays;
      if (invoiceDate && creditDays != null) {
        record.scheduledPaymentDate = addDays(invoiceDate, creditDays);
      }
    }

    const phaseChanged = input.phase !== undefined && input.phase !== current.phase;
    if (phaseChanged) {
      record.phase = input.phase;
      if (input.phase === 'Pagada' && !current.paidAt) {
        record.paidAt = new Date().toISOString().split('T')[0];
      } else {
        const field = PHASE_TIMESTAMP_FIELD[input.phase!];
        if (field && !(current as Record<string, unknown>)[field]) {
          record[field] = new Date().toISOString();
        }
      }
    }

    const statusChanged = input.status !== undefined && input.status !== current.status;
    if (statusChanged) record.status = input.status;

    if (Object.keys(record).length > 0) {
      await CollectionProcesses.update({ id: input.id, record: record as never });
    }

    if (phaseChanged) {
      await logAudit({
        collectionProcessId: input.id,
        action: 'Fase actualizada',
        userEmail: context.user!.email,
        userName,
        comments: `${current.phase ?? '(sin fase)'} → ${input.phase}`,
        projectCode: current.projectCode,
      });
    }
    if (statusChanged) {
      await logAudit({
        collectionProcessId: input.id,
        action: 'Estatus actualizado',
        userEmail: context.user!.email,
        userName,
        comments: `${current.status ?? '(sin estatus)'} → ${input.status}`,
        projectCode: current.projectCode,
      });
    }
    if (!phaseChanged && !statusChanged && Object.keys(record).length > 0) {
      await logAudit({
        collectionProcessId: input.id,
        action: 'Editado',
        userEmail: context.user!.email,
        userName,
        projectCode: current.projectCode,
      });
    }

    return { success: true };
  },
});
