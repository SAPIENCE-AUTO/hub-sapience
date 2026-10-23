import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { buscarCodigoPostal } from '../serverUtils/formularios/codigosPostales';

/**
 * Público — la dirección del formulario del participante: con el código
 * postal regresa el estado, el municipio y las colonias (catálogo oficial,
 * información pública).
 */
export default createEndpoint({
  authenticated: false,
  description: 'Estado, municipio y colonias de un código postal, para la dirección del formulario del participante',
  inputSchema: z.object({ pais: z.string().length(2), cp: z.string().regex(/^\d{4,6}$/) }),
  outputSchema: z.object({
    encontrado: z.boolean(),
    catalogo: z.boolean(),
    estado: z.string().optional(),
    municipio: z.string().optional(),
    colonias: z.array(z.string()),
  }),
  execute: async ({ input }) => buscarCodigoPostal(input.pais, input.cp),
});
