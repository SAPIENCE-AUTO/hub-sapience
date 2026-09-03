import { z } from 'zod';
import { createEndpoint, ZiteError, pool } from '../../server/compat';
import { verifySessionToken } from '../../server/preworkAuth';
import { fechaHoyMexico } from '../../server/preworkDate';

const misionSchema = z.object({
  id: z.string(),
  estudioId: z.string(),
  titulo: z.string(),
  descripcion: z.string().optional(),
  tipo: z.string(),
  configuracion: z.any(),
  visibilidad: z.string(),
  modoProgramacion: z.string(),
  fechaLanzamiento: z.string().optional(),
  diaRelativo: z.number().optional(),
});

const seguimientoSchema = z.object({
  id: z.string(),
  misionId: z.string().optional(),
  mensaje: z.string(),
  leido: z.boolean(),
  respuestaParticipante: z.string().optional(),
  createdAt: z.string(),
});

/**
 * Portal de participante: misiones pendientes/completadas + follow-ups.
 * "Pendiente" desbloqueada = `fecha_lanzamiento <= hoy` en la propia
 * consulta — no hay cron ni job de desbloqueo (ver plan del módulo: no hay
 * cron en este repo hoy). "Hoy" se calcula en hora de México
 * (fechaHoyMexico), no con el `current_date` de Postgres — ver preworkDate.ts.
 * Una misión se considera completada si existe al menos una entrega de este
 * participante para ella, sin importar si el moderador ya la revisó.
 */
export default createEndpoint({
  authenticated: false,
  description: 'Misiones pendientes/completadas y follow-ups del participante logueado en Prework',
  inputSchema: z.object({ token: z.string() }),
  outputSchema: z.object({
    participanteNombre: z.string(),
    pendientes: z.array(misionSchema),
    completadas: z.array(misionSchema),
    seguimientos: z.array(seguimientoSchema),
  }),
  execute: async ({ input }) => {
    const session = verifySessionToken(input.token);
    if (!session) throw new ZiteError({ code: 'UNAUTHORIZED', message: 'Sesión inválida o expirada.' });

    const { rows: participanteRows } = await pool.query<{ nombre: string }>(
      `select nombre from prework_participantes where id = $1`,
      [session.participanteId],
    );
    if (!participanteRows[0]) throw new ZiteError({ code: 'NOT_FOUND', message: 'Participante no encontrado.' });

    const { rows: misiones } = await pool.query<{
      id: string; prework_estudio_id: string; titulo: string; descripcion: string | null;
      tipo: string; configuracion: unknown; visibilidad: string; modo_programacion: string;
      fecha_lanzamiento: string | null; dia_relativo: number | null; orden: number;
    }>(
      // Desbloqueo en dos modos: fecha fija (igual para todo el estudio) o
      // "Día N" relativo a la fecha_inicio de ESTE participante EN ESE
      // estudio (cohortes escalonadas — ver createPreworkMision.ts).
      // fecha_inicio null = todavía no ha hecho login nunca, ninguna misión
      // relativa aplica. "select distinct" exige que las columnas de order
      // by estén en el select list — de ahí m.orden aquí aunque no se use
      // en el output.
      `select distinct m.id, m.prework_estudio_id, m.titulo, m.descripcion, m.tipo, m.configuracion,
              m.visibilidad, m.modo_programacion, m.fecha_lanzamiento, m.dia_relativo, m.orden
       from prework_misiones m
       join prework_asignaciones a on a.prework_estudio_id = m.prework_estudio_id
       where a.prework_participante_id = $1
         and a.incluido = true
         and m.estado = 'publicada'
         and (
           (m.modo_programacion = 'fecha_fija' and m.fecha_lanzamiento <= $2)
           or (m.modo_programacion = 'relativo_inicio' and a.fecha_inicio is not null
               and (a.fecha_inicio + ((m.dia_relativo - 1) * interval '1 day'))::date <= $2::date)
         )
       order by m.fecha_lanzamiento asc nulls last, m.dia_relativo asc nulls last, m.orden asc`,
      [session.participanteId, fechaHoyMexico()],
    );

    const { rows: respuestas } = await pool.query<{ mision_id: string }>(
      `select distinct mision_id from prework_respuestas where prework_participante_id = $1`,
      [session.participanteId],
    );
    const misionesConRespuesta = new Set(respuestas.map(r => r.mision_id));

    const { rows: seguimientos } = await pool.query<{
      id: string; mision_id: string | null; mensaje: string; leido: boolean;
      respuesta_participante: string | null; created_at: string;
    }>(
      `select id, mision_id, mensaje, leido, respuesta_participante, created_at
       from prework_seguimientos
       where prework_participante_id = $1
       order by created_at desc`,
      [session.participanteId],
    );

    const toMision = (m: typeof misiones[number]) => ({
      id: m.id,
      estudioId: m.prework_estudio_id,
      titulo: m.titulo,
      descripcion: m.descripcion ?? undefined,
      tipo: m.tipo,
      configuracion: m.configuracion,
      visibilidad: m.visibilidad,
      modoProgramacion: m.modo_programacion,
      fechaLanzamiento: m.fecha_lanzamiento ?? undefined,
      diaRelativo: m.dia_relativo ?? undefined,
    });

    return {
      participanteNombre: participanteRows[0].nombre,
      pendientes: misiones.filter(m => !misionesConRespuesta.has(m.id)).map(toMision),
      completadas: misiones.filter(m => misionesConRespuesta.has(m.id)).map(toMision),
      seguimientos: seguimientos.map(s => ({
        id: s.id,
        misionId: s.mision_id ?? undefined,
        mensaje: s.mensaje,
        leido: s.leido,
        respuestaParticipante: s.respuesta_participante ?? undefined,
        createdAt: s.created_at,
      })),
    };
  },
});
