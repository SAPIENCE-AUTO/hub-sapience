import { z } from 'zod';
import { createEndpoint, Boards, pool, ZiteError } from '../../server/compat';
import { exigirAccesoFormularios } from '../serverUtils/formularios/acceso';
import { asegurarColumnas, columnasParaTablero, type Vinculo } from '../serverUtils/formularios/reclutamiento';
import { leerDefinicion } from '../lib/formularios/tipos';

/**
 * Crea un tablero de Reclutamiento en el proyecto del formulario y lo deja
 * vinculado. Igual que «+ Tablero» en RecruitmentPage.tsx (addBoard →
 * saveBoard con forceCreate): nombre, proyecto, orden al final y tipo
 * recruitment. Nace con todas las columnas del screener.
 * Si el nombre ya existe en el proyecto se le agrega «(2)»: dos tableros vivos
 * con el mismo nombre confunden a la resolución por nombre (ver CLAUDE.md §6).
 */
export default createEndpoint({
  authenticated: true,
  description: 'Crea un tablero de reclutamiento nuevo y le vincula el formulario',
  inputSchema: z.object({ formularioId: z.string(), nombre: z.string().min(1) }),
  outputSchema: z.object({ id: z.string(), nombre: z.string(), columnasCreadas: z.number() }),
  execute: async ({ input, context }) => {
    exigirAccesoFormularios(context);
    const { rows: [f] } = await pool.query(
      `select f.id, f.definicion, p.project_code from formularios f left join projects p on p.id = f.proyecto_id where f.id = $1`,
      [input.formularioId],
    );
    if (!f) throw new ZiteError({ code: 'NOT_FOUND', message: 'No se encontró el formulario.' });
    if (!f.project_code) throw new ZiteError({ code: 'BAD_REQUEST', message: 'El formulario no está en un proyecto.' });

    const { rows: vivos } = await pool.query(
      `select board_name from boards where project_code = $1 and board_type = 'recruitment' and deleted_at is null`,
      [f.project_code],
    );
    const usados = new Set(vivos.map((b) => String(b.board_name ?? '').toLowerCase()));
    const base = input.nombre.trim();
    let nombre = base;
    for (let n = 2; usados.has(nombre.toLowerCase()); n++) nombre = `${base} (${n})`;

    const tablero = await Boards.create({
      record: { boardName: nombre, projectCode: f.project_code, boardOrder: vivos.length, boardType: 'recruitment' },
    });
    const vinculo: Vinculo = { boardId: tablero.id, boardName: nombre, projectCode: f.project_code, columnas: {} };
    const { creadas } = await asegurarColumnas(f.id, vinculo, columnasParaTablero(leerDefinicion(f.definicion)));
    return { id: tablero.id, nombre, columnasCreadas: creadas };
  },
});
