/**
 * Zite devolvía fechas como strings (date: "YYYY-MM-DD", datetime: ISO 8601 con
 * "Z") y campos `currency`/`number`/`percent` como JS `number` — el contrato
 * contra el que están escritos los 207 endpoints (`.split(...)`, `.toFixed(...)`,
 * comparaciones `>`/`<`, etc. directo sobre el valor). Tanto `pg` (Postgres real)
 * como `@electric-sql/pglite` (el de server/test.ts) devuelven por default `Date`
 * de JS para date/timestamptz y `string` para `numeric` (para no perder precisión
 * arbitraria) — ninguno de los dos coincide con lo que el código espera.
 *
 * El de numeric es el más traicionero: al ser `string`, pasa silencioso por
 * cualquier código que solo lo interpola o lo re-envía tal cual, y solo truena
 * (o, sin STRICT_OUTPUT, solo genera un warning) cuando algo hace aritmética o
 * la validación de salida lo nota — apareció primero en `getPayments`/`amount`.
 *
 * Una sola fuente para los dos: db.ts los registra vía pg.types.setTypeParser,
 * test.ts los pasa a PGlite.create({ parsers }) — misma función, dos mecanismos
 * de registro. Si esto se rompe, se rompe para los dos a la vez.
 */
export const DATE_OID = 1082;
export const TIMESTAMPTZ_OID = 1184;
export const NUMERIC_OID = 1700;

export const parseDate = (v: string): string => v; // ya sale como "YYYY-MM-DD"
export const parseTimestamptz = (v: string): string => new Date(v).toISOString();
export const parseNumeric = (v: string): number => Number(v);
