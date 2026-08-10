// Migra los archivos que viven en uploads.zite.com a Supabase Storage.
// Fuentes en orden de prioridad: supplier_invoices (pdf_file/xml_file/
// support_file — los XML son CFDI fiscales), payments.attachment,
// po_attachments.file_url, deal_documents.file_url, users.profile_photo.
//
// Idempotente: cada fuente se filtra por "todavía apunta a uploads.zite.com",
// así que una vez migrado todo, una corrida nueva no hace nada.
//
// Nota conocida: Supabase Storage fuerza Content-Type a text/plain para
// archivos .xml sin importar qué se le pida al subir (confirmado con 4
// pruebas distintas: Buffer+opción, Blob con type, text/xml, y un control
// con application/json que sí respetó lo pedido) — es sanitización de
// seguridad de la plataforma, no un bug de este script. El contenido de los
// XML es correcto byte a byte; solo el header HTTP sale genérico.
//
// Uso standalone: node --env-file=.env server/scripts/migrate-zite-uploads.mjs
import { pool } from '../compat/index.ts';
import { getSupabaseAdmin } from '../supabaseAdmin.ts';

const BUCKET = 'zite-uploads';
const CONCURRENCY = 8;
const ZITE_API_KEY = process.env.ZITE_API_KEY;

function extFrom(filename, url) {
  const src = filename || url || '';
  const m = src.match(/\.([a-zA-Z0-9]{1,6})(?:\?|$)/);
  return m ? `.${m[1].toLowerCase()}` : '';
}

const CONTENT_TYPES = {
  '.pdf': 'application/pdf',
  '.xml': 'application/xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.zip': 'application/zip',
};
function contentTypeFor(ext) {
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

async function downloadWithFallback(url) {
  let res = await fetch(url);
  if (res.status === 401 || res.status === 403) {
    res = await fetch(url, { headers: { Authorization: `Bearer ${ZITE_API_KEY}` } });
  }
  if (!res.ok) throw new Error(`descarga falló (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
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

const JSONB_SOURCES = [
  { table: 'supplier_invoices', column: 'pdf_file', prefix: 'supplier-invoices/pdf' },
  { table: 'supplier_invoices', column: 'xml_file', prefix: 'supplier-invoices/xml' },
  { table: 'supplier_invoices', column: 'support_file', prefix: 'supplier-invoices/support' },
  { table: 'payments', column: 'attachment', prefix: 'payments' },
];

const TEXT_SOURCES = [
  { table: 'po_attachments', column: 'file_url', prefix: 'po-attachments' },
  { table: 'deal_documents', column: 'file_url', prefix: 'deal-documents' },
  { table: 'users', column: 'profile_photo', prefix: 'profile-photos' },
];

export async function migrateZiteUploads() {
  const admin = getSupabaseAdmin();
  const { data: buckets } = await admin.storage.listBuckets();
  if (!buckets.some((b) => b.name === BUCKET)) {
    const { error } = await admin.storage.createBucket(BUCKET, { public: true, fileSizeLimit: '50MB' });
    if (error) throw new Error(`No se pudo crear el bucket: ${error.message}`);
  }

  const summary = [];

  for (const { table, column, prefix } of JSONB_SOURCES) {
    const { rows } = await pool.query(`select id, ${column} as arr from ${table} where ${column}::text ilike '%uploads.zite.com%'`);
    if (rows.length === 0) { summary.push({ source: `${table}.${column}`, ok: 0, failed: 0 }); continue; }
    console.log(`   ${table}.${column}: ${rows.length} filas`);

    const results = await runPool(rows, async (row) => {
      const arr = row.arr;
      const newArr = [];
      for (let i = 0; i < arr.length; i++) {
        const item = arr[i];
        if (!item.url || !item.url.includes('uploads.zite.com')) { newArr.push(item); continue; }
        try {
          const buffer = await downloadWithFallback(item.url);
          const ext = extFrom(item.filename, item.url) || '.bin';
          const path = `${prefix}/${row.id}-${i}${ext}`;
          const { error: upErr } = await admin.storage.from(BUCKET).upload(path, buffer, { upsert: true, contentType: contentTypeFor(ext) });
          if (upErr) throw new Error(`subida falló: ${upErr.message}`);
          const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
          newArr.push({ ...item, url: pub.publicUrl });
        } catch (e) {
          return { id: row.id, ok: false, error: e.message };
        }
      }
      try {
        await pool.query(`update ${table} set ${column} = $1::jsonb where id = $2`, [JSON.stringify(newArr), row.id]);
      } catch (e) {
        return { id: row.id, ok: false, error: `update falló: ${e.message}` };
      }
      return { id: row.id, ok: true };
    }, CONCURRENCY);

    const ok = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok);
    console.log(`   ✅ ${ok} | ❌ ${failed.length}`);
    if (failed.length) console.log('   Fallidas:', JSON.stringify(failed, null, 2));
    summary.push({ source: `${table}.${column}`, ok, failed: failed.length });
  }

  for (const { table, column, prefix } of TEXT_SOURCES) {
    const { rows } = await pool.query(`select id, ${column} as url from ${table} where ${column} ilike '%uploads.zite.com%'`);
    if (rows.length === 0) { summary.push({ source: `${table}.${column}`, ok: 0, failed: 0 }); continue; }
    console.log(`   ${table}.${column}: ${rows.length} filas`);

    const results = await runPool(rows, async (row) => {
      try {
        const buffer = await downloadWithFallback(row.url);
        const ext = extFrom(row.url, row.url) || '.bin';
        const path = `${prefix}/${row.id}${ext}`;
        const { error: upErr } = await admin.storage.from(BUCKET).upload(path, buffer, { upsert: true, contentType: contentTypeFor(ext) });
        if (upErr) throw new Error(`subida falló: ${upErr.message}`);
        const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
        await pool.query(`update ${table} set ${column} = $1 where id = $2`, [pub.publicUrl, row.id]);
        return { id: row.id, ok: true };
      } catch (e) {
        return { id: row.id, ok: false, error: e.message };
      }
    }, CONCURRENCY);

    const ok = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok);
    console.log(`   ✅ ${ok} | ❌ ${failed.length}`);
    if (failed.length) console.log('   Fallidas:', JSON.stringify(failed, null, 2));
    summary.push({ source: `${table}.${column}`, ok, failed: failed.length });
  }

  return summary;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const summary = await migrateZiteUploads();
  console.table(summary);
  await pool.end();
}
