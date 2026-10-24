import { z } from 'zod';
import { createEndpoint, pool, ZiteError } from '../../server/compat';
import { exigirAccesoFormularios } from '../serverUtils/formularios/acceso';
import { renombrarColumnas, type Vinculo } from '../serverUtils/formularios/reclutamiento';
import { revisarDefinicion } from '../lib/formularios/revisar';
import { leerDefinicion } from '../lib/formularios/tipos';

/** Antes de una tanda de cambios se guarda sola una versión con cómo estaba (si la última tiene más de esto). */
const MINUTOS_ENTRE_AUTOMATICAS = 30;

/**
 * Guarda el screener desde el editor (fase 2 de Filtros). Lo que llega pasa
 * por revisarDefinicion: un screener mal armado no se guarda, porque si está
 * en prueba la gente lo está contestando con esto. `revision` es la que tenía
 * el editor al cargar: si otra persona (u otra ventana) guardó mientras tanto,
 * no se pisa y se avisa. Los ids no los toca el servidor: el editor nunca los
 * cambia y son la clave de las columnas del tablero. Si el filtro está
 * vinculado a un tablero, las columnas que ya existen toman el nombre corto
 * nuevo de su pregunta (renombrarColumnas).
 *
 * En vivo (2026-10-24) se guarda en `cambios`, la copia de trabajo: los
 * participantes siguen con `definicion` hasta que se publica
 * (publishFormularioCambios). La revisión sube igual, para no pisar a nadie.
 */
export default createEndpoint({
  authenticated: true,
  description: 'Guarda el screener de un formulario desde el editor',
  inputSchema: z.object({
    formularioId: z.string(),
    definicion: z.any(),
    revision: z.number().int(),
    /**
     * Fase 3: secciones del generador que este guardado deja puestas en el
     * screener (id → firma del plan). Se marcan en la misma transacción: si el
     * guardado no entra, se vuelven a poner al abrir el filtro.
     */
    aplicadas: z.record(z.string(), z.string()).optional(),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    revision: z.number(),
  }),
  execute: async ({ input, context }) => {
    exigirAccesoFormularios(context);
    const def = leerDefinicion(input.definicion);
    const problemas = revisarDefinicion(def);
    if (problemas.length) throw new ZiteError({ code: 'BAD_REQUEST', message: `El screener tiene problemas: ${problemas.join(' ')}` });

    const client = await pool.connect();
    try {
      await client.query('begin');
      const { rows: [f] } = await client.query(`select revision, vinculo, estado from formularios where id = $1 for update`, [input.formularioId]);
      if (!f) throw new ZiteError({ code: 'NOT_FOUND', message: 'No se encontró el formulario.' });
      if (f.revision !== input.revision) {
        await client.query('rollback');
        return { ok: false, revision: f.revision as number };
      }
      if (f.estado === 'en_vivo') {
        const { rows: [n] } = await client.query(
          `update formularios set cambios = $2, revision = revision + 1, updated_at = now() where id = $1 returning revision`,
          [input.formularioId, JSON.stringify(def)],
        );
        await client.query('commit');
        return { ok: true, revision: n.revision as number };
      }
      await client.query(
        `insert into formulario_versiones (formulario_id, revision, definicion, created_by)
         select id, revision, definicion, $2 from formularios
         where id = $1 and not exists (
           select 1 from formulario_versiones where formulario_id = $1 and created_at > now() - make_interval(mins => $3)
         )`,
        [input.formularioId, context.user!.id, MINUTOS_ENTRE_AUTOMATICAS],
      );
      const { rows: [n] } = await client.query(
        `update formularios set definicion = $2, cambios = null, revision = revision + 1, updated_at = now() where id = $1 returning revision`,
        [input.formularioId, JSON.stringify(def)],
      );
      if (input.aplicadas && Object.keys(input.aplicadas).length) {
        await client.query(
          `update formularios set generador = jsonb_set(generador, '{aplicadas}', coalesce(generador->'aplicadas', '{}'::jsonb) || $2::jsonb)
           where id = $1 and generador is not null`,
          [input.formularioId, JSON.stringify(input.aplicadas)],
        );
      }
      await client.query('commit');
      // Si ya está vinculado a un tablero, sus columnas toman el nombre nuevo de cada pregunta (sin hacer esperar al guardado).
      if (f.vinculo) {
        renombrarColumnas(input.formularioId, f.vinculo as Vinculo, def)
          .catch((err) => console.error('[filtros] no se pudieron renombrar las columnas del tablero', err));
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
