import { z } from 'zod';
import { createEndpoint, Propuestas } from '../../server/compat';
import { exigirAccesoPropuestas } from '../serverUtils/propuestas/acceso';
import { cargarPropuesta } from '../serverUtils/propuestas/datos';
import { Paleta, PORTADA_IDS } from '../serverUtils/propuestas/esquemas';

export default createEndpoint({
  authenticated: true,
  description: 'Guarda estilo, portada, paleta e ilustraciones elegidos (dentro de esqueleto.diseno) — solo Sergio',
  inputSchema: z.object({
    id: z.string(),
    estilo: z.enum(['A', 'B', 'C', 'D', 'E', 'F', 'G']),
    portada: z.string().refine(id => PORTADA_IDS.includes(id), { message: 'Portada desconocida' }),
    paleta: Paleta.nullable().optional(),
    ilustraciones: z.boolean(),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    exigirAccesoPropuestas(context);
    const p = await cargarPropuesta(input.id);
    if (!p.esqueleto) throw new Error('Primero propón y guarda el esqueleto');
    const esq: any = JSON.parse(JSON.stringify(p.esqueleto));
    esq.diseno = { ...(esq.diseno ?? {}), estilo: input.estilo, portada: input.portada, ilustraciones: input.ilustraciones, paleta: input.paleta ?? null };
    await Propuestas.update({ id: input.id, record: { esqueleto: esq } as any });
    return { success: true };
  },
});
