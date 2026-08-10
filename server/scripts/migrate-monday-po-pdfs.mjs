// Migra los PDFs de Órdenes de Compra que viven en sapience-squad.monday.com
// (purchase_orders.pdf_url) a Supabase Storage. Idempotente: solo toca filas
// cuyo pdf_url todavía apunta a monday.com, así que una vez migradas todas,
// una corrida nueva no hace nada — seguro de incluir en cada carga completa.
//
// Requiere MONDAY_API_TOKEN (Monday → foto de perfil → Developers → My
// Access Tokens) y SUPABASE_SERVICE_ROLE_KEY. El ID numérico en la URL de
// monday.com es directamente el asset id de su API — se resuelve vía
// `assets(ids: [...])`, que devuelve una public_url presignada de S3 (sin
// necesitar cookie de sesión, que además dura solo 10 min) y el file_size
// real, usado para verificar que la descarga vino completa.
//
// Uso standalone: node --env-file=.env server/scripts/migrate-monday-po-pdfs.mjs
import { pool, PurchaseOrders } from '../compat/index.ts';
import { getSupabaseAdmin } from '../supabaseAdmin.ts';

const BUCKET = 'purchase-orders';
const MONDAY_BATCH_SIZE = 25;
const CONCURRENCY = 8;

function extractResourceId(url) {
  const m = url.match(/\/resources\/(\d+)\//);
  return m ? m[1] : null;
}

async function mondayAssets(ids, attempt = 1) {
  const res = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: { Authorization: process.env.MONDAY_API_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: `{ assets(ids: [${ids.join(',')}]) { id name public_url file_size } }` }),
  });
  if (res.status === 429 && attempt <= 3) {
    await new Promise((r) => setTimeout(r, 2000 * attempt));
    return mondayAssets(ids, attempt + 1);
  }
  const json = await res.json();
  if (json.errors) throw new Error(`Monday API error: ${JSON.stringify(json.errors)}`);
  return json.data.assets;
}

async function runPool(items, worker, concurrency) {
  const results = new Array(items.length);
  let next = 0;
  async function runWorker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, runWorker));
  return results;
}

export async function migrateMondayPoPdfs() {
  const { rows: pos } = await pool.query(
    `select id, po_number as "poNumber", pdf_url as "pdfUrl" from purchase_orders where pdf_url ilike '%sapience-squad.monday.com%'`
  );
  if (pos.length === 0) {
    console.log('   Nada que migrar (ninguna OC apunta a monday.com).');
    return { migrated: 0, failed: 0 };
  }
  console.log(`   Órdenes de compra a migrar: ${pos.length}`);

  const admin = getSupabaseAdmin();
  const { data: buckets } = await admin.storage.listBuckets();
  if (!buckets.some((b) => b.name === BUCKET)) {
    const { error } = await admin.storage.createBucket(BUCKET, { public: true, fileSizeLimit: '50MB' });
    if (error) throw new Error(`No se pudo crear el bucket: ${error.message}`);
  }

  const withResourceId = pos.map((po) => ({ ...po, resourceId: extractResourceId(po.pdfUrl) }));
  const valid = withResourceId.filter((p) => p.resourceId);
  const noResourceId = withResourceId.filter((p) => !p.resourceId);
  if (noResourceId.length) console.log(`   ⚠️  ${noResourceId.length} URLs no calzan con el patrón esperado`);

  const assetById = new Map();
  for (let i = 0; i < valid.length; i += MONDAY_BATCH_SIZE) {
    const batch = valid.slice(i, i + MONDAY_BATCH_SIZE);
    const assets = await mondayAssets(batch.map((p) => p.resourceId));
    for (const a of assets) assetById.set(a.id, a);
  }
  const unresolved = valid.filter((p) => !assetById.has(p.resourceId));
  if (unresolved.length) console.log(`   ⚠️  ${unresolved.length} assets ya no existen en Monday`);

  const toMigrate = valid.filter((p) => assetById.has(p.resourceId));
  const results = await runPool(toMigrate, async (po) => {
    const asset = assetById.get(po.resourceId);
    try {
      const fileRes = await fetch(asset.public_url);
      if (!fileRes.ok) throw new Error(`descarga falló (${fileRes.status})`);
      const buffer = Buffer.from(await fileRes.arrayBuffer());
      if (asset.file_size && Number(asset.file_size) !== buffer.length) {
        throw new Error(`tamaño no coincide: Monday dice ${asset.file_size}B, se bajaron ${buffer.length}B`);
      }
      const path = `${po.id}.pdf`;
      const { error: upErr } = await admin.storage.from(BUCKET).upload(path, buffer, { contentType: 'application/pdf', upsert: true });
      if (upErr) throw new Error(`subida falló: ${upErr.message}`);
      const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
      await PurchaseOrders.update({ id: po.id, record: { pdfUrl: pub.publicUrl } });
      return { poNumber: po.poNumber, ok: true };
    } catch (e) {
      return { poNumber: po.poNumber, ok: false, error: e.message };
    }
  }, CONCURRENCY);

  const migrated = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  console.log(`   ✅ ${migrated} migradas | ❌ ${failed.length} fallidas`);
  if (failed.length) console.log('   Fallidas:', JSON.stringify(failed, null, 2));
  return { migrated, failed: failed.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await migrateMondayPoPdfs();
  await pool.end();
}
