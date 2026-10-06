import { z } from 'zod';
import { createEndpoint, ZiteError } from '../../server/compat';
import { cuotaIA, exigirAccesoGuias } from '../serverUtils/guias/acceso';
import { conLatido, llamarJSON, MODELO_ROADMAP } from '../serverUtils/guias/claude';
import { EstadoGuiaZ, RoadmapIAZ } from '../serverUtils/guias/esquemas';
import { limpiarRoadmap } from '../serverUtils/guias/normalizar';
import { promptAjustarRoadmap } from '../serverUtils/guias/prompts';

// Ajusta el roadmap con un pedido en palabras («junta los dos últimos», «más tiempo a empaques»).
export default createEndpoint({
  authenticated: true,
  streaming: true,
  description: 'Ajusta el roadmap de una guía de tópicos con un pedido en palabras',
  inputSchema: z.object({ estado: EstadoGuiaZ, pedido: z.string().trim().min(1).max(2000) }),
  outputSchema: z.object({ roadmap: z.any(), supuestos: z.array(z.string()), proyecto: z.string().optional(), duracion: z.number().optional() }),
  execute: async ({ input, context, stream }) => {
    exigirAccesoGuias(context);
    const st: any = input.estado;
    if (!st.roadmap?.bloques?.length) throw new ZiteError({ code: 'BAD_REQUEST', message: 'Primero arma o pide el roadmap.' });
    cuotaIA(context);
    const out = await conLatido(stream, 'Ajustando…', () =>
      llamarJSON({ usuario: promptAjustarRoadmap(st, input.pedido), esquema: RoadmapIAZ, modelo: MODELO_ROADMAP, maxTokens: 6000 }));
    return limpiarRoadmap(out);
  },
});
