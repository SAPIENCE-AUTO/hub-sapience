import { z } from 'zod';
import { createEndpoint, ZiteError } from '../../server/compat';
import { cuotaIA, exigirAccesoGuias } from '../serverUtils/guias/acceso';
import { conLatido, llamarJSON, MODELO_ROADMAP } from '../serverUtils/guias/claude';
import { EstadoGuiaZ, RoadmapIAZ } from '../serverUtils/guias/esquemas';
import { limpiarRoadmap } from '../serverUtils/guias/normalizar';
import { promptLeerRoadmap, promptRoadmapDesdeBrief, promptRoadmapDesdeTema } from '../serverUtils/guias/prompts';

// Lee un roadmap pegado/subido, o propone uno desde el brief o desde el tema (según estado.modo).
export default createEndpoint({
  authenticated: true,
  streaming: true,
  description: 'Lee o propone el roadmap de una guía de tópicos',
  inputSchema: z.object({ estado: EstadoGuiaZ, fuente: z.string().max(200000).optional() }),
  outputSchema: z.object({ roadmap: z.any(), supuestos: z.array(z.string()), proyecto: z.string().optional(), duracion: z.number().optional() }),
  execute: async ({ input, context, stream }) => {
    exigirAccesoGuias(context);
    const st: any = input.estado;
    const fuente = input.fuente?.trim() ?? '';
    if (st.modo !== 'tema' && !fuente) throw new ZiteError({ code: 'BAD_REQUEST', message: 'Falta el texto del roadmap o del brief.' });
    if (st.modo === 'tema' && !st.tema.trim()) throw new ZiteError({ code: 'BAD_REQUEST', message: 'Escribe el tema de la guía.' });
    cuotaIA(context);
    const usuario = st.modo === 'roadmap' ? promptLeerRoadmap(st, fuente) : st.modo === 'brief' ? promptRoadmapDesdeBrief(st, fuente) : promptRoadmapDesdeTema(st);
    const mensaje = st.modo === 'roadmap' ? 'Leyendo el roadmap…' : 'Armando los bloques…';
    const out = await conLatido(stream, mensaje, () => llamarJSON({ usuario, esquema: RoadmapIAZ, modelo: MODELO_ROADMAP, maxTokens: 6000 }));
    return limpiarRoadmap(out);
  },
});
