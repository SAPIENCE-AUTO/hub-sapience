// Backfill de la tabla Clients a partir de los ~64 valores de texto libre ya
// en uso en deals/projects/crm_items/invoices/collection_processes.
//
// Homologación con Sharpli: se toma su tabla `clients` (18 nombres reales,
// consultados directo — no hay endpoint público) como fuente canónica de
// nombre/casing cuando hay match. Decisiones tomadas a mano sobre los datos
// reales encontrados (no derivables automáticamente):
//   - Merges por typo/casing detectados a simple vista: "KIMBLERLY CLARK DE
//     MEXICO" y "LANDOR"/"LOREAL" mal escritos → nombre canónico de Sharpli.
//   - "Pierre Fabré" (con acento, 9 usos) y "Pierre Fabre" (7 usos) son la
//     misma marca — no está en Sharpli, se unifica al nombre correcto sin
//     acento ("Pierre Fabre" es el apellido francés real).
//   - Se OMITEN (quedan sin client_id, el texto libre original no se toca)
//     nombres que se ven claramente como datos de prueba/fixture, no
//     clientes reales: Acme Corp, Beta LLC, Gamma Inc, Tech Innovations
//     Inc., Global Financial Solutions, Green Earth Marketing, PRUEBA,
//     M&A STEEL AND SUPPLY. Si alguno resulta ser un cliente real, se
//     agrega a mano después — omitir es la opción reversible.
//   - Todo lo demás (Arabela, Atlantia, Bepensa, Bravissima, etc.) no tiene
//     match en Sharpli — se crea como cliente propio del Hub, sin
//     sharpli_client_id, con el mismo texto que ya se usaba (solo trim).
//
// Uso: npx tsx --env-file=../.env backfill-clients.ts [--apply]
// Sin --apply corre en modo dry-run (solo reporta, no escribe nada).
import { pool } from '../compat/db';

const APPLY = process.argv.includes('--apply');

// Nombre canónico de Sharpli (name → id real de su tabla clients).
const SHARPLI_MATCH: Record<string, { name: string; id: string }> = {
  'abbott': { name: 'Abbott', id: '9d9749c3-991c-46ab-a58a-71a63191ca11' },
  'bac': { name: 'BAC', id: '97365221-14a9-43cc-b138-6643b6ca2dc1' },
  'bayer': { name: 'Bayer', id: 'f58c672f-2b4d-4d31-a8a7-2f2ff621cedb' },
  'danone': { name: 'Danone', id: '788e9e00-8e6d-4939-9366-c22953a7fd1b' },
  'farmamedica': { name: 'Farmamédica', id: '77e4403d-db7f-4ad3-a7ea-96d3ee0eb89f' },
  'fifco': { name: 'Fifco', id: '15ddadad-2a40-417f-88b5-55dbd02dd4b5' },
  'grupo modelo': { name: 'Grupo Modelo', id: 'f6cce299-c068-4c6e-8da2-4d3498ff4562' },
  'grupo salinas': { name: 'Grupo Salinas', id: '629b9b84-1fcd-4688-887d-af029e663682' },
  'inditex': { name: 'Inditex', id: 'e5062c49-8099-4601-9bcb-683b2b92770d' },
  'kimberly clark': { name: 'Kimberly Clark', id: '00ccf457-9c52-4cd0-9d12-851e0994e27f' },
  'kimblerly clark de mexico': { name: 'Kimberly Clark', id: '00ccf457-9c52-4cd0-9d12-851e0994e27f' },
  'loreal': { name: "L'Oréal", id: '66dca9fa-cab0-4aba-852d-5b5c6eea79a7' },
  'landor': { name: 'Landor', id: '38840171-8de6-4f79-add9-a94f340a5bab' },
  'mondelez': { name: 'Mondelez', id: '41b6a461-c245-4402-aa03-1fd7bc9b9c34' },
  'pepsico': { name: 'Pepsico', id: '2d728ee6-ae4a-46ff-909d-2b5fc60df0b1' },
  'sapience': { name: 'Sapience', id: '906de061-7146-49cd-a87c-4fd49a744d7d' },
  'sede cafe': { name: 'Sede Café', id: '53c18ecd-4f52-449b-adc8-9dfe38f66553' },
  'the mind sell': { name: 'The Mind Sell', id: '99e02f26-30e3-40a8-892a-54f7b73791d7' },
  'vestacy': { name: 'Vestacy', id: '6a947b46-2644-4e45-88dd-316b7c78d704' },
};

