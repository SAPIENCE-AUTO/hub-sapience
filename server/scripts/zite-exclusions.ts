// Filas que se excluyen a propósito al cargar o sincronizar desde Zite — no
// son pérdida de datos, son proyectos de prueba que se purgaron de Postgres
// pero siguen vivos en Zite. Un solo lugar para load-zite-to-postgres.ts
// (carga completa) y apply-zite-delta.ts (incremental), así no hay que
// mantener la lista dos veces ni arriesgarse a que se reintroduzcan en un
// cutover si alguna vuelve a tocarse en Zite.
export interface ZiteExclusion {
  table: string; // nombre de tabla tal como aparece en datos-zite/_meta.json
  field: string; // label humano del campo (record.fields[...])
  prefixes: string[]; // prefijos de valor a excluir (comparación por startsWith)
}

export const ZITE_EXCLUSIONS: ZiteExclusion[] = [
  {
    table: 'Cell Values',
    field: 'Board ID',
    // PJT-001: proyecto de pruebas, 310,220 celdas borradas a propósito de
    // Postgres (2,827,491 → 2,517,271). Sigue existiendo en Zite — no debe
    // volver a entrar ni en la carga completa del cutover ni en el sync
    // incremental si alguien llega a tocar algo ahí por error.
    prefixes: ['recruitment-PJT-001-'],
  },
];

export function isExcludedRecord(tableName: string, fields: Record<string, unknown> | undefined): boolean {
  if (!fields) return false;
  for (const ex of ZITE_EXCLUSIONS) {
    if (ex.table !== tableName) continue;
    const value = fields[ex.field];
    if (typeof value === 'string' && ex.prefixes.some((p) => value.startsWith(p))) return true;
  }
  return false;
}
