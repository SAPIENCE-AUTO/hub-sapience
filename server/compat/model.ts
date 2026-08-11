import type { Pool, PoolClient } from 'pg';
import { SCHEMA, type TableDef, type FieldDef } from './schema-map';
import { buildWhere } from './filters';

/**
 * Reimplementa la superficie del SDK de Zite que usan los 207 endpoints.
 *
 * Métodos usados en el código (con su frecuencia real):
 *   findAll (365) · update (160) · findOne (117) · create (87) · bulkCreate (49) · delete (49)
 *
 * Regla de fidelidad que gobierna todo este archivo:
 * los linked_record se leen y escriben como ARREGLOS DE IDs, porque así los
 * trata Zite y así los espera el código existente. La traducción a FK y a
 * tablas puente vive aquí y en ningún otro lugar.
 */

export interface FindAllArgs {
  filters?: Record<string, unknown>;
  limit?: number;
  offset?: number;
  fields?: string[];
  sorts?: { field: string; direction?: 'asc' | 'desc' }[];
}

export interface FindAllResult<T> { records: T[]; hasMore: boolean }

/**
 * Quien ejecuta la consulta: el pool, o un cliente concreto cuando estamos
 * dentro de una transacción. Es la pieza que faltaba: sin esto, `bulkCreate`
 * abría BEGIN en un cliente y hacía los inserts por otras conexiones del pool
 * — la transacción no servía de nada y el pool se agotaba en abrazo mortal.
 */
export type Executor = Pick<Pool | PoolClient, 'query'>;

/** Tope de seguridad: Zite no paginaba y hay 190 findAll sin filtro. */
const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 10_000;

