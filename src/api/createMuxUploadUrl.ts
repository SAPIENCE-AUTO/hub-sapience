import { z } from 'zod';
import { createEndpoint, MeetingRecordings } from '../../server/compat';
import { createDirectUpload } from '../../server/mux/client';

// Minutas / notetaker (sep 2026): alta manual para juntas grabadas por otra
// vía (no por el notetaker de Recall) — el navegador sube el archivo DIRECTO
// a Mux con la URL que regresa este endpoint (ver createDirectUpload en
// server/mux/client.ts), nunca a Supabase Storage ni a nuestro servidor.
// La fila se crea aquí mismo (status "uploading") para que la minuta exista
// desde ya en la lista; server/webhooks/mux.ts la va completando conforme
// Mux procesa el archivo y genera el rendition de audio para transcribir.
export default createEndpoint({
  authenticated: true,
  description: 'Crea una URL de subida directa a Mux para dar de alta una minuta a partir de un audio/video grabado por otra vía',
  inputSchema: z.object({
    subject: z.string(),
    projectId: z.string().optional(),
    dealId: z.string().optional(),
  }),
  outputSchema: z.object({ uploadUrl: z.string(), recordingId: z.string() }),
  execute: async ({ input, context }) => {
    const corsOrigin = (process.env.ZITE_APP_URL ?? 'http://localhost:5173').split(',')[0].trim();
    const upload = await createDirectUpload(corsOrigin);

    const recording = await MeetingRecordings.create({
      record: {
        subject: input.subject,
        ownerEmail: context.user!.email,
        status: 'uploading',
        muxUploadId: upload.id,
        project: input.projectId,
        deal: input.dealId,
      },
    });

    return { uploadUrl: upload.url, recordingId: recording.id };
  },
});
