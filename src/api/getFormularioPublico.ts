import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';
import { definicionPublica } from '../lib/formularios/motor';
import { conPasosDelHub } from '../lib/formularios/pasos';
import { leerDefinicion } from '../lib/formularios/tipos';

/**
 * Público — la página /f/:codigo pide el formulario. Un borrador responde
 * «no encontrado» (no se adelanta nada); uno cerrado avisa que ya no recibe
 * respuestas. La definición va sin lo interno (definicionPublica) y con el aviso
 * de privacidad primero y el acuerdo de confidencialidad al final (conPasosDelHub),
 * también en los filtros que ya existían.
 */
export default createEndpoint({
  authenticated: false,
  description: 'Formulario público para que un participante lo conteste',
  inputSchema: z.object({ codigo: z.string() }),
  outputSchema: z.object({
    found: z.boolean(),
    estado: z.string().optional(),
    definicion: z.any().optional(),
  }),
  execute: async ({ input }) => {
    const { rows: [f] } = await pool.query(`select estado, definicion from formularios where codigo = $1`, [input.codigo]);
    if (!f || f.estado === 'borrador') return { found: false };
    if (f.estado === 'cerrado') return { found: true, estado: 'cerrado' };
    return { found: true, estado: f.estado, definicion: definicionPublica(conPasosDelHub(leerDefinicion(f.definicion))) };
  },
});