export function createModel<T extends Record<string, any> = Record<string, any>>(
  pool: Pool,
  modelName: keyof typeof SCHEMA,
) {
  const def: TableDef = SCHEMA[modelName];
  if (!def) throw new Error(`Modelo desconocido: ${String(modelName)}`);

  const scalarFields = Object.entries(def.fields).filter(([, f]) => f.kind !== 'linkMany');
  const manyFields = Object.entries(def.fields).filter(([, f]) => f.kind === 'linkMany');

  function selectList(fields?: string[]): { sql: string; props: string[] } {
    const wanted = fields?.length
      ? scalarFields.filter(([p]) => fields.includes(p) || p === 'id')
      : scalarFields;
    const props = wanted.map(([p]) => p);
    const sql = wanted.map(([p, f]) => `t."${f.col}" as "${p}"`).join(', ');
    return { sql: sql || 't.id as "id"', props };
  }

  /** Hidrata los linkMany como arreglos de IDs, en una sola consulta por campo. */
  async function hydrateMany(rows: any[], fields?: string[], exec: Executor = pool): Promise<void> {
    if (!rows.length) return;
    const targets = manyFields.filter(([p]) => !fields?.length || fields.includes(p));
    if (!targets.length) return;
    const ids = rows.map((r) => r.id);
    for (const [prop, f] of targets) {
      const { rows: links } = await exec.query(
        `select "${f.selfCol}" as self, "${f.otherCol}" as other from "${f.join}" where "${f.selfCol}" = any($1)`,
        [ids],
      );
      const grouped = new Map<string, string[]>();
      for (const l of links) {
        const arr = grouped.get(l.self) ?? [];
        arr.push(l.other);
        grouped.set(l.self, arr);
      }
      for (const r of rows) r[prop] = grouped.get(r.id) ?? [];
    }
  }

  /** Los link N-1 se exponen como arreglo de 0 o 1 elemento, como en Zite. */
  function wrapLinks(rows: any[]): any[] {
    const links = scalarFields.filter(([, f]) => f.kind === 'link');
    if (!links.length) return rows;
    for (const r of rows) {
      for (const [prop] of links) {
        if (prop in r) r[prop] = r[prop] == null ? [] : [r[prop]];
      }
    }
    return rows;
  }

  /**
   * Zite nunca devolvía `null` para un campo vacío — lo omitía (equivale a
   * `undefined`). Los 207 endpoints están escritos contra ese contrato: leen
   * `record.campo` directo, sin `?? undefined`, y su `outputSchema` declara
   * esos campos `.optional()` (no `.nullable()`). Postgres sí manda `null` en
   * columnas vacías, así que sin esto cualquier campo vacío rompe la
   * validación de salida — invisible mientras esa validación solo advertía,
   * pero revienta en cuanto se activa STRICT_OUTPUT (apareció primero en
   * `getPayments`/`sourceBank`). Corre después de `wrapLinks`: los link ya
   * son arreglo (nunca null) para entonces, así que no los toca.
   */
  function stripNullScalars(rows: any[]): void {
    for (const r of rows) {
      for (const key in r) {
        if (r[key] === null) r[key] = undefined;
      }
    }
  }

  /** Al escribir, acepta string o string[] y guarda un solo id en la FK. */
  function unwrapRecord(record: Record<string, any>): { cols: string[]; vals: unknown[]; many: [FieldDef, string[]][] } {
    const cols: string[] = [];
    const vals: unknown[] = [];
    const many: [FieldDef, string[]][] = [];
    for (const [prop, value] of Object.entries(record)) {
      const f = def.fields[prop];
      if (!f || prop === 'id') continue;
      if (f.kind === 'linkMany') {
        many.push([f, toIdArray(value)]);
        continue;
      }
      cols.push(f.col);
      if (f.kind === 'link') {
        const ids = toIdArray(value);
        vals.push(ids[0] ?? null);
      } else if (f.kind === 'json') {
        vals.push(value == null ? null : JSON.stringify(value));
      } else if ((f.kind === 'date' || f.kind === 'datetime' || f.kind === 'number') && value === '') {
        // Un <input type="date"|"number"> sin llenar manda "" en vez de omitir
        // el campo — Zite lo toleraba, pero Postgres rechaza "" para date/
        // numeric con "invalid input syntax" (se vio en vivo con saveProject).
        // Solo estos tres kinds: en 'text' un "" es un valor legítimo (una
        // nota vacía a propósito), no "sin dato" como en date/number.
        vals.push(null);
      } else {
        vals.push(value === undefined ? null : value);
      }
    }
    return { cols, vals, many };
  }

  async function syncMany(id: string, many: [FieldDef, string[]][], exec: Executor = pool): Promise<void> {
    for (const [f, ids] of many) {
      await exec.query(`delete from "${f.join}" where "${f.selfCol}" = $1`, [id]);
      if (!ids.length) continue;
      await exec.query(
        `insert into "${f.join}" ("${f.selfCol}", "${f.otherCol}") select $1, x from unnest($2::uuid[]) x on conflict do nothing`,
        [id, ids],
      );
    }
  }

  return {
    modelName: String(modelName),
    table: def.table,

    async findAll(args: FindAllArgs = {}, exec: Executor = pool): Promise<FindAllResult<T>> {
      const { sql: sel } = selectList(args.fields);
      const where = buildWhere(def, args.filters as any, 1);
      const limit = Math.min(args.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
      let sql = `select ${sel} from "${def.table}" t ${where.sql}`;
      if (args.sorts?.length) {
        const parts = args.sorts
          .map((s) => {
            const f = def.fields[s.field];
            return f ? `t."${f.col}" ${s.direction === 'desc' ? 'desc' : 'asc'}` : null;
          })
          .filter(Boolean);
        if (parts.length) sql += ` order by ${parts.join(', ')}`;
      }
      // Se pide un renglón de más ("peek") para saber si hay más páginas sin
      // un count() aparte — se recorta antes de devolver. Sin esto, `hasMore`
      // salía siempre undefined y los ~24 endpoints que paginan con
      // `while (hasMore) ...` se detenían silenciosamente en la primera página.
      sql += ` limit ${limit + 1}`;
      if (args.offset) sql += ` offset ${Math.max(0, args.offset)}`;
      const { rows } = await exec.query(sql, where.params);
      const hasMore = rows.length > limit;
      if (hasMore) rows.length = limit;
      wrapLinks(rows);
      stripNullScalars(rows);
      await hydrateMany(rows, args.fields, exec);
      return { records: rows as T[], hasMore };
    },

    /**
     * Zite acepta dos formas: `findOne({ id })` con filtros planos, y
     * `findOne({ filters: {...} })`. Las 117 llamadas usan ambas.
     */
    async findOne(args: Record<string, any> = {}, exec: Executor = pool): Promise<T | null> {
      const { fields, filters, ...flat } = args;
      const merged = { ...(filters ?? {}), ...flat };
      const res = await this.findAll({ filters: merged, fields, limit: 1 }, exec);
      return res.records[0] ?? null;
    },

    async create({ record }: { record: Record<string, any> }, exec: Executor = pool): Promise<T> {
      const { cols, vals, many } = unwrapRecord(record);
      const ph = cols.map((_, i) => `$${i + 1}`).join(', ');
      const quoted = cols.map((c) => `"${c}"`).join(', ');
      let sql: string;
      if (def.conflictTarget && cols.length) {
        // Upsert real por índice único parcial (ver CONFLICT_TARGETS en
        // generate.py): sin esto, reescribir la misma posición viva (ej. una
        // celda ya importada) truena con "duplicate key value violates unique
        // constraint" en vez de actualizarla. Re-asigna TODAS las columnas
        // (incluidas las del conflicto, a su propio valor) para que el SET
        // nunca quede vacío y `returning id` siempre traiga una fila.
        const conflictCols = def.conflictTarget.cols.map((c) => `"${c}"`).join(', ');
        const wherePart = def.conflictTarget.where ? ` where ${def.conflictTarget.where}` : '';
        const updateSet = cols.map((c) => `"${c}" = excluded."${c}"`).join(', ');
        sql = `insert into "${def.table}" (${quoted}) values (${ph}) on conflict (${conflictCols})${wherePart} do update set ${updateSet} returning id`;
      } else {
        sql = cols.length
          ? `insert into "${def.table}" (${quoted}) values (${ph}) returning id`
          : `insert into "${def.table}" default values returning id`;
      }
      const { rows } = await exec.query(sql, vals);
      const id = rows[0].id;
      if (many.length) await syncMany(id, many, exec);
      return (await this.findOne({ id }, exec)) as T;
    },

    /**
     * `matchOn`: upsert por igualdad exacta en esos campos (no por constraint de
     * BD — Zite tampoco lo requería). Por cada registro, busca uno existente con
     * esos valores dentro de la MISMA transacción/cliente (así un duplicado
     * dentro del propio lote se resuelve contra la fila recién insertada, no
     * crea dos) y actualiza en vez de insertar. Sin `matchOn`, comportamiento
     * idéntico al de antes: insert siempre.
     */
    async bulkCreate({ records, matchOn }: { records: Record<string, any>[]; matchOn?: string[] }): Promise<FindAllResult<T>> {
      if (!records.length) return { records: [] };
      const out: T[] = [];
      // Todo el lote va por el MISMO cliente: es lo que hace que la transacción
      // sea real y que el pool no se agote esperándose a sí mismo.
      const client = await pool.connect();
      try {
        await client.query('begin');
        for (const r of records) {
          let existing: T | null = null;
          if (matchOn?.length) {
            const filters: Record<string, unknown> = {};
            for (const key of matchOn) filters[key] = r[key];
            if (Object.values(filters).every((v) => v !== undefined)) {
              existing = await this.findOne({ filters }, client);
            }
          }
          out.push(existing ? ((await this.update({ id: (existing as any).id, record: r }, client)) as T) : await this.create({ record: r }, client));
        }
        await client.query('commit');
      } catch (e) {
        try { await client.query('rollback'); } catch { /* la conexión ya murió */ }
        throw e;
      } finally {
        client.release();
      }
      return { records: out };
    },

    async update({ id, record }: { id: string; record: Record<string, any> }, exec: Executor = pool): Promise<T | null> {
      const { cols, vals, many } = unwrapRecord(record);
      if (cols.length) {
        const sets = cols.map((c, i) => `"${c}" = $${i + 2}`).join(', ');
        await exec.query(`update "${def.table}" set ${sets} where id = $1`, [id, ...vals]);
      }
      if (many.length) await syncMany(id, many, exec);
      return this.findOne({ id }, exec);
    },

    async delete({ id }: { id: string }, exec: Executor = pool): Promise<{ id: string }> {
      await exec.query(`delete from "${def.table}" where id = $1`, [id]);
      return { id };
    },

    async count(args: { filters?: Record<string, unknown> } = {}, exec: Executor = pool): Promise<number> {
      const where = buildWhere(def, args.filters as any, 1);
      const { rows } = await exec.query(`select count(*)::int as n from "${def.table}" t ${where.sql}`, where.params);
      return rows[0].n;
    },
  };
}

function toIdArray(v: unknown): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.filter(Boolean).map(String);
  return [String(v)];
}
