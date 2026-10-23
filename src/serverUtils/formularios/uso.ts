import { pool, ZiteError } from '../../../server/compat';
import type { Gasto } from './claude';

// Tope de uso de la IA de Filtros por persona y por hora, con el registro de cada llamada
// (formulario_ia_uso). La llamada se registra ANTES de hacerla, así cuentan también las que
// van en paralelo; al terminar se anota cuánto gastó. Un filtro completo son unas 12 llamadas.
export const LIMITE_POR_HORA = Number(process.env.FORMULARIOS_IA_LIMITE_HORA || 60);

export type AccionIA = 'estructura' | 'seccion' | 'logica' | 'pregunta' | 'comentario' | 'nombres';

/** Lo que cuenta para el tope: una llamada que falló sin llegar a la IA (sin saldo, sin conexión) no gastó nada y no cuenta. */
const CUENTA = '(ok is distinct from false or modelo is not null)';

/** Reserva una llamada o dice cuánto falta para poder volver a usar la IA. Devuelve el id del registro. */
export async function reservarUsoIA(email: string, formularioId: string, accion: AccionIA): Promise<string> {
  const correo = email.toLowerCase();
  const { rows: [r] } = await pool.query(
    `select count(*)::int as n, min(created_at) as primera from formulario_ia_uso
     where usuario_email = $1 and created_at > now() - interval '1 hour' and ${CUENTA}`,
    [correo],
  );
  if (r.n >= LIMITE_POR_HORA) {
    const minutos = Math.max(1, Math.ceil((new Date(r.primera).getTime() + 3_600_000 - Date.now()) / 60_000));
    throw new ZiteError({
      code: 'FORBIDDEN',
      message: `Llegaste al tope de uso de la IA (${LIMITE_POR_HORA} por hora). Se libera otra en ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}.`,
    });
  }
  const { rows: [u] } = await pool.query(
    `insert into formulario_ia_uso (formulario_id, usuario_email, accion) values ($1, $2, $3) returning id`,
    [formularioId, correo, accion],
  );
  return u.id as string;
}

/** Anota lo que gastó (se suma si hubo reintento) y si salió bien. */
export async function anotarGasto(id: string, g: Gasto): Promise<void> {
  await pool.query(
    `update formulario_ia_uso set modelo = $2,
       tokens_entrada = coalesce(tokens_entrada, 0) + $3, tokens_cache_leidos = coalesce(tokens_cache_leidos, 0) + $4,
       tokens_cache_escritos = coalesce(tokens_cache_escritos, 0) + $5, tokens_salida = coalesce(tokens_salida, 0) + $6
     where id = $1`,
    [id, g.modelo, g.entrada, g.cacheLeidos, g.cacheEscritos, g.salida],
  ).catch((e) => console.error('[filtros] no se pudo anotar el gasto de IA', e));
}

export async function cerrarUso(id: string, ok: boolean): Promise<void> {
  await pool.query(`update formulario_ia_uso set ok = $2 where id = $1`, [id, ok]).catch(() => {});
}

/** Corre una llamada a la IA con su registro: reserva, anota lo gastado y si salió bien. */
export async function conRegistro<T>(email: string, formularioId: string, accion: AccionIA, trabajo: (onGasto: (g: Gasto) => void) => Promise<T>): Promise<T> {
  const id = await reservarUsoIA(email, formularioId, accion);
  const anotaciones: Promise<void>[] = [];
  try {
    const r = await trabajo((g) => { anotaciones.push(anotarGasto(id, g)); });
    await Promise.all(anotaciones);
    await cerrarUso(id, true);
    return r;
  } catch (err) {
    await Promise.all(anotaciones);
    await cerrarUso(id, false);
    throw err;
  }
}

/** Cuántas llamadas lleva esta hora (para mostrarlo junto a los botones de IA). */
export async function usoDeLaHora(email: string): Promise<number> {
  const { rows: [r] } = await pool.query(
    `select count(*)::int as n from formulario_ia_uso where usuario_email = $1 and created_at > now() - interval '1 hour' and ${CUENTA}`,
    [email.toLowerCase()],
  );
  return r.n as number;
}
