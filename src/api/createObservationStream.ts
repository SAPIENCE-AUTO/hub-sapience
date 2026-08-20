import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { provisionObservationSession } from '../serverUtils/provisionObservationSession';

const outputSchema = z.object({
  id: z.string(),
  slug: z.string(),
  muxStreamKey: z.string(),
  muxServerUrl: z.string(),
  muxPlaybackId: z.string(),
  estado: z.string(),
  zoomJoinUrl: z.string().optional(),
  zoomStartUrl: z.string().optional(),
  zoomSkippedReason: z.string().optional(),
});

export default createEndpoint({
  authenticated: true,
  description: 'Crea (o recupera) el live stream de Mux y el meeting de Zoom para la Sala de observación de una sesión de calendario',
  inputSchema: z.object({ calendarEventId: z.string() }),
  outputSchema,
  execute: async ({ input }) => provisionObservationSession(input.calendarEventId),
});
