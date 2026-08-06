/**
 * Zite devolvía fechas como strings (date: "YYYY-MM-DD", datetime: ISO 8601 con
 * "Z"), y los 207 endpoints están escritos contra ese contrato — llaman
 * `.split(...)`, `.slice(...)`, etc. directo sobre el valor. Tanto `pg` (Postgres
 * real) como `@electric-sql/pglite` (el de server/test.ts) parsean esas columnas
 * a `Date` de JS por default, que no tiene esos métodos.
 *
 * Una sola fuente para los dos: db.ts los registra vía pg.types.setTypeParser,
 * test.ts los pasa a PGlite.create({ parsers }) — misma función, dos mecanismos
 * de registro. Si esto se rompe, se rompe para los dos a la vez.
 */
export const DATE_OID = 1082;
export const TIMESTAMPTZ_OID = 1184;

export const parseDate = (v: string): string => v; // ya sale como "YYYY-MM-DD"
export const parseTimestamptz = (v: string): string => new Date(v).toISOString();
