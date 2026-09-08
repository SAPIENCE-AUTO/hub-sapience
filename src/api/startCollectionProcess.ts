import { z } from 'zod';
import { createEndpoint, ZiteError, Projects, Deals, CollectionProcesses, pool } from '../../server/compat';

function firstLinkId(v: unknown): string | undefined {
  if (Array.isArray(v)) return v[0];
  return (v as string | undefined) ?? undefined;
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

export default createEndpoint({
  authenticated: true,
  description: 'Arranca manualmente el proceso de cobranza de un proyecto (al entregarlo, no al aprobar el deal) — restringido a Owner o Finanzas',
  inputSchema: z.object({
    projectCode: z.string(),
    invoiceNumber: z.string(),
    invoiceDate: z.string(),
    creditDays: z.number(),
    fileUrl: z.string().optional(),
    fileName: z.string().optional(),
  }),
  outputSchema: z.object({ success: z.boolean(), collectionProcessId: z.string() }),
  execute: async ({ input, context }) => {
    const role = context.user!.role as string | undefined;
    const level = (context.user!.purchaseLevel as string | undefined) ?? 'Creador';
    if (role !== 'Owner' && level !== 'Finanzas') {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'No tienes permisos para iniciar procesos de Cobranza' });
    }

    const { records: projectRecords } = await Projects.findAll({
      filters: { projectCode: input.projectCode } as never,
      limit: 1,
    });
    const project = projectRecords[0];
    if (!project) throw new ZiteError({ code: 'NOT_FOUND', message: 'Proyecto no encontrado' });

    const { records: existing } = await CollectionProcesses.findAll({
      filters: { projectCode: input.projectCode } as never,
      limit: 1,
    });
    if (existing.length > 0) {
      throw new ZiteError({ code: 'BAD_REQUEST', message: 'Este proyecto ya tiene un proceso de cobranza' });
    }

    // Mismo criterio que usaba approveDeal.ts: currency/monto salen del deal
    // vinculado (Projects no guarda moneda) — si el proyecto no tiene deal
    // vinculado (casos viejos), se usa el presupuesto del proyecto en MXN.
    const dealId = firstLinkId((project as { dealVinculado?: unknown }).dealVinculado);
    const deal = dealId ? await Deals.findOne({ id: dealId, fields: ['currency', 'clientPrice'] }) : null;
    const rawCurrency = ((deal?.currency ?? 'MXN') as string).replace(/ 🇲🇽| 🇺🇸| 🇪🇺/g, '').trim();
    const amount = deal?.clientPrice ?? project.budget ?? 0;

    const scheduledPaymentDate = addDays(input.invoiceDate, input.creditDays);

    const record = await CollectionProcesses.create({
      record: {
        projectCode: input.projectCode,
        deal: dealId ? [dealId] : undefined,
        client: project.client,
        currency: rawCurrency as never,
        quotedAmount: amount,
        collectionAmount: amount,
        // El flujo real que describe el negocio no usa proforma — arranca
        // directo en factura, ya con folio y fecha capturados.
        phase: 'Factura creada',
        status: 'Al día',
        invoiceNumber: input.invoiceNumber,
        invoiceCreatedAt: input.invoiceDate,
        creditDays: input.creditDays,
        scheduledPaymentDate,
      } as never,
    });

    const userName = [context.user!.firstName, context.user!.lastName].filter(Boolean).join(' ') || context.user!.email;

    if (input.fileUrl && input.fileName) {
      await pool.query(
        `insert into collection_attachments
           (collection_process_id, doc_type, name, file_url, uploaded_by_email, uploaded_by_name, uploaded_at)
         values ($1, 'Factura', $2, $3, $4, $5, now())`,
        [record.id, input.fileName, input.fileUrl, context.user!.email, userName],
      );
    }

    await pool.query(
      `insert into collection_audit_log (collection_process_id, action, user_email, user_name, comments, project_code)
       values ($1, 'Creado', $2, $3, $4, $5)`,
      [record.id, context.user!.email, userName, `Proceso iniciado — factura ${input.invoiceNumber}`, input.projectCode],
    );

    // Precarga para la próxima vez — mismo cliente, mismos días de crédito
    // por default, hasta que alguien los cambie manualmente.
    if (project.client) {
      await pool.query(
        `insert into clients (name, credit_days) values ($1, $2)
         on conflict (lower(name)) do update set credit_days = excluded.credit_days, updated_at = now()`,
        [project.client, input.creditDays],
      );
    }

    return { success: true, collectionProcessId: record.id };
  },
});
