import { z } from 'zod';
import { createEndpoint, ZiteError } from '../../server/compat';
import { cuotaIA, exigirAccesoGuias } from '../serverUtils/guias/acceso';
import { conLatido, llamarJSON, MODELO_BLOQUE } from '../serverUtils/guias/claude';
import { BloqueGuiaZ, EstadoGuiaZ } from '../serverUtils/guias/esquemas';
import { limpiarBloque } from '../serverUtils/guias/normalizar';
import { promptBloque } from '../serverUtils/guias/prompts';

// Escribe un bloque (o lo rehace con un comentario). El front llama de dos en dos; cada bloque
// aparece en cuanto está listo y, si uno falla, se queda con «Reintentar» sin detener a los demás.
export default createEndpoint({
  authenticated: true,
  streaming: true,
  description: 'Escribe (o rehace) un bloque de la guía de tópicos',
  inputSchema: z.object({ estado: EstadoGuiaZ, indice: z.number().int().min(0).max(19), previo: BloqueGuiaZ.nullish(), comentario: z.string().trim().max(2000).nullish() }),
  outputSchema: z.object({ bloque: z.any() }),
  execute: async ({ input, context, stream }) => {
    exigirAccesoGuias(context);
    const st: any = input.estado;
    const b = st.roadmap?.bloques?.[input.indice];
    if (!b) throw new ZiteError({ code: 'BAD_REQUEST', message: 'Ese bloque no existe.' });
    if (!b.nombre.trim()) throw new ZiteError({ code: 'BAD_REQUEST', message: `El bloque ${input.indice + 1} necesita un nombre.` });
    cuotaIA(context);
    const out = await conLatido(stream, `Escribiendo «${b.nombre}»…`, () =>
      llamarJSON({ usuario: promptBloque(st, input.indice, input.previo as any, input.comentario ?? ''), esquema: BloqueGuiaZ, modelo: MODELO_BLOQUE, maxTokens: 16000 }));
    return { bloque: limpiarBloque(out as any) };
  },
});
