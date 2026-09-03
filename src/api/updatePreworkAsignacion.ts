import { z } from 'zod';
import { createEndpoint, ZiteError, pool } from '../../server/compat';

export default createEndpoint({
  authenticated: true,
  description: 'Incluye/excluye a un participante de un estudio de Prework, o cambia su status de participación',
  inputSchema: z.object({
    estudioId: z.string(),
    participanteId: z.string(),
    incluido: z.boolean().optional(),
    estadoParticipacion: z.enum(['activo', 'pausado', 'completado', 'abandono']).optional(),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input }) => {
    const { participanteId } = input;
    if (input.incluido === undefined && !input.estadoParticipacion) {
      throw new ZiteError({ code: 'BAD_REQUEST', message: 'Nada que actualizar' });
    }

    const sets: string[] = [];
    const values: unknown[] = [];
    if (input.incluido !== undefined) { values.push(input.incluido); sets.push(`incluido = $${values.length}`); }
    if (input.estadoParticipacion) { values.push(input.estadoParticipacion); sets.push(`estado_participacion = $${values.length}`); }
    values.push(participanteId, input.estudioId);

    const result = await pool.query(
      `update prework_asignaciones set ${sets.join(', ')}
       where prework_participante_id = $${values.length - 1} and prework_estudio_id = $${values.length}`,
      values,
    );
    if (result.rowCount === 0) throw new ZiteError({ code: 'NOT_FOUND', message: 'Asignación no encontrada' });

    return { success: true };
  },
});
