import { pool } from '../../../server/compat';

export interface ClienteResuelto { id: string; name: string }

/**
 * Encuentra el cliente del catálogo por el camino más confiable que haya: su id; si no, el client_id del proyecto; si no, el nombre
 * (el texto libre del proyecto o el que se mande), sin importar mayúsculas ni espacios, igual que el índice único de `clients`.
 */
export async function resolverCliente(a: { clientId?: string; projectCode?: string; client?: string }): Promise<ClienteResuelto | null> {
  if (a.clientId) {
    const { rows } = await pool.query(`select id, name from clients where id = $1`, [a.clientId]);
    return (rows[0] as ClienteResuelto | undefined) ?? null;
  }
  let nombre = (a.client ?? '').trim();
  if (a.projectCode) {
    const { rows } = await pool.query(`select client_id, client from projects where trim(project_code) = trim($1) limit 1`, [a.projectCode]);
    const p = rows[0] as { client_id?: string | null; client?: string | null } | undefined;
    if (p?.client_id) {
      const c = await pool.query(`select id, name from clients where id = $1`, [p.client_id]);
      if (c.rows[0]) return c.rows[0] as ClienteResuelto;
    }
    if (!nombre) nombre = (p?.client ?? '').trim();
  }
  if (!nombre) return null;
  const { rows } = await pool.query(`select id, name from clients where lower(trim(name)) = lower(trim($1)) limit 1`, [nombre]);
  return (rows[0] as ClienteResuelto | undefined) ?? null;
}
