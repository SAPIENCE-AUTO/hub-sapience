import { z } from 'zod';
import { createEndpoint, ZiteError, Projects, Deals, CollectionProcesses, pool } from '../../server/compat';
import { fasesQueAplican } from '../lib/clientes/fases';
import { resolverCliente } from '../serverUtils/clientes/resolver';

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
    /** Razón social del catálogo de clientes a la que se le factura; de ahí salen los pasos e instrucciones de cobro. */
    clientEntityId: z.string().optional(),
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

    // Catálogo de clientes (nov 2026): el cliente sale del client_id del proyecto (o de su nombre) y la razón social, si se elige, tiene que ser de ese cliente.
    const cliente = await resolverCliente({ projectCode: input.projectCode });
    let entidad: { id: string; client_id: string | null; legal_name: string | null; requires_proforma: boolean | null; requires_portal: boolean | null; requires_gr: boolean | null } | undefined;
    if (input.clientEntityId) {
      const { rows } = await pool.query(
        `select id, client_id, legal_name, requires_proforma, requires_portal, requires_gr from client_entities where id = $1 and deactivated_at is null`,
        [input.clientEntityId],
      );
      entidad = rows[0];
      if (!entidad) throw new ZiteError({ code: 'BAD_REQUEST', message: 'Esa razón social ya no está disponible' });
      if (cliente && entidad.client_id !== cliente.id) throw new ZiteError({ code: 'BAD_REQUEST', message: 'Esa razón social no es de este cliente' });
    }
    const clientId = cliente?.id ?? entidad?.client_id ?? undefined;

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
        clientId: clientId ? [clientId] : undefined,
        clientEntityId: entidad ? [entidad.id] : undefined,
        // Los pasos que aplican a ese cliente (portal, GR/Migo, proforma); sin razón social queda vacío y el proceso muestra todos, como antes.
        applicablePhases: entidad
          ? JSON.stringify(fasesQueAplican({ requiresProforma: entidad.requires_proforma, requiresPortal: entidad.requires_portal, requiresGr: entidad.requires_gr }))
          : undefined,
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
      [record.id, context.user!.email, userName, `Proceso iniciado — factura ${input.invoiceNumber}${entidad?.legal_name ? ` — ${entidad.legal_name}` : ''}`, input.projectCode],
    );

    return { success: true, collectionProcessId: record.id };
  },
});
