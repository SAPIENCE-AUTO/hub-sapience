import { z } from 'zod';
import { createEndpoint, ZiteError } from '../../server/compat';
import { getGlobalIdentityData } from '../lib/globalIdentityCache';
import { exigirAccesoIndicadores } from '../serverUtils/indicadores/acceso';
import { MENSAJE_SIN_TABLAS, SalidaSchema, faltaLaTabla, guardarCalculo, leerIndicadores, type Salida } from '../serverUtils/indicadores/almacen';
import { calcularReclutamiento } from '../serverUtils/indicadores/reclutamiento';

// Cargar todas las filas de reclutamiento y agruparlas por persona toma ~15 s: si piden calcular dos veces a la vez, la segunda
// se cuelga de la primera en vez de repetir el trabajo.
let enCurso: Promise<Salida> | null = null;

/** Vuelve a contar los indicadores de Reclutamiento con los datos de ahora y guarda el resultado. Solo lee reclutamiento. */
export default createEndpoint({
  authenticated: true,
  description: 'Calcula de nuevo los indicadores de Reclutamiento (no elegibles, repetidores, duplicados) y guarda el resultado — solo Sergio',
  inputSchema: z.object({}),
  outputSchema: SalidaSchema,
  execute: async ({ context }) => {
    exigirAccesoIndicadores(context);
    const quien = context.user?.email ?? '';
    if (!enCurso) {
      enCurso = (async () => {
        try {
          const datos = calcularReclutamiento(await getGlobalIdentityData({ fresco: true }));
          await guardarCalculo('reclutamiento', datos, quien);
          return await leerIndicadores('reclutamiento');
        } catch (err) {
          if (faltaLaTabla(err)) throw new ZiteError({ code: 'INTERNAL_ERROR', message: MENSAJE_SIN_TABLAS });
          throw err;
        } finally {
          enCurso = null;
        }
      })();
    }
    return enCurso;
  },
});
