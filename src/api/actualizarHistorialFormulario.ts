import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';
import { exigirAccesoFormularios } from '../serverUtils/formularios/acceso';
import { guardarHistorial } from '../serverUtils/formularios/historial';
import { recalificar } from '../serverUtils/formularios/traer';
import { leerDefinicion, type Respuestas, type Resultado } from '../lib/formularios/tipos';

/**
 * Vuelve a buscar el historial (duplicados) de todas las respuestas de un
 * filtro, contra el cliente y las fechas de su proyecto: lo que pasó en los
 * tableros desde que contestaron (alguien asistió, se agendó) ya cuenta. Las
 * traídas de un filtro anterior se vuelven a calificar con el filtro de ahora.
 */
export default createEndpoint({
  authenticated: true,
  description: 'Vuelve a calcular el historial de duplicados de las respuestas de un filtro',
  inputSchema: z.object({ formularioId: z.string() }),
  outputSchema: z.object({ revisadas: z.number(), conHistorial: z.number() }),
  execute: async ({ input, context }) => {
    exigirAccesoFormularios(context);
    const { rows } = await pool.query(`select id from formulario_respuestas where formulario_id = $1 order by created_at`, [input.formularioId]);
    const { rows: [f] } = await pool.query(`select coalesce(cambios, definicion) as definicion from formularios where id = $1`, [input.formularioId]);
    const { rows: traidas } = await pool.query(`select id, respuestas, resultado from formulario_respuestas where formulario_id = $1 and resultado ? 'traida'`, [input.formularioId]);
    if (f) {
      const def = leerDefinicion(f.definicion);
      for (const t of traidas) {
        const res = recalificar(def, t.respuestas as Respuestas, t.resultado as Resultado);
        await pool.query(`update formulario_respuestas set resultado = $2, califica = $3 where id = $1`, [t.id, JSON.stringify(res), res.califica]);
      }
    }
    let conHistorial = 0;
    for (const r of rows) {
      const h = await guardarHistorial(r.id);
      if (h?.nivel) conHistorial++;
    }
    return { revisadas: rows.length, conHistorial };
  },
});
