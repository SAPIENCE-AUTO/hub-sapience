import { z } from 'zod';
import { createEndpoint, MeetingRecordings } from '../../server/compat';
import { muxFetch } from '../../server/mux/client';

// Minutas / notetaker (sep 2026): borrado directo, sin las 3 etapas de
// trash que usan las tablas de negocio (Tasks, RecruitmentRows, etc.) — una
// minuta es metadata operativa de una grabación, no un registro contable, y
// el caso de uso real es "cancelar una subida que se quedó trabada" (sin
// webhook público en local, o si Mux/AssemblyAI fallan en producción).
export default createEndpoint({
  authenticated: true,
  description: 'Borra una minuta (y su asset de Mux si ya existe)',
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async ({ input }) => {
    const recording = await MeetingRecordings.findOne({ id: input.id });
    if (recording?.muxAssetId) {
      // Best-effort — si Mux falla (ya borrado, id inválido, etc.) no debe
      // impedir borrar la fila, que es lo que el usuario está pidiendo.
      try {
        await muxFetch(`/video/v1/assets/${encodeURIComponent(recording.muxAssetId)}`, { method: 'DELETE' });
      } catch (err) {
        console.error('[deleteMeetingRecording] error borrando asset de Mux', (err as Error).message);
      }
    }
    await MeetingRecordings.delete({ id: input.id });
    return { ok: true };
  },
});
