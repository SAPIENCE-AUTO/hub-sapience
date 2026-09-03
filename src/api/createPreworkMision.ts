import { z } from 'zod';
import { createEndpoint, ZiteError, pool } from '../../server/compat';
import { publishEvent } from '../lib/ably';
import { fechaHoyMexico } from '../../server/preworkDate';

const TIPOS = [
  'foto', 'video', 'texto', 'matching', 'swipe', 'voto', 'reaccion',
  'nota_voz', 'encuesta', 'ranking', 'reaccion_estimulo', 'heatmap', 'dibujar',
] as const;

const baseSchema = z.object({
  estudioId: z.string(),
  titulo: z.string().min(1),
  descripcion: z.string().optional(),
  tipo: z.enum(TIPOS),
  configuracion: z.record(z.string(), z.any()).optional(),
  visibilidad: z.enum(['privada', 'social']).default('privada'),
  orden: z.number().optional(),
  estado: z.enum(['borrador', 'publicada', 'archivada']).default('publicada'),
});

// Dos formas de programar: fecha fija de calendario (todo el estudio ve la
// misma fecha) o "Día N" relativo al inicio de cada participante (cohortes
// escalonadas — ver prework_asignaciones.fecha_inicio, que arranca sola en
// el primer login de cada quien, no la fija el moderador).
const inputSchema = z.discriminatedUnion('modoProgramacion', [
  baseSchema.extend({ modoProgramacion: z.literal('fecha_fija'), fechaLanzamiento: z.string() }),
  baseSchema.extend({ modoProgramacion: z.literal('relativo_inicio'), diaRelativo: z.number().int().min(1) }),
]);

export default createEndpoint({
  authenticated: true,
  description: 'Crea una misión/tarea dentro de un estudio de Prework (fecha fija o día relativo al inicio de cada participante)',
  inputSchema,
  outputSchema: z.object({ id: z.string() }),
  execute: async ({ input, context }) => {
    const { rows: estudioRows } = await pool.query(`select id from prework_estudios where id = $1`, [input.estudioId]);
    if (!estudioRows[0]) throw new ZiteError({ code: 'NOT_FOUND', message: 'Estudio no encontrado' });

    const fechaLanzamiento = input.modoProgramacion === 'fecha_fija' ? input.fechaLanzamiento : null;
    const diaRelativo = input.modoProgramacion === 'relativo_inicio' ? input.diaRelativo : null;

    const { rows } = await pool.query<{ id: string }>(
      `insert into prework_misiones
         (prework_estudio_id, titulo, descripcion, tipo, configuracion, visibilidad, modo_programacion, fecha_lanzamiento, dia_relativo, orden, estado, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       returning id`,
      [
        input.estudioId, input.titulo, input.descripcion ?? null, input.tipo,
        JSON.stringify(input.configuracion ?? {}), input.visibilidad, input.modoProgramacion,
        fechaLanzamiento, diaRelativo, input.orden ?? 0, input.estado, context.user!.id,
      ],
    );
    const misionId = rows[0].id;

    if (input.estado === 'publicada') {
      const hoy = fechaHoyMexico();
      // Solo avisa en vivo a quien la misión ya le es visible hoy. En modo
      // fecha fija es la misma fecha para todos; en relativo depende de la
      // fecha_inicio de cada participante (null = nunca ha hecho login, no
      // hay a quién avisarle — sin sesión no hay realtime que reciba nada).
      const { rows: asignados } = input.modoProgramacion === 'fecha_fija'
        ? input.fechaLanzamiento <= hoy
          ? await pool.query<{ prework_participante_id: string }>(
              `select prework_participante_id from prework_asignaciones where prework_estudio_id = $1 and incluido = true`,
              [input.estudioId],
            )
          : { rows: [] }
        : await pool.query<{ prework_participante_id: string }>(
            `select prework_participante_id from prework_asignaciones
             where prework_estudio_id = $1 and incluido = true and fecha_inicio is not null
               and (fecha_inicio + (($2::int - 1) * interval '1 day'))::date <= $3::date`,
            [input.estudioId, input.diaRelativo, hoy],
          );

      await Promise.all(asignados.map(a =>
        publishEvent(`prework:participante:${a.prework_participante_id}`, 'mision.created', { misionId }).catch(() => {})
      ));
    }

    return { id: misionId };
  },
});
