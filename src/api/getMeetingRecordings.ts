import { z } from 'zod';
import { createEndpoint, MeetingRecordings } from '../../server/compat';

const acuerdoSchema = z.object({
  texto: z.string(),
  responsable: z.string().nullable().optional(),
  hecho: z.boolean(),
});

const recordingSchema = z.object({
  id: z.string(),
  subject: z.string().optional(),
  ownerEmail: z.string().optional(),
  meetingStart: z.string().optional(),
  meetingEnd: z.string().optional(),
  status: z.string().optional(),
  meetingType: z.string().optional(),
  muxPlaybackId: z.string().optional(),
  assemblyTranscriptId: z.string().optional(),
  transcript: z.string().optional(),
  transcriptData: z.object({ utterances: z.array(z.object({ speaker: z.string(), text: z.string(), start: z.number(), end: z.number() })) }).optional(),
  summaryJson: z.object({ resumen: z.string(), acuerdos: z.array(acuerdoSchema) }).optional(),
  project: z.array(z.string()).optional(),
  deal: z.array(z.string()).optional(),
  createdAt: z.string().optional(),
});

// Minutas / notetaker (sep 2026): lista minutas de un Proyecto o de un Deal
// (nunca ambos a la vez — ver ProjectHubPage/DealDetailSheet), o todas si no
// se manda ninguno (para una futura vista global, no usada todavía).
export default createEndpoint({
  authenticated: true,
  description: 'Lista minutas (grabaciones de junta), opcionalmente filtradas por proyecto o deal',
  inputSchema: z.object({ projectId: z.string().optional(), dealId: z.string().optional() }),
  outputSchema: z.object({ recordings: z.array(recordingSchema) }),
  execute: async ({ input }) => {
    const filters: Record<string, unknown> = {};
    if (input.projectId) filters.project = input.projectId;
    if (input.dealId) filters.deal = input.dealId;

    const { records } = await MeetingRecordings.findAll({
      filters,
      sorts: [{ field: 'createdAt', direction: 'desc' }],
      fields: [
        'subject', 'ownerEmail', 'meetingStart', 'meetingEnd', 'status', 'meetingType',
        'muxPlaybackId', 'assemblyTranscriptId', 'transcript', 'transcriptData', 'summaryJson', 'project', 'deal', 'createdAt',
      ],
    });

    return { recordings: records };
  },
});