// Merges detectados en los datos del Hub que NO tienen match en Sharpli.
const HUB_MERGE: Record<string, string> = {
  'pierre fabre': 'Pierre Fabre',
  'pierre fabré': 'Pierre Fabre',
};

// Datos de prueba/fixture confirmados a simple vista — se dejan sin client_id.
const SKIP = new Set([
  'acme corp', 'beta llc', 'gamma inc', 'tech innovations inc.',
  'global financial solutions', 'green earth marketing', 'prueba',
  'm&a steel and supply',
]);

function normalize(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

async function main() {
  const tables = ['deals', 'projects', 'crm_items', 'invoices', 'collection_processes'];

  const rawValues = new Set<string>();
  for (const t of tables) {
    const { rows } = await pool.query(`select distinct trim(client) as c from ${t} where client is not null and trim(client) <> ''`);
    for (const r of rows) rawValues.add(r.c);
  }
  console.log(`Valores distintos encontrados: ${rawValues.size}`);

  // raw value -> canonical name (o null si se omite)
  const canonicalOf = new Map<string, string | null>();
  // canonical name -> sharpli id (o undefined)
  const sharpliIdOf = new Map<string, string | undefined>();

  for (const raw of rawValues) {
    const n = normalize(raw);
    if (SKIP.has(n)) { canonicalOf.set(raw, null); continue; }
    const sharpli = SHARPLI_MATCH[n];
    if (sharpli) {
      canonicalOf.set(raw, sharpli.name);
      sharpliIdOf.set(sharpli.name, sharpli.id);
      continue;
    }
    const merged = HUB_MERGE[n];
    if (merged) { canonicalOf.set(raw, merged); continue; }
    canonicalOf.set(raw, raw); // sin match — se usa tal cual (solo trim)
  }

  const canonicalNames = [...new Set([...canonicalOf.values()].filter((v): v is string => v !== null))];
  console.log(`Clientes a crear: ${canonicalNames.length} (omitidos: ${[...canonicalOf.values()].filter(v => v === null).length})`);
  for (const name of canonicalNames.sort()) {
    console.log(`  ${sharpliIdOf.get(name) ? '[sharpli]' : '[solo hub]'} ${name}`);
  }

  if (!APPLY) {
    console.log('\nModo: DRY-RUN — nada se escribió. Corre con --apply para aplicar.');
    await pool.end();
    return;
  }

  const idOf = new Map<string, string>();
  for (const name of canonicalNames) {
    const sharpliId = sharpliIdOf.get(name) ?? null;
    const { rows } = await pool.query(
      `insert into clients (name, sharpli_client_id) values ($1, $2)
       on conflict (lower(trim(name))) do update set sharpli_client_id = excluded.sharpli_client_id
       returning id`,
      [name, sharpliId]
    );
    idOf.set(name, rows[0].id);
  }
  console.log(`✅ ${idOf.size} clientes insertados/actualizados en clients`);

  let totalUpdated = 0;
  for (const t of tables) {
    const { rows } = await pool.query(`select distinct trim(client) as c from ${t} where client is not null and trim(client) <> ''`);
    for (const r of rows) {
      const canonical = canonicalOf.get(r.c);
      if (!canonical) continue;
      const clientId = idOf.get(canonical);
      if (!clientId) continue;
      const res = await pool.query(`update ${t} set client_id = $1 where trim(client) = $2 and client_id is null`, [clientId, r.c]);
      totalUpdated += res.rowCount ?? 0;
    }
  }
  console.log(`✅ ${totalUpdated} filas actualizadas con client_id across las 5 tablas`);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
