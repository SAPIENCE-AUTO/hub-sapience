import type { Pool } from 'pg';
import { ZiteError } from '../../server/compat';

/**
 * projects.project_code no tiene FK ni historial de únicos en Zite — Postgres
 * sí lo exige ahora (índice único parcial case-insensitive, ver generate.py).
 * Sin este chequeo previo, un código repetido revienta con un error crudo de
 * violación de índice en vez de un mensaje que la UI pueda mostrar. Se
 * encontraron 4 pares de proyectos duplicados creados así, por 3 rutas
 * distintas (saveProject.ts en creación y en renombrado, approveDeal.ts).
 */
export async function assertProjectCodeAvailable(pool: Pool, projectCode: string, excludeId?: string): Promise<void> {
  const code = projectCode?.trim();
  if (!code) return;
  const { rows } = await pool.query(
    `select id from projects where lower(trim(project_code)) = lower($1) and ($2::uuid is null or id <> $2::uuid) limit 1`,
    [code, excludeId ?? null],
  );
  if (rows.length) {
    throw new ZiteError({
      code: 'BAD_REQUEST',
      message: `Ya existe un proyecto con el código "${projectCode}". Usa un nombre distinto o edita el proyecto existente.`,
    });
  }
}
