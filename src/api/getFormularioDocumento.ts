import { z } from 'zod';
import { createEndpoint, pool, ZiteError } from '../../server/compat';
import { exigirAccesoFormularios } from '../serverUtils/formularios/acceso';
import { pdfDeDocumento, wordDeDocumento } from '../serverUtils/formularios/documento';
import { documentoDeFiltro, nombreDocumento } from '../lib/formularios/documento';
import { leerDefinicion } from '../lib/formularios/tipos';

/**
 * El screener en Word o PDF para el cliente, tal como está guardado. Cada
 * descarga deja una versión con nombre («Word para el cliente») para saber
 * después qué vio el cliente; si ya hay una igual de esa misma revisión, no
 * se repite.
 */
export default createEndpoint({
  authenticated: true,
  description: 'Arma el Word o el PDF del screener de un filtro',
  inputSchema: z.object({ formularioId: z.string(), formato: z.enum(['word', 'pdf']) }),
  outputSchema: z.object({ nombre: z.string(), base64: z.string() }),
  execute: async ({ input, context }) => {
    exigirAccesoFormularios(context);
    const { rows: [f] } = await pool.query(`select titulo, definicion, revision from formularios where id = $1`, [input.formularioId]);
    if (!f) throw new ZiteError({ code: 'NOT_FOUND', message: 'No se encontró ese filtro.' });

    const bloques = documentoDeFiltro(leerDefinicion(f.definicion), f.titulo);
    const pie = `${f.titulo} · Filtro de reclutamiento`;
    const datos = input.formato === 'word' ? await wordDeDocumento(bloques, pie) : await pdfDeDocumento(bloques, pie);

    const nota = input.formato === 'word' ? 'Word para el cliente' : 'PDF para el cliente';
    await pool.query(
      `insert into formulario_versiones (formulario_id, revision, definicion, nota, created_by)
       select id, revision, definicion, $2, $3 from formularios f
       where id = $1 and not exists (
         select 1 from formulario_versiones v where v.formulario_id = f.id and v.revision = f.revision and v.nota = $2
       )`,
      [input.formularioId, nota, context.user!.id],
    );
    return { nombre: nombreDocumento(f.titulo, input.formato === 'word' ? 'docx' : 'pdf'), base64: datos.toString('base64') };
  },
});
