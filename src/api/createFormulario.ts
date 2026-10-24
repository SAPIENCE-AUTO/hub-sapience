import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { createEndpoint, pool, ZiteError } from '../../server/compat';
import { exigirAccesoFormularios } from '../serverUtils/formularios/acceso';
import { PLANTILLAS } from '../lib/formularios/plantillas';
import { revisarDefinicion } from '../lib/formularios/revisar';
import { definicionVacia, generadorNuevo, type Generador } from '../lib/formularios/generador';
import { leerDefinicion, type Definicion } from '../lib/formularios/tipos';
import { conInicio } from '../lib/formularios/inicio';
import { historialDeTraidas, traerRespuestas } from '../serverUtils/formularios/traer';

/**
 * Crea un formulario. Arranca en borrador: nadie puede contestarlo hasta
 * pasarlo a prueba. El código del enlace es al azar (no sale del título)
 * para que el nombre del estudio no se lea en la URL.
 *
 * Puntos de partida (fase 3): una plantilla (como hasta ahora), la IA con
 * insumos, la IA con un screener en Word, o un filtro anterior que se copia
 * y se adapta. Con la IA el screener arranca vacío y lo llena el generador.
 * Desde un filtro anterior se puede traer también a quienes lo contestaron
 * (`traerRespuestas`, fase 5): llegan como candidatos «traídos».
 */
export default createEndpoint({
  authenticated: true,
  description: 'Crea un formulario (screener) desde una plantilla, con la IA o desde un filtro anterior',
  inputSchema: z.object({
    titulo: z.string().min(1),
    origen: z.enum(['plantilla', 'insumos', 'word', 'filtro']).default('plantilla'),
    plantilla: z.string().optional(),
    filtroBaseId: z.string().optional(),
    proyectoId: z.string().optional(),
    traerRespuestas: z.boolean().optional(),
  }),
  outputSchema: z.object({ id: z.string(), codigo: z.string(), traidas: z.number().optional() }),
  execute: async ({ input, context }) => {
    exigirAccesoFormularios(context);
    let definicion: Definicion;
    let generador: Generador | null = null;
    let plantilla: string;
    if (input.origen === 'plantilla') {
      const p = input.plantilla ? PLANTILLAS[input.plantilla] : undefined;
      if (!p) throw new ZiteError({ code: 'BAD_REQUEST', message: 'Esa plantilla no existe.' });
      definicion = p.definicion;
      plantilla = input.plantilla!;
    } else if (input.origen === 'filtro') {
      if (!input.filtroBaseId) throw new ZiteError({ code: 'BAD_REQUEST', message: 'Elige el filtro del que partes.' });
      const { rows: [base] } = await pool.query(`select id, titulo, definicion from formularios where id = $1`, [input.filtroBaseId]);
      if (!base) throw new ZiteError({ code: 'NOT_FOUND', message: 'No se encontró ese filtro.' });
      // Copia en versión 2: el filtro nuevo tiene su propio tablero, así que conserva los ids del anterior.
      definicion = leerDefinicion(base.definicion);
      generador = generadorNuevo('filtro', { id: base.id, titulo: base.titulo });
      plantilla = 'filtro';
    } else {
      definicion = definicionVacia();
      generador = generadorNuevo(input.origen);
      plantilla = 'ia';
    }
    // Todo filtro arranca con «Antes de empezar» (aviso, nombre e identificación); lo pone el Hub.
    definicion = conInicio(definicion);
    const problemas = revisarDefinicion(definicion);
    if (problemas.length) throw new ZiteError({ code: 'BAD_REQUEST', message: `El screener de partida tiene problemas: ${problemas.join(' ')}` });

    for (let intento = 0; intento < 5; intento++) {
      const codigo = randomBytes(5).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 7);
      if (codigo.length < 6) continue;
      const { rows } = await pool.query(
        `insert into formularios (codigo, titulo, plantilla, definicion, proyecto_id, created_by, generador)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (codigo) do nothing
         returning id`,
        [codigo, input.titulo.trim(), plantilla, JSON.stringify(definicion), input.proyectoId ?? null, context.user!.id, generador && JSON.stringify(generador)],
      );
      if (!rows[0]) continue;
      const id = rows[0].id as string;
      if (input.origen === 'filtro' && input.traerRespuestas && input.filtroBaseId) {
        const traidas = await traerRespuestas(input.filtroBaseId, id);
        historialDeTraidas(traidas).catch(() => {});
        return { id, codigo, traidas: traidas.length };
      }
      return { id, codigo };
    }
    throw new ZiteError({ code: 'INTERNAL_ERROR', message: 'No se pudo generar el enlace del formulario. Intenta otra vez.' });
  },
});
