import { z } from 'zod';
import { createEndpoint, pool, ZiteError } from '../../server/compat';
import { exigirAccesoFormularios } from '../serverUtils/formularios/acceso';
import { pasarAlReclutamiento, vinculoVigente, type Vinculo } from '../serverUtils/formularios/reclutamiento';
import { actualizarTablero } from '../serverUtils/formularios/tableroHub';
import { leerDefinicion } from '../lib/formularios/tipos';

/**
 * Pasa respuestas al tablero vinculado. Sin `respuestaIds`: todas las que no
 * se han pasado, califiquen o no (2026-10-26: en el tablero se califican, en
 * las columnas del Hub), menos las traídas de un filtro anterior (se pasan una
 * por una) y quien no aceptó el aviso o no dio su identificación. Con ids:
 * esas. Después pone al día las columnas del Hub.
 */
export default createEndpoint({
  authenticated: true,
  description: 'Pasa respuestas de un formulario a su tablero de reclutamiento',
  inputSchema: z.object({ formularioId: z.string(), respuestaIds: z.array(z.string()).optional() }),
  outputSchema: z.object({ pasadas: z.number(), yaEstaban: z.number(), columnasCreadas: z.number(), tablero: z.string() }),
  execute: async ({ input, context }) => {
    exigirAccesoFormularios(context);
    const { rows: [f] } = await pool.query(`select id, titulo, definicion, vinculo from formularios where id = $1`, [input.formularioId]);
    if (!f) throw new ZiteError({ code: 'NOT_FOUND', message: 'No se encontró el formulario.' });
    if (!f.vinculo) throw new ZiteError({ code: 'BAD_REQUEST', message: 'Primero elige el tablero de reclutamiento.' });
    const vinculo = await vinculoVigente(f.vinculo as Vinculo);
    if (!vinculo) throw new ZiteError({ code: 'BAD_REQUEST', message: 'El tablero vinculado ya no existe: elige o crea otro.' });

    const { rows } = input.respuestaIds?.length
      ? await pool.query(
        `select id, created_at, es_prueba, respuestas, resultado, duracion_seg from formulario_respuestas
         where formulario_id = $1 and id = any($2::uuid[]) order by created_at`,
        [f.id, input.respuestaIds],
      )
      : await pool.query(
        `select id, created_at, es_prueba, respuestas, resultado, duracion_seg from formulario_respuestas
         where formulario_id = $1 and not (resultado ? 'traida') and coalesce(resultado->'terminado'->>'clave', '') not like 'hub\_%' order by created_at`,
        [f.id],
      );

    const res = await pasarAlReclutamiento(
      { id: f.id, titulo: f.titulo, definicion: leerDefinicion(f.definicion), vinculo },
      rows.map((r) => ({
        id: r.id, createdAt: new Date(r.created_at).toISOString(), esPrueba: r.es_prueba,
        respuestas: r.respuestas, resultado: r.resultado, duracionSeg: r.duracion_seg ?? undefined,
      })),
      context.user?.email,
    );
    await actualizarTablero(f.id);
    return { ...res, tablero: vinculo.boardName };
  },
});
