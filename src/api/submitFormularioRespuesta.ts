import { z } from 'zod';
import { createEndpoint, pool, ZiteError } from '../../server/compat';
import { evaluar } from '../lib/formularios/motor';
import { leerDefinicion, type FotoSubida, type Respuestas, FOTOS_TOPE, maxFotosDe } from '../lib/formularios/tipos';
import { alRecibirRespuesta } from '../serverUtils/formularios/alRecibir';

/**
 * Público — guarda una respuesta, completa o cortada (solo cortan los
 * criterios marcados «cortar», el aviso y la identificación). La calificación
 * la hace el servidor con la definición completa: lo que diga el navegador no
 * cuenta. Nunca se le dice al participante si calificó. Lo demás (la
 * identificación, el historial, el paso al tablero en vivo y la clasificación
 * con la IA) corre después, sin hacerlo esperar (alRecibir.ts).
 */
export default createEndpoint({
  authenticated: false,
  description: 'Un participante envía sus respuestas a un formulario',
  inputSchema: z.object({
    codigo: z.string(),
    respuestas: z.record(z.string(), z.any()),
    deviceToken: z.string().max(100).optional(),
    duracionSeg: z.number().int().nonnegative().optional(),
  }),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async ({ input }) => {
    const { rows: [f] } = await pool.query(`select id, estado, definicion from formularios where codigo = $1`, [input.codigo]);
    if (!f || !['prueba', 'en_vivo'].includes(f.estado)) {
      throw new ZiteError({ code: 'BAD_REQUEST', message: 'Este formulario ya no recibe respuestas.' });
    }
    if (JSON.stringify(input.respuestas).length > 200_000) {
      throw new ZiteError({ code: 'BAD_REQUEST', message: 'La respuesta es demasiado grande.' });
    }

    // Solo se aceptan fotos subidas a la carpeta de este formulario (server/upload.ts): nadie puede apuntar a otra.
    // Y no más de las que pide su pregunta (3 si no se dice, hasta 10).
    const def = leerDefinicion(f.definicion);
    const preguntaDe = (clave: string) => def.secciones.flatMap((s) => s.preguntas).find((p) => p.id === clave.split('@')[0]);
    const respuestas: Respuestas = {};
    for (const [clave, valor] of Object.entries(input.respuestas)) {
      if (Array.isArray(valor) && valor.some((x) => typeof x === 'object' && x !== null)) {
        const p = preguntaDe(clave);
        respuestas[clave] = (valor as FotoSubida[])
          .filter((x) => typeof x?.ruta === 'string' && x.ruta.startsWith(`${f.id}/`))
          .slice(0, p ? maxFotosDe(p) : FOTOS_TOPE)
          .map((x) => ({ ruta: x.ruta, nombre: String(x.nombre ?? '').slice(0, 150) }));
      } else {
        respuestas[clave] = valor;
      }
    }

    const resultado = evaluar(def, respuestas);
    const texto = (id?: string) => (id && typeof respuestas[id] === 'string' ? (respuestas[id] as string).slice(0, 200) : null);

    const { rows: [nueva] } = await pool.query(
      `insert into formulario_respuestas (formulario_id, es_prueba, respuestas, resultado, califica, nombre, telefono, device_token, duracion_seg)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
      [
        f.id, f.estado === 'prueba', JSON.stringify(respuestas), JSON.stringify(resultado), resultado.califica,
        texto(def.claves?.nombre), texto(def.claves?.telefono), input.deviceToken ?? null, input.duracionSeg ?? null,
      ],
    );
    alRecibirRespuesta(nueva.id as string).catch((err) => console.error('[filtros] después de recibir una respuesta', err));
    return { ok: true };
  },
});
