import type { FieldDef, TableDef } from './schema-map';

/**
 * Traduce los filtros del SDK de Zite a SQL.
 *
 * Operadores que realmente usan los 207 endpoints (contados en el código):
 *   contains (29) · in (24) · not (4) · gt (3) · gte (2) · lte (1)
 * Más igualdad implícita cuando el valor es escalar.
 *
 * El caso delicado son los linked_record. En Zite se guardan como arreglos
 * de IDs, así que el código hace `filters: { deal: { contains: dealId } }`
 * incluso cuando la relación es 1-N. Aquí eso se traduce a igualdad sobre
 * la FK, o a un EXISTS sobre la tabla puente si es N-N.
 */

export interface SqlFragment {
  sql: string;
  params: unknown[];
}

type FilterValue =
  | string | number | boolean | null
  | { contains?: unknown; in?: unknown[]; not?: unknown; gt?: unknown; gte?: unknown; lt?: unknown; lte?: unknown; isEmpty?: boolean; isNotEmpty?: boolean };

export class FilterError extends Error {}

export function buildWhere(
  def: TableDef,
  filters: Record<string, FilterValue> | undefined,
  startIndex = 1,
): SqlFragment {
  if (!filters || Object.keys(filters).length === 0) return { sql: '', params: [] };

  const clauses: string[] = [];
  const params: unknown[] = [];
  let i = startIndex;
  const ph = () => `$${i++}`;

  for (const [prop, raw] of Object.entries(filters)) {
    if (raw === undefined) continue;
    const field = def.fields[prop];
    if (!field) {
      // Un filtro sobre una propiedad inexistente es un bug silencioso en Zite:
      // devolvía todo. Aquí se hace ruidoso a propósito.
      throw new FilterError(
        `Filtro sobre campo desconocido "${prop}" en tabla ${def.table}. ` +
        `Campos válidos: ${Object.keys(def.fields).join(', ')}`,
      );
    }

    if (field.kind === 'linkMany') {
      clauses.push(...linkManyClause(field, raw, ph, params));
      continue;
    }

    const col = `"${field.col}"`;

    if (raw === null) { clauses.push(`${col} is null`); continue; }

    if (typeof raw !== 'object') {
      clauses.push(`${col} = ${ph()}`);
      params.push(coerce(field, raw));
      continue;
    }

    const op = raw as Record<string, unknown>;

    if ('isEmpty' in op) { clauses.push(op.isEmpty ? `${col} is null` : `${col} is not null`); continue; }
    if ('isNotEmpty' in op) { clauses.push(op.isNotEmpty ? `${col} is not null` : `${col} is null`); continue; }

    if ('contains' in op) {
      // Sobre un link, `contains` significa pertenencia al arreglo de IDs → igualdad de FK.
      if (field.kind === 'link') {
        clauses.push(`${col} = ${ph()}`);
        params.push(op.contains);
      } else if (field.kind === 'array') {
        clauses.push(`${col} @> array[${ph()}]::text[]`);
        params.push(op.contains);
      } else {
        clauses.push(`${col} ilike ${ph()}`);
        params.push(`%${escapeLike(String(op.contains))}%`);
      }
    }

    if ('in' in op) {
      const list = (op.in as unknown[]) ?? [];
      if (list.length === 0) { clauses.push('false'); continue; }
      clauses.push(`${col} = any(${ph()})`);
      params.push(list.map((v) => coerce(field, v)));
    }

    if ('not' in op) {
      if (op.not === null) clauses.push(`${col} is not null`);
      else { clauses.push(`(${col} is null or ${col} <> ${ph()})`); params.push(coerce(field, op.not)); }
    }

    for (const [k, sqlOp] of [['gt', '>'], ['gte', '>='], ['lt', '<'], ['lte', '<=']] as const) {
      if (k in op) { clauses.push(`${col} ${sqlOp} ${ph()}`); params.push(coerce(field, op[k])); }
    }
  }

  return { sql: clauses.length ? `where ${clauses.join(' and ')}` : '', params };
}

function linkManyClause(
  field: FieldDef,
  raw: FilterValue,
  ph: () => string,
  params: unknown[],
): string[] {
  const value = raw && typeof raw === 'object' && 'contains' in raw ? (raw as { contains: unknown }).contains : raw;
  const p = ph();
  params.push(value);
  return [`exists (select 1 from "${field.join}" j where j."${field.selfCol}" = t.id and j."${field.otherCol}" = ${p})`];
}

/** Zite era laxo con los tipos; Postgres no. Se normaliza en la frontera. */
function coerce(field: FieldDef, v: unknown): unknown {
  if (v === null || v === undefined) return null;
  switch (field.kind) {
    case 'number': return typeof v === 'string' ? Number(v) : v;
    case 'boolean': return typeof v === 'string' ? v === 'true' : Boolean(v);
    case 'date':
    case 'datetime': return v instanceof Date ? v.toISOString() : v;
    default: return v;
  }
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}
