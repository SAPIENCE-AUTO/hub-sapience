// Reporte forense: para cada CHECK constraint de enum y cada columna numeric(p,s)
// en schema.sql, revisa los datos ya exportados en datos-zite/ y lista CADA fila que
// lo viola, con su valor exacto — no solo el conteo. No corre nada contra Postgres;
// solo lee schema.sql + los JSON ya exportados.
//
// Uso: npx tsx --env-file=.env server/scripts/report-violations.ts

import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHEMA, type TableDef } from '../compat/schema-map';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA_DIR = path.join(ROOT, 'datos-zite');

async function exists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

function toCamelProp(label: string): string {
  const words = label
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean);
  return words.map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join('');
}

function unquoteSqlString(s: string): string {
  return s.trim().replace(/^'/, '').replace(/'$/, '').replace(/''/g, "'");
}

interface EnumCheck { kind: 'enum'; table: string; col: string; values: Set<string> }
interface NumericCheck { kind: 'numeric'; table: string; col: string; precision: number; scale: number }
type Check = EnumCheck | NumericCheck;

function parseSchema(sql: string): Check[] {
  const checks: Check[] = [];
  const tableRe = /create table (\w+) \(([\s\S]*?)\n\);/g;
  let m: RegExpExecArray | null;
  while ((m = tableRe.exec(sql))) {
    const table = m[1];
    const block = m[2];

    const checkRe = /constraint \w+_chk check \("?(\w+)"? is null or "?\1"? in \(([^)]+)\)\)/g;
    let cm: RegExpExecArray | null;
    while ((cm = checkRe.exec(block))) {
      const values = new Set(cm[2].split(',').map(unquoteSqlString));
      checks.push({ kind: 'enum', table, col: cm[1], values });
    }

    const numRe = /^\s*(\w+)\s+numeric\((\d+),\s*(\d+)\)/gm;
    let nm: RegExpExecArray | null;
    while ((nm = numRe.exec(block))) {
      checks.push({ kind: 'numeric', table, col: nm[1], precision: Number(nm[2]), scale: Number(nm[3]) });
    }
  }
  return checks;
}

function findModel(table: string): [string, TableDef] | null {
  const entry = Object.entries(SCHEMA as Record<string, TableDef>).find(([, def]) => def.table === table);
  return entry ?? null;
}

async function main() {
  const sql = await readFile(path.join(ROOT, 'schema.sql'), 'utf8');
  const checks = parseSchema(sql);

  let totalViolations = 0;
  const byTable = new Map<string, Check[]>();
  for (const c of checks) {
    if (!byTable.has(c.table)) byTable.set(c.table, []);
    byTable.get(c.table)!.push(c);
  }

  for (const [table, tableChecks] of byTable) {
    const modelEntry = findModel(table);
    if (!modelEntry) continue;
    const [modelName, def] = modelEntry;
    const displayName = Object.keys(SCHEMA).includes(modelName)
      ? modelName.replace(/([A-Z])/g, ' $1').trim()
      : modelName;

    // Nombre real del archivo: usa el nombre de despliegue tal cual está en datos-zite/,
    // buscando por coincidencia de modelKey (sin espacios) en vez de adivinar.
    const metaPath = path.join(DATA_DIR, '_meta.json');
    if (!(await exists(metaPath))) { console.error('Falta datos-zite/_meta.json'); process.exit(1); }
    const meta = JSON.parse(await readFile(metaPath, 'utf8'));
    const tableMeta = meta.tables.find((t: { name: string }) => t.name.replace(/\s+/g, '') === modelName);
    if (!tableMeta) continue;
    const file = path.join(DATA_DIR, `${tableMeta.name}.json`);
    if (!(await exists(file))) { console.log(`⏭  ${tableMeta.name}: no exportada aún`); continue; }

    const records = JSON.parse(await readFile(file, 'utf8'));

    // Columna -> prop (de SCHEMA), para saber qué label de Zite corresponde a cada check.
    const colToProp = new Map(Object.entries(def.fields).map(([prop, f]) => [f.col, prop]));

    for (const check of tableChecks) {
      const prop = colToProp.get(check.col);
      if (!prop) continue;

      for (const record of records) {
        for (const [label, rawValue] of Object.entries(record.fields ?? {})) {
          if (toCamelProp(label) !== prop) continue;
          if (rawValue === null || rawValue === undefined || rawValue === '') continue;

          if (check.kind === 'enum') {
            if (!check.values.has(String(rawValue))) {
              totalViolations++;
              console.log(`❌ ${tableMeta.name} id=${record.id} — campo "${label}" = ${JSON.stringify(rawValue)} no está en la lista permitida (${[...check.values].slice(0, 6).join(', ')}${check.values.size > 6 ? ', …' : ''})`);
            }
          } else {
            const num = Number(rawValue);
            const maxAbs = 10 ** (check.precision - check.scale) - 10 ** -check.scale;
            if (!Number.isNaN(num) && Math.abs(num) > maxAbs) {
              totalViolations++;
              console.log(`❌ ${tableMeta.name} id=${record.id} — campo "${label}" = ${rawValue} excede numeric(${check.precision},${check.scale}) (máximo ±${maxAbs})`);
            }
          }
        }
      }
    }
  }

  console.log(`\nTotal: ${totalViolations} violaciones encontradas en los datos ya exportados.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
