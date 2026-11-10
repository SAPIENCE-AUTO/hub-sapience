import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';
import { getGlobalIdentityData } from '../lib/globalIdentityCache';
import { exigirAccesoIndicadores } from '../serverUtils/indicadores/acceso';
import { calcularReclutadores, leerNombresReclutador } from '../serverUtils/indicadores/reclutadores';
import {
  SalidaReclutadoresSchema, guardarCalculoReclutadores, leerReclutadores, traducirFaltaTablas, type SalidaReclutadores,
} from '../serverUtils/indicadores/reclutadoresAlmacen';

// Leer el nombre de cada respuesta y agrupar a las personas toma de 1 a 2 minutos: si piden calcular dos veces a la vez, la segunda
// se cuelga de la primera en vez de repetir el trabajo (y no recibe el avance, solo el resultado).
let enCurso: Promise<SalidaReclutadores> | null = null;

/** Vuelve a contar la estadística por reclutador con los datos de ahora y guarda el resultado. Solo lee reclutamiento. Transmite el avance. */
export default createEndpoint({
  authenticated: true,
  streaming: true,
  description: 'Calcula de nuevo la estadística por reclutador (respuestas nuevas y repetidas por cada nombre) y guarda el resultado — solo Sergio',
  inputSchema: z.object({}),
  outputSchema: SalidaReclutadoresSchema,
  execute: async ({ context, stream }) => {
    exigirAccesoIndicadores(context);
    const quien = context.user?.email ?? '';
    if (!enCurso) {
      enCurso = (async () => {
        try {
          stream?.write({ paso: 'Leyendo el nombre que escribió cada participante…', hechos: 0, total: 0 });
          const nombres = await leerNombresReclutador(pool, {
            alAvanzar: (hechos, total) => stream?.write({ paso: 'Leyendo el nombre que escribió cada participante…', hechos, total }),
          });
          stream?.write({ paso: 'Contando respuestas nuevas y repetidas…', hechos: 0, total: 0 });
          const identidades = await getGlobalIdentityData({ fresco: true });
          const datos = calcularReclutadores(identidades, nombres, new Date().toISOString().slice(0, 10));
          await guardarCalculoReclutadores(datos, quien);
          return await leerReclutadores();
        } catch (err) {
          return traducirFaltaTablas(err);
        } finally {
          enCurso = null;
        }
      })();
    }
    return enCurso;
  },
});
