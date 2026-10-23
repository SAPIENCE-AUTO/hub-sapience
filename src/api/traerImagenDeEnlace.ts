import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { exigirAccesoFormularios } from '../serverUtils/formularios/acceso';
import { descargarImagen } from '../serverUtils/formularios/imagenesEnlace';

/**
 * «Pegar enlace de imagen» en el editor de Filtros: el servidor descarga la
 * imagen (revisando que sea de internet, una imagen y que no pese de más) y
 * se la pasa al editor, que la achica y la sube como cualquier imagen.
 */
export default createEndpoint({
  authenticated: true,
  description: 'Descarga una imagen de un enlace para ponerla en un filtro',
  inputSchema: z.object({ url: z.string().min(8).max(2000) }),
  outputSchema: z.object({ base64: z.string(), tipo: z.string(), nombre: z.string() }),
  execute: async ({ input, context }) => {
    exigirAccesoFormularios(context);
    const img = await descargarImagen(input.url);
    return { base64: img.datos.toString('base64'), tipo: img.tipo, nombre: img.nombre };
  },
});
