import { z } from 'zod';
import { createEndpoint, Propuestas } from '../../server/compat';
import { exigirAccesoPropuestas } from '../serverUtils/propuestas/acceso';
import { cargarPropuesta } from '../serverUtils/propuestas/datos';
import { Esqueleto } from '../serverUtils/propuestas/esquemas';

export default createEndpoint({
  authenticated: true,
  description: 'Guarda el esqueleto editado por la persona y lo marca como aprobado (solo Sergio)',
  inputSchema: z.object({ id: z.string(), esqueleto: Esqueleto }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    exigirAccesoPropuestas(context);
    await cargarPropuesta(input.id);
    const nf = input.esqueleto.fases.length;
    for (const pa of input.esqueleto.precio.partidas) if (pa.fase < 0 || pa.fase >= nf) throw new Error('Una partida de precio apunta a una fase que no existe');
    for (const a of input.esqueleto.tiempos.actividades) if (a.fase !== null && (a.fase < 0 || a.fase >= nf)) throw new Error('Una actividad de tiempos apunta a una fase que no existe');
    await Propuestas.update({ id: input.id, record: { esqueleto: input.esqueleto, estado: 'esqueleto_aprobado', metodo: input.esqueleto.metodo } as any });
    return { success: true };
  },
});
