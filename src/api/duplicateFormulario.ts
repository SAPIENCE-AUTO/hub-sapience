import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { createEndpoint, pool, ZiteError } from '../../server/compat';
import { exigirAccesoFormularios } from '../serverUtils/formularios/acceso';
import { copiarArchivosInsumo } from '../serverUtils/formularios/insumos';
import { leerGenerador } from '../lib/formularios/generador';
import { leerDefinicion } from '../lib/formularios/tipos';

/**
 * Duplica un filtro: el mismo screener (y lo de la IA: estructura, supuestos e
 * insumos, con sus PDF copiados), como borrador nuevo del mismo proyecto, con
 * enlace propio y sin respuestas ni tablero vinculado.
 */
export default createEndpoint({
  authenticated: true,
  description: 'Duplica un filtro como borrador nuevo, sin respuestas ni tablero',
  inputSchema: z.object({ formularioId: z.string() }),
  outputSchema: z.object({ id: z.string(), codigo: z.string() }),
  execute: async ({ input, context }) => {
    exigirAccesoFormularios(context);
    const { rows: [f] } = await pool.query(
      `select titulo, plantilla, definicion, proyecto_id, generador from formularios where id = $1`,
      [input.formularioId],
    );
    if (!f) throw new ZiteError({ code: 'NOT_FOUND', message: 'No se encontró ese filtro.' });
    for (let intento = 0; intento < 5; intento++) {
      const codigo = randomBytes(5).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 7);
      if (codigo.length < 6) continue;
      const { rows } = await pool.query(
        `insert into formularios (codigo, titulo, plantilla, definicion, proyecto_id, created_by)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (codigo) do nothing
         returning id`,
        [codigo, `${f.titulo} (copia)`, f.plantilla, JSON.stringify(leerDefinicion(f.definicion)), f.proyecto_id, context.user!.id],
      );
      if (!rows[0]) continue;
      const id = rows[0].id as string;
      const g = leerGenerador(f.generador);
      if (g) {
        const archivos = await copiarArchivosInsumo(g.insumos.archivos, input.formularioId, id);
        await pool.query(`update formularios set generador = $2 where id = $1`, [id, JSON.stringify({ ...g, insumos: { ...g.insumos, archivos } })]);
      }
      return { id, codigo };
    }
    throw new ZiteError({ code: 'INTERNAL_ERROR', message: 'No se pudo generar el enlace de la copia. Intenta otra vez.' });
  },
});
