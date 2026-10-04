import { z } from 'zod';
import { createEndpoint, Clients, Deals } from '../../server/compat';
import { exigirAccesoPropuestas } from '../serverUtils/propuestas/acceso';
import { cargarPropuesta } from '../serverUtils/propuestas/datos';
import { proponerPaletas } from '../serverUtils/propuestas/flujo';

// Llamada 4 (spec §8). No guarda nada hasta que la persona elige (savePropuestaDiseno).
export default createEndpoint({
  authenticated: true,
  description: 'Llamada 4: propone tres paletas según el tono o los colores de marca (solo Sergio)',
  inputSchema: z.object({ id: z.string(), tono: z.string().min(1), coloresMarca: z.string().optional() }),
  outputSchema: z.object({
    paletas: z.array(z.object({ nombre: z.string(), tono: z.string(), acento: z.string(), secundario: z.string(), fases: z.array(z.string()) })),
  }),
  execute: async ({ input, context }) => {
    exigirAccesoPropuestas(context);
    const p = await cargarPropuesta(input.id);
    const dealId = Array.isArray(p.deal) ? p.deal[0] : p.deal;
    const deal = dealId ? await Deals.findOne({ id: dealId }) : null;
    const clientId = Array.isArray(p.client) ? p.client[0] : p.client;
    const cliente = clientId ? (await Clients.findOne({ id: clientId }))?.name : (deal as any)?.client;
    const resumen = (p.esqueleto as any)?.resumen_brief ?? '';
    const paletas = await proponerPaletas({
      tono: input.tono, coloresMarca: input.coloresMarca,
      clienteYCategoria: [cliente, deal?.dealName, resumen].filter(Boolean).join(' — '),
    });
    return { paletas };
  },
});
