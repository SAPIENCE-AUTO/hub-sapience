import { z } from 'zod';
import { createEndpoint, ZiteError } from '../../server/compat';
import { exigirAdministrarPilares } from '../serverUtils/pilares/acceso';
import { actualizarPilar, crearPilar } from '../serverUtils/pilares/servicio';
import { PilarOut, Uuid } from '../serverUtils/pilares/esquemas';

export default createEndpoint({
  authenticated: true,
  description: 'Crea un pilar (sin id: pide el nombre) o cambia el nombre, el color o si está activo (con id); un pilar nunca se borra, se desactiva — restringido a Owner o Socio',
  inputSchema: z.object({
    id: Uuid.optional(),
    nombre: z.string().optional(),
    color: z.string().optional(),
    activo: z.boolean().optional(),
  }),
  outputSchema: z.object({ pilar: PilarOut }),
  execute: async ({ input, context }) => {
    exigirAdministrarPilares(context);
    if (!input.id) {
      if (!input.nombre) throw new ZiteError({ code: 'BAD_REQUEST', message: 'Falta el nombre del pilar' });
      return { pilar: await crearPilar({ nombre: input.nombre, color: input.color }) };
    }
    return { pilar: await actualizarPilar({ id: input.id, nombre: input.nombre, color: input.color, activo: input.activo }) };
  },
});
