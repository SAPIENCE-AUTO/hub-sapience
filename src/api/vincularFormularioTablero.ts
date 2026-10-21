import { z } from 'zod';
import { createEndpoint, pool, ZiteError } from '../../server/compat';
import { exigirAccesoFormularios } from '../serverUtils/formularios/acceso';
import type { Vinculo } from '../serverUtils/formularios/reclutamiento';

/**
 * Elige el tablero de Reclutamiento al que se pasan las respuestas. Si se
 * vuelve a elegir el mismo tablero, se conserva el mapa de columnas; si se
 * cambia, el nuevo tablero arma sus propias columnas al pasar.
 */
export default createEndpoint({
  authenticated: true,
  description: 'Vincula un formulario a un tablero de reclutamiento',
  inputSchema: z.object({ formularioId: z.string(), boardId: z.string() }),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async ({ input, context }) => {
    exigirAccesoFormularios(context);
    const { rows: [b] } = await pool.query(
      `select id, board_name, project_code from boards where id = $1 and board_type = 'recruitment' and deleted_at is null`,
      [input.boardId],
    );
    if (!b) throw new ZiteError({ code: 'NOT_FOUND', message: 'Ese tablero de reclutamiento no existe o se borró.' });
    const { rows: [f] } = await pool.query(`select vinculo from formularios where id = $1`, [input.formularioId]);
    if (!f) throw new ZiteError({ code: 'NOT_FOUND', message: 'No se encontró el formulario.' });

    const anterior = f.vinculo as Vinculo | null;
    const vinculo: Vinculo = {
      boardId: b.id, boardName: b.board_name ?? '', projectCode: b.project_code ?? '',
      columnas: anterior?.boardId === b.id ? anterior.columnas : {},
    };
    await pool.query(`update formularios set vinculo = $2, updated_at = now() where id = $1`, [input.formularioId, JSON.stringify(vinculo)]);
    return { ok: true };
  },
});
