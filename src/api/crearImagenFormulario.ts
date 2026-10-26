import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { exigirAccesoFormularios } from '../serverUtils/formularios/acceso';
import { crearImagen } from '../serverUtils/formularios/imagenIA';
import { conRegistro } from '../serverUtils/formularios/uso';

/**
 * La imagen de una opción de un filtro, hecha con IA a partir de una
 * descripción breve. Devuelve la imagen (base64): el editor la achica y la
 * sube como cualquier otra. Cuenta para el tope de uso de la IA.
 */
export default createEndpoint({
  authenticated: true,
  description: 'Crea con IA la imagen de una opción de un filtro',
  inputSchema: z.object({ pedido: z.string().trim().min(2).max(500), formularioId: z.string().optional() }),
  outputSchema: z.object({ base64: z.string(), tipo: z.string(), nombre: z.string() }),
  execute: async ({ input, context }) => {
    exigirAccesoFormularios(context);
    const r = await conRegistro(context.user!.email, input.formularioId ?? null, 'imagen', (onGasto) => crearImagen(input.pedido, onGasto));
    const nombre = `${input.pedido.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'imagen'}.png`;
    return { ...r, nombre };
  },
});
