import { z } from 'zod';
import { createEndpoint, ZiteError, CollectionProcesses, Deals, Users, pool } from '../../server/compat';

function firstLinkId(v: unknown): string | undefined {
  if (Array.isArray(v)) return v[0];
  return (v as string | undefined) ?? undefined;
}

// Ver comentario gemelo en getCollectionProcesses.ts.
function computeEffectiveStatus(status: string | undefined, scheduledPaymentDate: string | undefined): string {
  if (status === 'Pagado') return 'Pagado';
  if (scheduledPaymentDate) {
    const today = new Date().toISOString().split('T')[0];
    if (scheduledPaymentDate.split('T')[0] < today) return 'Atrasado';
  }
  return status ?? 'Al día';
}

const attachmentSchema = z.object({
  id: z.string(),
  docType: z.string(),
  name: z.string().optional(),
  fileUrl: z.string().optional(),
  description: z.string().optional(),
  uploadedByEmail: z.string().optional(),
  uploadedByName: z.string().optional(),
  uploadedAt: z.string().optional(),
});

const auditEntrySchema = z.object({
  id: z.string(),
  timestamp: z.string().optional(),
  action: z.string(),
  userEmail: z.string().optional(),
  userName: z.string().optional(),
  comments: z.string().optional(),
});

export default createEndpoint({
  authenticated: true,
  description: 'Detalle de un proceso de cobranza: el registro, sus adjuntos y su bitácora — restringido a Owner o Finanzas',
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({
    found: z.boolean(),
    id: z.string().optional(),
    projectCode: z.string().optional(),
    dealId: z.string().optional(),
    dealName: z.string().optional(),
    client: z.string().optional(),
    currency: z.string().optional(),
    quotedAmount: z.number().optional(),
    collectionAmount: z.number().optional(),
    phase: z.string().optional(),
    scheduledPaymentDate: z.string().optional(),
    paidAt: z.string().optional(),
    invoiceNumber: z.string().optional(),
    creditDays: z.number().optional(),
    status: z.string().optional(),
    effectiveStatus: z.string().optional(),
    notes: z.string().optional(),
    responsibleUserId: z.string().optional(),
    responsibleUserName: z.string().optional(),
    proformaCreatedAt: z.string().optional(),
    proformaSentAt: z.string().optional(),
    invoiceCreatedAt: z.string().optional(),
    invoiceSentAt: z.string().optional(),
    portalUploadedAt: z.string().optional(),
    grMigoAt: z.string().optional(),
    attachments: z.array(attachmentSchema),
    auditLog: z.array(auditEntrySchema),
  }),
  execute: async ({ input, context }) => {
    const role = context.user!.role;
    const level = context.user!.purchaseLevel ?? 'Creador';
    if (role !== 'Owner' && level !== 'Finanzas') {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'No tienes permisos para ver Cobranza' });
    }

    const record = await CollectionProcesses.findOne({ id: input.id });
    if (!record) return { found: false, attachments: [], auditLog: [] };

    const dealId = firstLinkId(record.deal);
    const responsibleUserId = firstLinkId(record.responsibleUser);

    const [deal, responsibleUser, attachmentsRes, auditLogRes] = await Promise.all([
      dealId ? Deals.findOne({ id: dealId, fields: ['dealName'] }) : Promise.resolve(null),
      responsibleUserId ? Users.findOne({ id: responsibleUserId, fields: ['firstName', 'lastName'] }) : Promise.resolve(null),
      pool.query(
        `select id, doc_type, name, file_url, description, uploaded_by_email, uploaded_by_name, uploaded_at
         from collection_attachments
         where collection_process_id = $1
         order by uploaded_at desc nulls last, created_at desc`,
        [input.id],
      ),
      pool.query(
        `select id, "timestamp", action, user_email, user_name, comments
         from collection_audit_log
         where collection_process_id = $1
         order by "timestamp" desc nulls last`,
        [input.id],
      ),
    ]);

    return {
      found: true,
      id: record.id,
      projectCode: record.projectCode,
      dealId,
      dealName: deal?.dealName ?? undefined,
      client: record.client,
      currency: record.currency,
      quotedAmount: record.quotedAmount,
      collectionAmount: record.collectionAmount,
      phase: record.phase,
      scheduledPaymentDate: record.scheduledPaymentDate,
      paidAt: record.paidAt,
      invoiceNumber: record.invoiceNumber,
      creditDays: record.creditDays,
      status: record.status,
      effectiveStatus: computeEffectiveStatus(record.status, record.scheduledPaymentDate),
      notes: record.notes,
      responsibleUserId,
      responsibleUserName: responsibleUser ? [responsibleUser.firstName, responsibleUser.lastName].filter(Boolean).join(' ') : undefined,
      proformaCreatedAt: record.proformaCreatedAt,
      proformaSentAt: record.proformaSentAt,
      invoiceCreatedAt: record.invoiceCreatedAt,
      invoiceSentAt: record.invoiceSentAt,
      portalUploadedAt: record.portalUploadedAt,
      grMigoAt: record.grMigoAt,
      attachments: attachmentsRes.rows.map(row => ({
        id: row.id as string,
        docType: row.doc_type as string,
        name: (row.name ?? undefined) as string | undefined,
        fileUrl: (row.file_url ?? undefined) as string | undefined,
        description: (row.description ?? undefined) as string | undefined,
        uploadedByEmail: (row.uploaded_by_email ?? undefined) as string | undefined,
        uploadedByName: (row.uploaded_by_name ?? undefined) as string | undefined,
        uploadedAt: (row.uploaded_at ?? undefined) as string | undefined,
      })),
      auditLog: auditLogRes.rows.map(row => ({
        id: row.id as string,
        timestamp: (row.timestamp ?? undefined) as string | undefined,
        action: row.action as string,
        userEmail: (row.user_email ?? undefined) as string | undefined,
        userName: (row.user_name ?? undefined) as string | undefined,
        comments: (row.comments ?? undefined) as string | undefined,
      })),
    };
  },
});
