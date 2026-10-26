import { z } from 'zod';
import { createEndpoint, pool, ZiteError } from '../../server/compat';
import { exigirAccesoFormularios } from '../serverUtils/formularios/acceso';
import { renombrarColumnas, type Vinculo } from '../serverUtils/formularios/reclutamiento';
import { actualizarTablero } from '../serverUtils/formularios/tableroHub';
import { revisarDefinicion } from '../lib/formularios/revisar';
import { leerDefinicion } from '../lib/formularios/tipos';

/**
 * Publica los cambios de un filtro en vivo (`cambios` → `definicion`): desde
 * ahí los contestan los participantes. Antes guarda una versión con cómo
 * estaba («Antes de publicar cambios»). Las respuestas que ya entraron no se
 * tocan. Con `descartar`, tira la copia de trabajo y se queda lo publicado.
 * `revision` es la del editor: si otra ventana guardó mientras tanto, no se
 * publica y se avisa.
 */
export default createEndpoint({
  authenticated: true,
  description: 'Publica o descarta los cambios sin publicar de un filtro en vivo',
  inputSchema: z.object({ formularioId: z.string(), revision: z.number().int(), descartar: z.boolean().optional() }),
  outputSchema: z.object({ ok: z.boolean(), revision: z.number() }),
  execute: async ({ input, context }) => {
    exigirAccesoFormularios(context);
    const client = await pool.connect();
    try {
      await client.query('begin');
      const { rows: [f] } = await client.query(`select revision, vinculo, cambios from formularios where id = $1 for update`, [input.formularioId]);
      if (!f) throw new ZiteError({ code: 'NOT_FOUND', message: 'No se encontró el filtro.' });
      if (f.revision !== input.revision) {
        await client.query('rollback');
        return { ok: false, revision: f.revision as number };
      }
      if (input.descartar || !f.cambios) {
        const { rows: [n] } = await client.query(`update formularios set cambios = null, revision = revision + 1, updated_at = now() where id = $1 returning revision`, [input.formularioId]);
        await client.query('commit');
        return { ok: true, revision: n.revision as number };
      }
      const def = leerDefinicion(f.cambios);
      const problemas = revisarDefinicion(def);
      if (problemas.length) throw new ZiteError({ code: 'BAD_REQUEST', message: `El filtro tiene problemas: ${problemas.join(' ')}` });
      await client.query(
        `insert into formulario_versiones (formulario_id, revision, definicion, nota, created_by)
         select id, revision, definicion, 'Antes de publicar cambios', $2 from formularios where id = $1`,
        [input.formularioId, context.user!.id],
      );
      const { rows: [n] } = await client.query(
        `update formularios set definicion = cambios, cambios = null, revision = revision + 1, updated_at = now() where id = $1 returning revision`,
        [input.formularioId],
      );
      await client.query('commit');
      if (f.vinculo) {
        // Primero los nombres de columna; después, con las reglas y cuotas nuevas, las columnas del Hub.
        renombrarColumnas(input.formularioId, f.vinculo as Vinculo, def)
          .then(() => actualizarTablero(input.formularioId))
          .catch((err) => console.error('[filtros] no se pudo poner al día el tablero', err));
      }
      return { ok: true, revision: n.revision as number };
    } catch (err) {
      try { await client.query('rollback'); } catch { /* la conexión ya murió */ }
      throw err;
    } finally {
      client.release();
    }
  },
});
