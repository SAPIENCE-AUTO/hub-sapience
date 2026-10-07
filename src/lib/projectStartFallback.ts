import { pool } from '../../server/compat';

/**
 * Fecha de respaldo para los proyectos SIN `start_date` (oct 2026).
 *
 * Los íconos de duplicados miden «reciente» (< 6 meses) contra la fecha de inicio del proyecto
 * donde participó la persona. Un proyecto sin fecha se trataba como «reciente» para siempre, lo
 * que dejaba como no elegible a gente que participó hace meses (había 36 proyectos sin fecha).
 * Ahora, si falta la fecha, se usa la última actividad real del proyecto: la fecha de la última
 * fila que cuenta como participación (ver participoEnProyecto en duplicateIdentity.ts) y, si no hay ninguna, la de
 * creación del proyecto. Es un respaldo — la fecha real de inicio, cuando existe, siempre manda.
 *
 * Devuelve YYYY-MM-DD por projectCode, solo para los proyectos que no tienen start_date.
 */
export async function getInferredStartDates(projectCodes?: string[]): Promise<Map<string, string>> {
  const { rows } = await pool.query<{ project_code: string; fecha: string }>(
    `select p.project_code,
            coalesce(
              (select max(r.created_at)::date::text from recruitment_rows r
                where r.project_code = p.project_code and r.deleted_at is null
                  and (lower(coalesce(r.status, '')) in ('asistió', 'asistio')
                       or (r."group" is not null and trim(r."group") <> ''
                           and lower(coalesce(r.status, '')) in ('', 'pendiente', 'confirmado')))),
              p.created_at::date::text
            ) as fecha
       from projects p
      where p.start_date is null and p.project_code is not null
        ${projectCodes ? 'and p.project_code = any($1)' : ''}`,
    projectCodes ? [[...new Set(projectCodes)]] : [],
  );
  return new Map(rows.map(r => [r.project_code, r.fecha]));
}
