import { z } from 'zod';
import { createEndpoint, ZiteError, CollectionProcesses, pool } from '../../server/compat';

const DOC_TYPES = ['Orden de compra cliente', 'Factura', 'Comprobante de plataforma', 'Otro'] as const;

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

export default createEndpoint({
  authenticated: true,
  description: 'Sube un documento (OC del cliente, factura, comprobante de plataforma, otro) a un proceso de cobranza — restringido a Owner o Finanzas',
  inputSchema: z.object({
    collectionProcessId: z.string(),
    docType: z.enum(DOC_TYPES),
    fileUrl: z.string(),
    fileName: z.string(),
    description: z.string().optional(),
  }),
  outputSchema: z.object({ success: z.boolean(), attachment: attachmentSchema }),
  execute: async ({ input, context }) => {
    const role = context.user!.role;
    const level = context.user!.purchaseLevel ?? 'Creador';
    if (role !== 'Owner' && level !== 'Finanzas') {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'No tienes permisos para subir documentos de Cobranza' });
    }

    const process = await CollectionProcesses.findOne({ id: input.collectionProcessId, fields: ['projectCode'] });
    if (!process) throw new ZiteError({ code: 'NOT_FOUND', message: 'Proceso de cobranza no encontrado' });

    const userName = [context.user!.firstName, context.user!.lastName].filter(Boolean).join(' ') || context.user!.email;
    const now = new Date().toISOString();

    const result = await pool.query(
      `insert into collection_attachments
         (collection_process_id, doc_type, name, file_url, description, uploaded_by_email, uploaded_by_name, uploaded_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning id`,
      [input.collectionProcessId, input.docType, input.fileName, input.fileUrl, input.description ?? null, context.user!.email, userName, now],
    );
    const id = result.rows[0].id as string;

    await pool.query(
      `insert into collection_audit_log (collection_process_id, action, user_email, user_name, comments, project_code)
       values ($1, 'Adjunto agregado', $2, $3, $4, $5)`,
      [input.collectionProcessId, context.user!.email, userName, `${input.docType}: ${input.fileName}`, process.projectCode ?? null],
    );

    return {
      success: true,
      attachment: {
        id,
        docType: input.docType,
        name: input.fileName,
        fileUrl: input.fileUrl,
        description: input.description,
        uploadedByEmail: context.user!.email,
        uploadedByName: userName,
        uploadedAt: now,
      },
    };
  },
});
