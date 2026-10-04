import { z } from 'zod';
import { createEndpoint, Propuestas, Clients } from '../../server/compat';
import { exigirAccesoPropuestas } from '../serverUtils/propuestas/acceso';
import { cargarPropuesta, cargarBrief, conLatido } from '../serverUtils/propuestas/datos';
import { proponerEsqueleto } from '../serverUtils/propuestas/flujo';

// Llamada 1 (spec §8). Streaming solo para mostrar avance y mantener viva la
// conexión: Claude tarda minutos.
export default createEndpoint({
  authenticated: true,
  streaming: true,
  description: 'Llamada 1: propone el esqueleto de la propuesta a partir del brief (solo Sergio)',
  inputSchema: z.object({ id: z.string(), respuestas: z.record(z.string(), z.string()).optional() }),
  outputSchema: z.object({ esqueleto: z.any() }),
  execute: async ({ input, context, stream }) => {
    exigirAccesoPropuestas(context);
    const p = await cargarPropuesta(input.id);
    if (!p.briefTexto && !p.briefPath) throw new Error('Sube o pega el brief antes de proponer el esqueleto');
    stream?.write({ paso: 'Leyendo el brief…' });
    const brief = await cargarBrief(p);
    const clientId = Array.isArray(p.client) ? p.client[0] : p.client;
    const cliente = clientId ? (await Clients.findOne({ id: clientId }))?.name : undefined;
    const esqueleto = await conLatido(stream, 'Claude sigue armando el esqueleto…', () =>
      proponerEsqueleto({ brief, notas: p.notas, metodo: p.metodo, respuestas: input.respuestas, cliente: cliente ?? undefined }));
    // Se conserva el diseño que la persona ya hubiera elegido si se vuelve a proponer.
    const previo = (p.esqueleto as any)?.diseno;
    if (previo?.paleta && !esqueleto.diseno.paleta) esqueleto.diseno.paleta = previo.paleta;
    await Propuestas.update({ id: input.id, record: { esqueleto, estado: 'esqueleto', metodo: esqueleto.metodo } as any });
    return { esqueleto };
  },
});
