// Repara recruitment_rows.cell_data corrompido por el bug de ingestión de
// Fillout: cuando una pregunta de archivo múltiple regresaba un array de
// strings de URL (no de objetos {url,filename}), toText() caía en el branch
// genérico y las unía con ", " en vez de codificarlas como JSON array — el
// visor (parseMultiFileUrls en DynamicColumns.tsx) no sabe leer eso y
// muestra un ícono roto. Ver conversación de Yamile Aquique Mojica /
// ELÁSTICO / MÉXICO - RESPUESTAS FILTRO.
//
// Uso: npx tsx --env-file=../.env repair-broken-multifile-cells.ts [--apply]
// Sin --apply corre en modo dry-run (solo reporta, no escribe nada).
import { pool } from '../compat/db';

const APPLY = process.argv.includes('--apply');
const BROKEN_RE = /^https?:\/\/[^,]+,\s*https?:\/\//;

function isHttpUrl(s: string): boolean {
  return /^https?:\/\//.test(s.trim());
}

async function main() {
  const { rows } = await pool.query(
    `select id, cell_data from recruitment_rows where cell_data like '%http%,%http%' and deleted_at is null`
  );
  console.log(`Filas candidatas: ${rows.length}`);

  let rowsFixed = 0;
  let cellsFixed = 0;
  let rowsSkippedParseError = 0;
  const backup: { id: string; cellData: string }[] = [];

  for (const row of rows) {
    let cd: Record<string, any>;
    try {
      cd = JSON.parse(row.cell_data);
    } catch {
      rowsSkippedParseError++;
      continue;
    }

    let changed = false;
    for (const key of Object.keys(cd)) {
      const val = cd[key];
      const raw = val?.fileUrl;
      if (typeof raw !== 'string' || !BROKEN_RE.test(raw)) continue;

      const parts = raw.split(',').map((s: string) => s.trim()).filter(Boolean);
      if (parts.length < 2 || !parts.every(isHttpUrl)) continue; // no se ve como el patrón esperado — no tocar

      cd[key] = { fileUrl: JSON.stringify(parts) };
      changed = true;
      cellsFixed++;
    }

    if (changed) {
      backup.push({ id: row.id, cellData: row.cell_data });
      rowsFixed++;
      if (APPLY) {
        await pool.query('update recruitment_rows set cell_data = $1 where id = $2', [JSON.stringify(cd), row.id]);
      }
    }
  }

  console.log(`Filas con al menos una celda reparada: ${rowsFixed}`);
  console.log(`Celdas individuales reparadas: ${cellsFixed}`);
  console.log(`Filas con cell_data no parseable (sin tocar): ${rowsSkippedParseError}`);
  console.log(APPLY ? 'Modo: APLICADO (se escribió en la base).' : 'Modo: DRY-RUN (nada se escribió — corre con --apply para aplicar).');

  if (APPLY) {
    const fs = await import('fs');
    const path = `./repair-backup-${Date.now()}.json`;
    fs.writeFileSync(path, JSON.stringify(backup, null, 2));
    console.log(`Backup de los valores previos guardado en: ${path}`);
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
