import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';
import { fechaHoyMexico } from '../../server/preworkDate';

const filaSchema = z.object({
  participanteId: z.string(),
  nombre: z.string(),
  email: z.string(),
  incluido: z.boolean(),
  estadoParticipacion: z.string(),
  fechaInicio: z.string().optional(),
  misionesAsignadas: z.number(),
  misionesCompletadas: z.number(),
  ultimaActividad: z.string().optional(),
});

/**
 * Dashboard de status de participación: cuánto de lo ya lanzado ha
 * respondido cada quien. "Misiones asignadas" ya no es un número global del
 * proyecto — con misiones de tipo "relativo_inicio" (Día N desde el propio
 * arranque de cada participante), dos personas pueden tener distinto número
 * de misiones desbloqueadas en el mismo momento según cuándo hizo cada una
 * su primer login (fecha_inicio, ver preworkLogin.ts).
 */
export default createEndpoint({
  authenticated: true,
  description: 'Status de participación de cada participante en un estudio de Prework',
  inputSchema: z.object({ estudioId: z.string() }),
  outputSchema: z.object({ participantes: z.array(filaSchema) }),
  execute: async ({ input }) => {
    const hoy = fechaHoyMexico();

    const { rows } = await pool.query<{
      participante_id: string; nombre: string; email: string; incluido: boolean; estado_participacion: string;
      fecha_inicio: string | null; misiones_asignadas: string; misiones_completadas: string; ultima_actividad: string | null;
    }>(
      `select a.prework_participante_id as participante_id, p.nombre, p.email, a.incluido, a.estado_participacion, a.fecha_inicio,
              count(distinct m.id) filter (where m.estado = 'publicada' and (
                (m.modo_programacion = 'fecha_fija' and m.fecha_lanzamiento <= $2)
                or (m.modo_programacion = 'relativo_inicio' and a.fecha_inicio is not null
                    and (a.fecha_inicio + ((m.dia_relativo - 1) * interval '1 day'))::date <= $2::date)
              )) as misiones_asignadas,
              count(distinct r.mision_id) as misiones_completadas,
              max(r.entregada_at) as ultima_actividad
       from prework_asignaciones a
       join prework_participantes p on p.id = a.prework_participante_id
       left join prework_misiones m on m.prework_estudio_id = a.prework_estudio_id
       left join prework_respuestas r on r.prework_participante_id = a.prework_participante_id and r.prework_estudio_id = a.prework_estudio_id
       where a.prework_estudio_id = $1
       group by a.prework_participante_id, p.nombre, p.email, a.incluido, a.estado_participacion, a.fecha_inicio
       order by p.nombre`,
      [input.estudioId, hoy],
    );

    return {
      participantes: rows.map(r => ({
        participanteId: r.participante_id,
        nombre: r.nombre,
        email: r.email,
        incluido: r.incluido,
        estadoParticipacion: r.estado_participacion,
        fechaInicio: r.fecha_inicio ?? undefined,
        misionesAsignadas: Number(r.misiones_asignadas ?? 0),
        misionesCompletadas: Number(r.misiones_completadas ?? 0),
        ultimaActividad: r.ultima_actividad ?? undefined,
      })),
    };
  },
});
