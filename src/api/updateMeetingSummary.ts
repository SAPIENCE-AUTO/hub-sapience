import { z } from 'zod';
import { createEndpoint, MeetingRecordings } from '../../server/compat';

const AcuerdoSchema = z.object({
  texto: z.string(),
  responsable: z.string().nullable().optional(),
  hecho: z.boolean(),
});

// Minutas / notetaker (sep 2026): reemplazo completo del summaryJson — se usa
// para marcar/desmarcar un acuerdo como hecho desde la UI (los checkboxes de
// action items). El volumen es mínimo (unos cuantos acuerdos por junta), así
// que no vale la pena un endpoint de "toggle un solo acuerdo por índice".
export default createEndpoint({
  authenticated: true,
  description: 'Actualiza el resumen/acuerdos de una minuta (p.ej. marcar un acuerdo como hecho)',
  inputSchema: z.object({
    meetingRecordingId: z.string(),
    summaryJson: z.object({ resumen: z.string(), acuerdos: z.array(AcuerdoSchema) }),
  }),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async ({ input }) => {
    await MeetingRecordings.update({
      id: input.meetingRecordingId,
      record: { summaryJson: input.summaryJson },
    });
    return { ok: true };
  },
});
