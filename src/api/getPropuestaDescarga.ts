import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { exigirAccesoPropuestas } from '../serverUtils/propuestas/acceso';
import { cargarPropuesta } from '../serverUtils/propuestas/datos';
import { urlFirmada, nombreSeguro } from '../serverUtils/propuestas/storage';

export default createEndpoint({
  authenticated: true,
  description: 'URL firmada (1 h) para descargar el PowerPoint de una versión (solo Sergio)',
  inputSchema: z.object({ id: z.string(), version: z.number().int().positive().optional() }),
  outputSchema: z.object({ url: z.string(), version: z.number(), nombre: z.string() }),
  execute: async ({ input, context }) => {
    exigirAccesoPropuestas(context);
    const p = await cargarPropuesta(input.id);
    if (!p.pptxPath) throw new Error('Esta propuesta todavía no tiene un PowerPoint construido');
    const version = input.version ?? Number(p.version ?? 1);
    const nombre = `${nombreSeguro(p.titulo ?? 'Propuesta')}_v${version}.pptx`;
    return { url: await urlFirmada(`${input.id}/pptx/v${version}.pptx`, 3600, nombre), version, nombre };
  },
});
