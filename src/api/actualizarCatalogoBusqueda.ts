import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { exigirAccesoBuscador } from '../serverUtils/busqueda/acceso';
import { traducirFaltaTablasBusqueda } from '../serverUtils/busqueda/almacen';
import { actualizarCatalogo, type ResumenCatalogo } from '../serverUtils/busqueda/catalogo';

// Leer los tableros toma unos minutos la primera vez (después solo lee los que cambiaron): si piden actualizar dos veces a la vez, la segunda se cuelga de la primera en vez de repetir el trabajo
// (y no recibe el avance, solo el resultado).
let enCurso: Promise<ResumenCatalogo> | null = null;

/** Lee los tableros nuevos o que cambiaron y pone al día el catálogo del buscador de gente. Solo lee los tableros; solo escribe las tablas del buscador. Transmite el avance. */
export default createEndpoint({
  authenticated: true,
  streaming: true,
  description: 'Actualiza el catálogo del buscador de gente leyendo los tableros nuevos o cambiados',
  inputSchema: z.object({ forzar: z.boolean().optional() }),
  outputSchema: z.object({
    tableros: z.number(),
    leidos: z.number(),
    sinCambios: z.number(),
    quitados: z.number(),
    fallidos: z.array(z.object({ tablero: z.string(), error: z.string() })),
    milisegundos: z.number(),
  }),
  execute: async ({ input, context, stream }) => {
    exigirAccesoBuscador(context);
    if (!enCurso) {
      enCurso = (async () => {
        try {
          stream?.write({ paso: 'Buscando qué tableros cambiaron…', hechos: 0, total: 0 });
          return await actualizarCatalogo({
            forzar: input.forzar,
            alAvanzar: (hechos, total, tablero) => stream?.write({ paso: `Leyendo «${tablero}»…`, hechos, total }),
          });
        } catch (err) {
          return traducirFaltaTablasBusqueda(err);
        } finally {
          enCurso = null;
        }
      })();
    }
    return enCurso;
  },
});
