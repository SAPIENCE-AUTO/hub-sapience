import { z } from 'zod';
import { createEndpoint, pool, ZiteError } from '../../server/compat';
import { exigirAccesoFormularios } from '../serverUtils/formularios/acceso';
import { asegurarColumnas, columnasParaTablero, type Vinculo } from '../serverUtils/formularios/reclutamiento';
import { iniciarCargaDeTraidas } from '../serverUtils/formularios/traidasAlTablero';
import { leerDefinicion } from '../lib/formularios/tipos';

/**
 * Elige el tablero de Reclutamiento al que se pasan las respuestas y le arma
 * de una vez todas las columnas del screener, aunque nadie haya contestado
 * (como al vincular un formulario de Fillout). Volver a elegir el mismo
 * tablero conserva sus columnas y solo agrega las que falten.
 * Si el filtro trae personas de un filtro anterior, las carga al tablero solas
 * (en segundo plano: son cientos) y dice cuántas son; volver a vincular el mismo
 * tablero retoma lo que falte sin repetir ni volver a pasar a quien se quitó.
 */
export default createEndpoint({
  authenticated: true,
  description: 'Vincula un formulario a un tablero de reclutamiento',
  inputSchema: z.object({ formularioId: z.string(), boardId: z.string() }),
  outputSchema: z.object({ ok: z.boolean(), columnasCreadas: z.number(), traidasPorCargar: z.number().optional() }),
  execute: async ({ input, context }) => {
    exigirAccesoFormularios(context);
    const { rows: [b] } = await pool.query(
      `select id, board_name, project_code from boards where id = $1 and board_type = 'recruitment' and deleted_at is null`,
      [input.boardId],
    );
    if (!b) throw new ZiteError({ code: 'NOT_FOUND', message: 'Ese tablero de reclutamiento no existe o se borró.' });
    const { rows: [f] } = await pool.query(`select vinculo, definicion from formularios where id = $1`, [input.formularioId]);
    if (!f) throw new ZiteError({ code: 'NOT_FOUND', message: 'No se encontró el formulario.' });

    const anterior = f.vinculo as Vinculo | null;
    const mismo = anterior && anterior.boardId === b.id ? anterior : null;
    const vinculo: Vinculo = {
      boardId: b.id, boardName: b.board_name ?? '', projectCode: b.project_code ?? '',
      columnas: mismo ? mismo.columnas : {},
      nombres: mismo ? mismo.nombres : {},
    };
    const { creadas } = await asegurarColumnas(input.formularioId, vinculo, columnasParaTablero(leerDefinicion(f.definicion)), leerDefinicion(f.definicion));
    const traidasPorCargar = await iniciarCargaDeTraidas(input.formularioId, b.id as string);
    return { ok: true, columnasCreadas: creadas, traidasPorCargar };
  },
});
