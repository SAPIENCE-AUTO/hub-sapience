import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { createEndpoint, pool, ZiteError } from '../../server/compat';
import { exigirAccesoFormularios } from '../serverUtils/formularios/acceso';
import { PLANTILLAS } from '../lib/formularios/plantillas';
import { revisarDefinicion } from '../lib/formularios/revisar';

/**
 * Crea un formulario a partir de una plantilla. Arranca en borrador: nadie
 * puede contestarlo hasta pasarlo a prueba. El código del enlace es al azar
 * (no sale del título) para que el nombre del estudio no se lea en la URL.
 */
export default createEndpoint({
  authenticated: true,
  description: 'Crea un formulario (screener) desde una plantilla',
  inputSchema: z.object({
    titulo: z.string().min(1),
    plantilla: z.string(),
    proyectoId: z.string().optional(),
  }),
  outputSchema: z.object({ id: z.string(), codigo: z.string() }),
  execute: async ({ input, context }) => {
    exigirAccesoFormularios(context);
    const plantilla = PLANTILLAS[input.plantilla];
    if (!plantilla) throw new ZiteError({ code: 'BAD_REQUEST', message: 'Esa plantilla no existe.' });
    const problemas = revisarDefinicion(plantilla.definicion);
    if (problemas.length) throw new ZiteError({ code: 'BAD_REQUEST', message: `La plantilla tiene problemas: ${problemas.join(' ')}` });

    for (let intento = 0; intento < 5; intento++) {
      const codigo = randomBytes(5).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 7);
      if (codigo.length < 6) continue;
      const { rows } = await pool.query(
        `insert into formularios (codigo, titulo, plantilla, definicion, proyecto_id, created_by)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (codigo) do nothing
         returning id`,
        [codigo, input.titulo.trim(), input.plantilla, JSON.stringify(plantilla.definicion), input.proyectoId ?? null, context.user!.id],
      );
      if (rows[0]) return { id: rows[0].id as string, codigo };
    }
    throw new ZiteError({ code: 'INTERNAL_ERROR', message: 'No se pudo generar el enlace del formulario. Intenta otra vez.' });
  },
});
