// Correcciones de valor que Zite necesita al cargarse en Postgres porque usa
// convenciones que el esquema relacional no modela igual — no son bugs del
// export, son diferencias deliberadas de modelo. Un solo lugar para
// load-zite-to-postgres.ts (carga completa) y apply-zite-delta.ts
// (incremental), igual que zite-exclusions.ts, para que no se desalineen.
export interface ZiteNumericSentinel {
  table: string; // nombre de tabla tal como aparece en datos-zite/_meta.json
  field: string; // prop camelCase ya resuelto (no el label de Zite)
  precision: number; // el P de numeric(P,S) en schema.sql
  scale: number; // el S de numeric(P,S)
}

export const NUMERIC_OVERFLOW_TO_NULL: ZiteNumericSentinel[] = [
  {
    // Users.maxApprovalAmount: Zite usa 99999999999999 como centinela de
    // "sin límite" — en el modelo correcto eso es null, no un número. La
    // columna es numeric(14,2) (12 dígitos enteros máx.); el centinela tiene
    // 14 y desborda. Se corrigió a mano en la primera carga; esto lo hace
    // reproducible en cualquier recarga desde cero.
    table: 'Users',
    field: 'maxApprovalAmount',
    precision: 14,
    scale: 2,
  },
];

/**
 * Si `value` desbordaría la precisión numeric(P,S) declarada para esta
 * tabla+campo, lo normaliza a null en vez de dejar que Postgres truene el
 * insert entero. Cualquier valor que exceda el límite cuenta, no solo el
 * centinela exacto documentado — así cubre variantes del mismo patrón.
 */
export function normalizeNumericOverflow(tableName: string, field: string, value: unknown): unknown {
  if (typeof value !== 'number' || !Number.isFinite(value)) return value;
  const sentinel = NUMERIC_OVERFLOW_TO_NULL.find((s) => s.table === tableName && s.field === field);
  if (!sentinel) return value;
  const maxIntDigits = sentinel.precision - sentinel.scale;
  const limit = 10 ** maxIntDigits;
  return Math.abs(value) >= limit ? null : value;
}
