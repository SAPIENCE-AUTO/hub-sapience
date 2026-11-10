import { z } from 'zod';
import { createEndpoint, pool, ZiteError } from '../../server/compat';
import { exigirAccesoFormularios } from '../serverUtils/formularios/acceso';
import { borrarFotos, rutasDeFotos } from '../serverUtils/formularios/storage';
import { borrarInsumosDeFormulario } from '../serverUtils/formularios/insumos';

/**
 * Borra un formulario que solo tiene respuestas de prueba (y sus fotos e insumos). Con respuestas reales se rechaza: esas se cierran, no se borran.
 * Las personas TRAÍDAS de un filtro anterior no cuentan como reales mientras la copia no tenga tablero vinculado (son copias: no contestaron por este enlace; con tablero,
 * esas personas ya son parte del proyecto y el filtro se cierra, no se borra). Se van con la copia, pero sus fotos NO se borran: guardan las mismas rutas que las respuestas
 * del filtro de origen, y borrarlas dejaría rotas las de allá. Antes, una copia con traídas no se podía borrar nunca.
 */
export default createEndpoint({
  authenticated: true,
  description: 'Borra un formulario sin respuestas reales',
  inputSchema: z.object({ formularioId: z.string() }),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async ({ input, context }) => {
    exigirAccesoFormularios(context);
    const { rows: [{ reales }] } = await pool.query(
      `select count(*)::int as reales from formulario_respuestas r join formularios f on f.id = r.formulario_id
       where r.formulario_id = $1 and not r.es_prueba and (not (r.resultado ? 'traida') or f.vinculo is not null)`,
      [input.formularioId],
    );
    if (reales > 0) throw new ZiteError({ code: 'BAD_REQUEST', message: 'Este formulario tiene respuestas reales: ciérralo en lugar de borrarlo.' });
    const { rows } = await pool.query(`select respuestas from formulario_respuestas where formulario_id = $1 and not (resultado ? 'traida')`, [input.formularioId]);
    await pool.query(`delete from formularios where id = $1`, [input.formularioId]);
    await borrarFotos(rows.flatMap((r) => rutasDeFotos(r.respuestas)));
    // Los PDF que se subieron como insumos del generador (fase 3).
    await borrarInsumosDeFormulario(input.formularioId).catch((e) => console.error('[filtros] no se pudieron borrar los insumos', e));
    return { ok: true };
  },
});
