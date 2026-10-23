import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { exigirAccesoFormularios } from '../serverUtils/formularios/acceso';
import { armarLogica, cargarFiltro } from '../serverUtils/formularios/generar';
import { leerDefinicion } from '../lib/formularios/tipos';

/** Última llamada del generador: quién entra a cada frente, alertas, claves del panel y textos de bienvenida y despedida. */
export default createEndpoint({
  authenticated: true,
  streaming: true,
  description: 'Arma con la IA los frentes, alertas y textos de un filtro ya escrito',
  inputSchema: z.object({ formularioId: z.string(), definicion: z.any() }),
  outputSchema: z.object({ parche: z.any(), supuestos: z.array(z.string()), problemas: z.array(z.string()) }),
  execute: async ({ input, context, stream }) => {
    exigirAccesoFormularios(context);
    const filtro = await cargarFiltro(input.formularioId);
    return armarLogica({ filtro, email: context.user!.email, stream, definicion: leerDefinicion(input.definicion) });
  },
});
