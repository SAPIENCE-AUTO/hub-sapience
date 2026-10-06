// Mueve archivos de una biblioteca de SharePoint/OneDrive a Azure Blob Storage
// para liberar cuota del tenant. Complemento de audit-sharepoint-storage.ts:
// primero se audita qué sitio pesa más, luego se desahoga con este.
//
// Por defecto es SOLO LECTURA (dry-run): lista lo que movería y cuánto pesa.
// Nada se copia sin --execute y nada se borra sin --delete.
//
// Flujo por archivo (con --execute):
//   1. Azure copia el archivo directo de SharePoint en bloques de 100 MiB
//      (Put Block From URL): los bytes no pasan por esta máquina. Con --local
//      se baja aquí en bloques de 32 MiB y se sube con Content-MD5.
//   2. Verifica con HEAD que el blob mide lo mismo que lo que sirve SharePoint.
//   3. Solo con --delete: vuelve a pedir el item a SharePoint y compara eTag
//      (si alguien lo editó mientras se copiaba, NO se borra) y lo elimina.
//
// ⚠️ Cuota: un DELETE normal manda el archivo a la papelera de reciclaje del
// sitio, y la papelera SIGUE contando contra la cuota hasta 93 días. Si lo
// urgente es liberar espacio ya, usar --purge (permanentDelete: se salta la
// papelera, irreversible del lado de SharePoint — la única copia queda en Blob).
//
// Registro en el Hub (default con --execute): cada archivo copiado se anota en
// la tabla `archived_files` (ver add-archived-files-table.ts; necesita
// DATABASE_URL) y su carpeta raíz se liga al proyecto del Hub con el mismo
// código o nombre. Con --delete, ANTES de borrar el original se sube en su
// carpeta un acceso directo `<nombre>.url` → <hub>/archivo/<id>, así nunca
// hay un momento en que el archivo no esté ni en SharePoint ni enlazado.
//
// Reanudable: cada archivo procesado se anota en un log JSONL. Si el script se
// corta, al volver a correrlo se salta lo ya hecho (y si un blob ya existe con
// el mismo tamaño, no se vuelve a subir).
//
// Permisos: usa la misma app de Graph (MS_TENANT_ID / MS_CLIENT_ID /
// MS_CLIENT_SECRET). Files.ReadWrite.All alcanza para --drive-id y --group-id.
// Resolver por --site URL normalmente pide además Sites.Read.All; si falla con
// 403, usar --group-id del equipo de Teams o --drive-id directo.
//
// Blob: AZURE_BLOB_CONTAINER_SAS_URL = URL del contenedor con SAS, p. ej.
//   https://<cuenta>.blob.core.windows.net/sharepoint-archivo?sv=...&sig=...
// (Azure Portal → cuenta de almacenamiento → Contenedores → el contenedor →
// Shared access tokens → permisos Read, Add, Create, Write, List → Generate).
//
// Uso (desde la raíz del repo):
//   npx tsx --env-file=.env server/scripts/sharepoint-to-blob.ts --site https://agcmx.sharepoint.com/sites/Proyectos
//   npx tsx --env-file=.env server/scripts/sharepoint-to-blob.ts --group-id <id> --path "General/2024" --older-than-days 365 --execute --delete --purge
//
// Opciones:
//   --site <url> | --group-id <id> | --drive-id <id>   origen (uno obligatorio)
//   --path <carpeta>          subcarpeta dentro de la biblioteca (default: raíz)
//   --older-than-days <n>     solo archivos sin modificar en n días
//   --min-size-mb <n>         solo archivos de al menos n MB
//   --ext mp4,mov,zip         solo esas extensiones
//   --max-gb <n>              detenerse tras mover n GB (para ir por tandas)
//   --prefix <p>              prefijo en Blob (default: nombre del sitio/drive)
//   --tier Hot|Cool|Cold|Archive   nivel de acceso (default: Cool)
//   --concurrency <n>         archivos en paralelo (default: 4)
//   --execute                 copiar de verdad
//   --delete                  borrar de SharePoint tras copia verificada
//   --purge                   borrar sin pasar por la papelera (requiere --delete)
//   --log <archivo>           log JSONL (default: sharepoint-to-blob-<drive>.jsonl)
//   --local                   bajar a esta máquina y subir (default: Azure copia directo de SharePoint)
//   --no-register             no registrar en la tabla archived_files del Hub (ni dejar accesos directos)
//   --hub-url <url>           base de los accesos directos (default: https://hub.sapience.com.mx)
//   --fix-shortcuts           solo crear los accesos directos que quedaron pendientes por cuota llena

import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { graphFetch } from '../microsoft/graph.ts';

// ---------- argumentos ----------

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const opt = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const SITE_URL = opt('site');
const GROUP_ID = opt('group-id');
const DRIVE_ID_ARG = opt('drive-id');
const ROOT_PATH = (opt('path') ?? '').replace(/^\/+|\/+$/g, '');
const OLDER_THAN_DAYS = opt('older-than-days') ? Number(opt('older-than-days')) : null;
const MIN_SIZE = opt('min-size-mb') ? Number(opt('min-size-mb')) * 1024 * 1024 : 0;
const EXTS = opt('ext')?.split(',').map((e) => e.trim().toLowerCase().replace(/^\./, '')).filter(Boolean) ?? null;
const MAX_BYTES = opt('max-gb') ? Number(opt('max-gb')) * 1024 ** 3 : Infinity;
const TIER = opt('tier') ?? 'Cool';
const CONCURRENCY = Number(opt('concurrency') ?? 4);
const EXECUTE = flag('execute');
const DELETE = flag('delete');
const PURGE = flag('purge');
const LOCAL = flag('local');
const FIX_SHORTCUTS = flag('fix-shortcuts');
const REGISTER = (EXECUTE && !flag('no-register')) || FIX_SHORTCUTS;
const HUB_URL = (opt('hub-url') ?? 'https://hub.sapience.com.mx').replace(/\/$/, '');

const BLOCK_SIZE = 32 * 1024 * 1024;
const SERVER_BLOCK_SIZE = 100 * 1024 * 1024;
const BLOCKS_IN_PARALLEL = 8;
const GRAPH = 'https://graph.microsoft.com/v1.0';
const BLOB_VERSION = '2023-11-03';

function die(msg: string): never {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

if (!FIX_SHORTCUTS && [SITE_URL, GROUP_ID, DRIVE_ID_ARG].filter(Boolean).length !== 1) die('Indica exactamente uno: --site, --group-id o --drive-id.');
if (DELETE && !EXECUTE) die('--delete requiere --execute.');
if (PURGE && !DELETE) die('--purge requiere --delete.');
if (!['Hot', 'Cool', 'Cold', 'Archive'].includes(TIER)) die('--tier debe ser Hot, Cool, Cold o Archive.');

const SAS_URL = process.env.AZURE_BLOB_CONTAINER_SAS_URL;
if (EXECUTE && !SAS_URL) die('Falta AZURE_BLOB_CONTAINER_SAS_URL (URL del contenedor con SAS).');
if (REGISTER && !process.env.DATABASE_URL) die('Falta DATABASE_URL para registrar en archived_files (o usa --no-register).');

// ---------- helpers ----------

const fmtGB = (b: number) => (b / 1024 ** 3).toFixed(2);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** graphFetch con reintento en 429/503/504 respetando Retry-After. */
async function graph(url: string, init: RequestInit = {}): Promise<Response> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const res = await graphFetch(url.startsWith('http') ? url : `${GRAPH}${url}`, init);
    if (res.status === 429 || res.status === 503 || res.status === 504) {
      await sleep(Number(res.headers.get('Retry-After') ?? 2 ** attempt) * 1000);
      continue;
    }
    if (res.status === 403) {
      die(`403 en ${url} — falta permiso de aplicación (prueba --group-id o --drive-id). ${(await res.text()).slice(0, 300)}`);
    }
    return res;
  }
  throw new Error(`Graph sigue saturado tras varios reintentos: ${url}`);
}

async function graphJson(url: string) {
  const res = await graph(url);
  if (!res.ok) throw new Error(`${res.status} en ${url}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

/** fetch a Blob con reintentos en errores transitorios. */
async function blobFetch(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.status >= 500 || res.status === 429) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      return res;
    } catch (err) {
      if (attempt === 5) throw err;
      await sleep(1000 * 2 ** attempt);
    }
  }
  throw new Error(`Blob sigue fallando tras varios reintentos: ${url.split('?')[0]}`);
}

function blobUrl(blobName: string, query = ''): string {
  const u = new URL(SAS_URL!);
  const encoded = blobName.split('/').map(encodeURIComponent).join('/');
  return `${u.origin}${u.pathname.replace(/\/$/, '')}/${encoded}${u.search}${query ? `&${query}` : ''}`;
}

/** Los valores de x-ms-meta-* deben ser ASCII: se codifican. */
const meta = (v: string) => encodeURIComponent(v);

// ---------- origen ----------

async function resolveDrive(): Promise<{ driveId: string; label: string }> {
  if (DRIVE_ID_ARG) {
    const d = await graphJson(`/drives/${DRIVE_ID_ARG}?$select=id,name,webUrl`);
    return { driveId: d.id, label: d.name };
  }
  if (GROUP_ID) {
    const d = await graphJson(`/groups/${GROUP_ID}/drive?$select=id,name,webUrl`);
    const g = await graphJson(`/groups/${GROUP_ID}?$select=displayName`).catch(() => null);
    return { driveId: d.id, label: g?.displayName ?? d.name };
  }
  const u = new URL(SITE_URL!);
  const site = await graphJson(`/sites/${u.hostname}:${u.pathname.replace(/\/$/, '')}?$select=id,displayName`);
  const d = await graphJson(`/sites/${site.id}/drive?$select=id,name`);
  return { driveId: d.id, label: site.displayName };
}

interface Item {
  id: string;
  name: string;
  size: number;
  eTag: string;
  path: string; // relativa a la raíz de la biblioteca
  lastModified: string;
  mimeType?: string;
}

const SELECT = '$select=id,name,size,eTag,file,folder,lastModifiedDateTime,parentReference&$top=999';

async function* walk(driveId: string, folderUrl: string, relPath: string): AsyncGenerator<Item> {
  let url: string | undefined = `${folderUrl}/children?${SELECT}`;
  const subfolders: { id: string; path: string }[] = [];
  while (url) {
    const page = await graphJson(url);
    for (const it of page.value ?? []) {
      const p = relPath ? `${relPath}/${it.name}` : it.name;
      if (it.folder) subfolders.push({ id: it.id, path: p });
      else if (it.file) {
        yield { id: it.id, name: it.name, size: it.size ?? 0, eTag: it.eTag, path: p, lastModified: it.lastModifiedDateTime, mimeType: it.file.mimeType };
      }
    }
    url = page['@odata.nextLink'];
  }
  for (const f of subfolders) yield* walk(driveId, `/drives/${driveId}/items/${f.id}`, f.path);
}

function matches(it: Item): boolean {
  if (it.size < MIN_SIZE) return false;
  if (OLDER_THAN_DAYS != null && Date.now() - Date.parse(it.lastModified) < OLDER_THAN_DAYS * 86_400_000) return false;
  if (EXTS && !EXTS.includes(it.name.split('.').pop()?.toLowerCase() ?? '')) return false;
  return true;
}

// ---------- copia ----------

async function blobSize(blobName: string): Promise<number | null> {
  const res = await blobFetch(blobUrl(blobName), { method: 'HEAD', headers: { 'x-ms-version': BLOB_VERSION } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HEAD blob ${res.status}`);
  return Number(res.headers.get('content-length'));
}

const blockId = (n: number) => Buffer.from(String(n).padStart(8, '0')).toString('base64');

/**
 * Copia servidor a servidor: Azure jala cada rango directo del downloadUrl de
 * SharePoint (Put Block From URL). Los bytes no pasan por esta máquina, así
 * que la velocidad no depende del internet local.
 */
/**
 * SharePoint limita las descargas (429 / 503). Cuando cualquier petición al
 * origen se topa con el límite, TODAS las copias en curso esperan juntas
 * (Retry-After) en vez de seguir golpeando — si no, el límite se alarga.
 */
let sourceThrottledUntil = 0;
let throttleNotices = 0;

function throttleSource(retryAfter: string | null, attempt: number) {
  const seconds = Number(retryAfter) || Math.min(5 * 2 ** attempt, 120);
  const until = Date.now() + seconds * 1000;
  if (until > sourceThrottledUntil) {
    sourceThrottledUntil = until;
    if (throttleNotices++ % 10 === 0) console.warn(`  ⏸  SharePoint pidió bajar el ritmo; pausa de ${seconds}s`);
  }
}

async function waitForSource() {
  const wait = sourceThrottledUntil - Date.now();
  if (wait > 0) await sleep(wait);
}

const SOURCE_RETRIES = 8;

async function stageServerSide(src: string, blobName: string): Promise<{ ids: string[]; total: number }> {
  // Tamaño real de lo que sirve SharePoint (en Office puede diferir de item.size).
  let total = NaN;
  let lastStatus = 0;
  for (let attempt = 0; attempt < SOURCE_RETRIES; attempt++) {
    await waitForSource();
    const probe = await fetch(src, { headers: { Range: 'bytes=0-0' } });
    await probe.body?.cancel();
    lastStatus = probe.status;
    if (probe.status === 429 || probe.status === 503) {
      throttleSource(probe.headers.get('Retry-After'), attempt);
      continue;
    }
    // 416 a bytes=0-0: el archivo pesa 0 bytes.
    if (probe.status === 416) { total = 0; break; }
    total = Number(probe.headers.get('content-range')?.split('/')[1] ?? probe.headers.get('content-length'));
    if (probe.ok) break;
  }
  if (!Number.isFinite(total)) throw new Error(`no se pudo leer el tamaño en origen (${lastStatus})`);

  const ids: string[] = [];
  for (let start = 0, n = 0; start < total; start += SERVER_BLOCK_SIZE, n++) ids.push(blockId(n));
  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const n = next++;
      const start = n * SERVER_BLOCK_SIZE;
      const end = Math.min(start + SERVER_BLOCK_SIZE, total) - 1;
      for (let attempt = 0; ; attempt++) {
        await waitForSource();
        const res = await blobFetch(blobUrl(blobName, `comp=block&blockid=${encodeURIComponent(ids[n])}`), {
          method: 'PUT',
          headers: { 'x-ms-version': BLOB_VERSION, 'x-ms-copy-source': src, 'x-ms-source-range': `bytes=${start}-${end}` },
          body: '',
        });
        if (res.ok) break;
        // Si el que se negó fue SharePoint, Azure responde CannotVerifyCopySource
        // con el status del origen (p. ej. 429) en el mensaje.
        const text = await res.text();
        const sourceThrottled = res.headers.get('x-ms-error-code') === 'CannotVerifyCopySource' && /\b(429|503)\b|Too Many|throttl/i.test(text);
        if (sourceThrottled && attempt < SOURCE_RETRIES) {
          throttleSource(null, attempt);
          continue;
        }
        throw new Error(`Put Block From URL ${res.status}: ${text.slice(0, 200)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(BLOCKS_IN_PARALLEL, ids.length) }, worker));
  return { ids, total };
}

/** Descarga a esta máquina y sube por bloques con Content-MD5 (--local). */
async function stageViaLocal(src: string, blobName: string): Promise<{ ids: string[]; total: number }> {
  const dl = await fetch(src);
  if (!dl.ok || !dl.body) throw new Error(`descarga ${dl.status}`);

  const ids: string[] = [];
  let total = 0;
  let pending: Uint8Array[] = [];
  let pendingLen = 0;

  const flush = async () => {
    if (pendingLen === 0) return;
    const buf = Buffer.concat(pending, pendingLen);
    pending = [];
    pendingLen = 0;
    const id = blockId(ids.length);
    const res = await blobFetch(blobUrl(blobName, `comp=block&blockid=${encodeURIComponent(id)}`), {
      method: 'PUT',
      headers: { 'x-ms-version': BLOB_VERSION, 'Content-MD5': createHash('md5').update(buf).digest('base64') },
      body: buf,
    });
    if (!res.ok) throw new Error(`Put Block ${res.status}: ${(await res.text()).slice(0, 200)}`);
    ids.push(id);
  };

  const reader = dl.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    pending.push(value);
    pendingLen += value.length;
    total += value.length;
    if (pendingLen >= BLOCK_SIZE) await flush();
  }
  await flush();
  return { ids, total };
}

/** Copia un archivo de SharePoint a Blob. Devuelve bytes copiados. */
async function copyToBlob(driveId: string, it: Item, blobName: string): Promise<number> {
  // Sin $select: Graph omite @microsoft.graph.downloadUrl si se pide explícito.
  const info = await graphJson(`/drives/${driveId}/items/${it.id}`);
  const src: string | undefined = info['@microsoft.graph.downloadUrl'];
  if (!src) throw new Error('Graph no devolvió downloadUrl');
  const { ids: blockIds, total } = LOCAL ? await stageViaLocal(src, blobName) : await stageServerSide(src, blobName);

  const commonHeaders = {
    'x-ms-version': BLOB_VERSION,
    'x-ms-blob-content-type': it.mimeType ?? 'application/octet-stream',
    'x-ms-access-tier': TIER,
    'x-ms-meta-sharepoint_path': meta(it.path),
    'x-ms-meta-sharepoint_item_id': meta(it.id),
    'x-ms-meta-sharepoint_drive_id': meta(driveId),
    'x-ms-meta-last_modified': meta(it.lastModified),
  };

  if (blockIds.length === 0) {
    // Archivo vacío: Put Blob directo (Put Block no acepta cuerpo vacío).
    const res = await blobFetch(blobUrl(blobName), { method: 'PUT', headers: { ...commonHeaders, 'x-ms-blob-type': 'BlockBlob' }, body: '' });
    if (!res.ok) throw new Error(`Put Blob ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return 0;
  }

  const xml = `<?xml version="1.0" encoding="utf-8"?><BlockList>${blockIds.map((b) => `<Latest>${b}</Latest>`).join('')}</BlockList>`;
  const res = await blobFetch(blobUrl(blobName, 'comp=blocklist'), {
    method: 'PUT',
    headers: { ...commonHeaders, 'Content-Type': 'application/xml' },
    body: xml,
  });
  if (!res.ok) throw new Error(`Put Block List ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return total;
}

// ---------- registro en el Hub ----------

const pool = REGISTER ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }) : null;
const normName = (s: string) => (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

/** carpeta raíz normalizada → project id, solo cuando casa con exactamente un proyecto. */
async function loadProjectIndex(): Promise<Map<string, string>> {
  const { rows } = await pool!.query('select id, project_code, full_name from projects');
  const hits = new Map<string, Set<string>>();
  for (const p of rows) {
    for (const k of new Set([normName(p.project_code), normName(p.full_name)])) {
      if (!k) continue;
      if (!hits.has(k)) hits.set(k, new Set());
      hits.get(k)!.add(p.id);
    }
  }
  const index = new Map<string, string>();
  for (const [k, ids] of hits) if (ids.size === 1) index.set(k, [...ids][0]);
  // Asignaciones hechas a mano en /archivo ("Asignar a proyecto") mandan sobre
  // el cruce por nombre, para que lo nuevo de esa carpeta caiga en el mismo
  // proyecto.
  const manual = await pool!.query(
    'select distinct on (project_folder) project_folder, project_id from archived_files where project_id is not null order by project_folder, updated_at desc',
  );
  for (const m of manual.rows) index.set(normName(m.project_folder), m.project_id);
  return index;
}

async function registerFile(driveId: string, it: Item, blobName: string, size: number, projectId: string | undefined): Promise<string> {
  const { rows } = await pool!.query(
    `insert into archived_files
       (project_id, project_folder, file_name, sharepoint_path, sharepoint_site_url, sharepoint_drive_id,
        sharepoint_item_id, blob_name, size_bytes, content_type, original_modified_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     on conflict (sharepoint_item_id) do update set
       blob_name = excluded.blob_name, size_bytes = excluded.size_bytes,
       original_modified_at = excluded.original_modified_at
     returning id`,
    [projectId ?? null, it.path.split('/')[0], it.name, it.path, SITE_URL ?? null, driveId, it.id, blobName, size,
      it.mimeType ?? null, it.lastModified],
  );
  return rows[0].id;
}

class QuotaFullError extends Error {}

/**
 * Sube `<ruta original>.url` junto al original; mismo formato que "Nuevo →
 * Vínculo" de SharePoint. Por ruta (no por id de carpeta) para que
 * --fix-shortcuts pueda crearlo después solo con lo que guarda archived_files.
 */
async function createShortcut(driveId: string, sharepointPath: string, archivedId: string): Promise<string> {
  const body = `[InternetShortcut]\r\nURL=${HUB_URL}/archivo/${archivedId}\r\n`;
  const path = `${sharepointPath}.url`.split('/').map(encodeURIComponent).join('/');
  const res = await graph(
    `/drives/${driveId}/root:/${path}:/content?@microsoft.graph.conflictBehavior=replace`,
    { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body },
  );
  // 507: cuota del tenant llena — ni un archivo de 100 bytes cabe.
  if (res.status === 507) throw new QuotaFullError('cuota de SharePoint llena');
  if (!res.ok) throw new Error(`acceso directo ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const id = (await res.json()).id;
  await pool!.query('update archived_files set shortcut_item_id = $2 where id = $1', [archivedId, id]);
  return id;
}

/**
 * --fix-shortcuts: crea los accesos directos que quedaron pendientes porque la
 * cuota estaba llena al momento de archivar (SharePoint tarda en recalcular el
 * espacio liberado).
 */
async function fixShortcuts(): Promise<void> {
  const { rows } = await pool!.query(
    `select id, sharepoint_drive_id, sharepoint_path from archived_files
      where estado = 'archived' and shortcut_item_id is null order by sharepoint_path`,
  );
  console.log(`Accesos directos pendientes: ${rows.length}`);
  let ok = 0;
  for (const r of rows) {
    try {
      await createShortcut(r.sharepoint_drive_id, r.sharepoint_path, r.id);
      ok++;
    } catch (err) {
      if (err instanceof QuotaFullError) {
        console.warn('⚠️  SharePoint sigue sin espacio; vuelve a intentar más tarde.');
        break;
      }
      console.error(`  ❌ ${r.sharepoint_path}: ${(err as Error).message}`);
    }
  }
  console.log(`Creados: ${ok} de ${rows.length}`);
}

async function deleteFromSharePoint(driveId: string, it: Item, beforeDelete?: () => Promise<() => Promise<void>>): Promise<'deleted' | 'changed'> {
  // Re-chequeo de eTag: si el archivo cambió desde que se listó, la copia en
  // Blob ya no es la versión actual — no se borra.
  const now = await graph(`/drives/${driveId}/items/${it.id}?$select=eTag`);
  if (now.status === 404) return 'deleted';
  const { eTag } = await now.json();
  if (eTag !== it.eTag) return 'changed';

  // Acceso directo antes de borrar; si al final no se borra, se deshace.
  const undo = beforeDelete ? await beforeDelete() : null;
  const res = PURGE
    ? await graph(`/drives/${driveId}/items/${it.id}/permanentDelete`, { method: 'POST' })
    : await graph(`/drives/${driveId}/items/${it.id}`, { method: 'DELETE', headers: { 'If-Match': it.eTag } });
  if (res.status === 412 || (!res.ok && res.status !== 404)) await undo?.().catch(() => {});
  if (res.status === 412) return 'changed';
  if (!res.ok && res.status !== 404) throw new Error(`borrado ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return 'deleted';
}

// ---------- main ----------

let shortcutsPending = 0;

async function main() {
  if (FIX_SHORTCUTS) {
    await fixShortcuts();
    await pool!.end();
    return;
  }
  const { driveId, label } = await resolveDrive();
  const projectIndex = REGISTER ? await loadProjectIndex() : new Map<string, string>();
  const prefix = (opt('prefix') ?? label).replace(/^\/+|\/+$/g, '');
  const logPath = opt('log') ?? `sharepoint-to-blob-${driveId.slice(-12).replace(/[^\w-]/g, '')}.jsonl`;

  // Estado previo: último status por item.
  const done = new Map<string, string>();
  if (existsSync(logPath)) {
    for (const line of readFileSync(logPath, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line);
        done.set(r.id, r.status);
      } catch { /* línea cortada por un kill, se ignora */ }
    }
  }
  const log = (r: Record<string, unknown>) => appendFileSync(logPath, JSON.stringify({ ts: new Date().toISOString(), ...r }) + '\n');

  console.log(`Origen: ${label} (drive ${driveId})${ROOT_PATH ? ` → /${ROOT_PATH}` : ''}`);
  console.log(`Modo: ${!EXECUTE ? 'DRY-RUN (no copia ni borra)' : DELETE ? (PURGE ? 'copiar + BORRAR PERMANENTE' : 'copiar + borrar (a papelera)') : 'solo copiar'}`);
  if (EXECUTE) console.log(`Destino: ${SAS_URL!.split('?')[0]}/${prefix}/…  (tier ${TIER})`);
  console.log(`Log: ${logPath}\n`);

  const rootUrl = ROOT_PATH ? `/drives/${driveId}/root:/${ROOT_PATH.split('/').map(encodeURIComponent).join('/')}:` : `/drives/${driveId}/root`;

  let scanned = 0;
  let selectedBytes = 0;
  let movedBytes = 0;
  let ok = 0;
  let failed = 0;
  let skipped = 0;
  let stop = false;
  const running = new Set<Promise<void>>();

  const process1 = async (it: Item) => {
    const blobName = `${prefix}/${it.path}`;
    try {
      const prev = done.get(it.id);
      let copied: number;
      const existing = await blobSize(blobName);
      // Ya estaba en Blob de una corrida anterior (copiado y anotado, o subido
      // justo antes de un corte). Un 'changed' siempre se vuelve a copiar.
      if (existing != null && (prev === 'copied' || (prev === undefined && existing === it.size))) {
        copied = existing;
      } else {
        copied = await copyToBlob(driveId, it, blobName);
        const check = await blobSize(blobName);
        if (check !== copied) throw new Error(`verificación: blob mide ${check}, se descargaron ${copied}`);
        // SharePoint a veces reescribe metadatos de Office al descargar; el
        // tamaño cambia unos KB. Se avisa pero no es error.
        if (copied !== it.size) console.warn(`  ⚠️  ${it.path}: SharePoint reporta ${it.size} B, se descargaron ${copied} B`);
        log({ id: it.id, path: it.path, blob: blobName, size: copied, status: 'copied' });
      }

      const archivedId = REGISTER
        ? await registerFile(driveId, it, blobName, copied, projectIndex.get(normName(it.path.split('/')[0])))
        : null;

      if (DELETE) {
        // Acceso directo antes de borrar. Si la cuota está tan llena que ni
        // eso cabe, se borra primero (el archivo ya está verificado en Blob y
        // registrado en el Hub) y el acceso directo se intenta después.
        let shortcutLater = false;
        const r = await deleteFromSharePoint(driveId, it, archivedId ? async () => {
          try {
            const shortcutId = await createShortcut(driveId, it.path, archivedId);
            return () => graph(`/drives/${driveId}/items/${shortcutId}`, { method: 'DELETE' }).then(() => {});
          } catch (err) {
            if (!(err instanceof QuotaFullError)) throw err;
            shortcutLater = true;
            return async () => {};
          }
        } : undefined);
        if (r === 'changed') {
          console.warn(`  ⏭  ${it.path}: cambió en SharePoint durante la copia, NO se borró (se recopiará en la próxima corrida)`);
          log({ id: it.id, path: it.path, blob: blobName, status: 'changed' });
          skipped++;
          return;
        }
        if (archivedId) {
          await pool!.query(`update archived_files set estado = 'archived' where id = $1`, [archivedId]);
          if (shortcutLater) {
            await createShortcut(driveId, it.path, archivedId).catch(() => {
              shortcutsPending++;
              console.warn(`  🔗 ${it.path}: acceso directo pendiente (cuota llena) — correr --fix-shortcuts después`);
            });
          }
        }
        log({ id: it.id, path: it.path, blob: blobName, size: copied, status: PURGE ? 'purged' : 'deleted', archivedId });
      }
      ok++;
      movedBytes += it.size;
      console.log(`  ✅ ${fmtGB(movedBytes).padStart(8)} GB  ${it.path}`);
    } catch (err) {
      failed++;
      console.error(`  ❌ ${it.path}: ${(err as Error).message}`);
      log({ id: it.id, path: it.path, blob: blobName, status: 'error', error: (err as Error).message });
    }
  };

  for await (const it of walk(driveId, rootUrl, ROOT_PATH)) {
    scanned++;
    if (scanned % 500 === 0) console.log(`  …${scanned} archivos revisados`);
    if (!matches(it)) continue;
    const prev = done.get(it.id);
    if (prev === 'deleted' || prev === 'purged' || (prev === 'copied' && !DELETE && !REGISTER)) { skipped++; continue; }
    if (selectedBytes + it.size > MAX_BYTES) { stop = true; break; }
    selectedBytes += it.size;

    if (!EXECUTE) {
      console.log(`  ${(it.size / 1024 ** 2).toFixed(1).padStart(10)} MB  ${it.lastModified.slice(0, 10)}  ${it.path}`);
      continue;
    }
    const p = process1(it).finally(() => running.delete(p));
    running.add(p);
    if (running.size >= CONCURRENCY) await Promise.race(running);
  }
  await Promise.all(running);

  console.log(`\nRevisados: ${scanned} archivos. Seleccionados: ${fmtGB(selectedBytes)} GB.${stop ? ` (tope --max-gb alcanzado)` : ''}`);
  if (EXECUTE) console.log(`OK: ${ok} (${fmtGB(movedBytes)} GB)  ·  Saltados: ${skipped}  ·  Errores: ${failed}`);
  else console.log('Dry-run: agrega --execute para copiar, y --delete [--purge] para liberar espacio.');
  if (shortcutsPending) console.log(`Accesos directos pendientes: ${shortcutsPending} — correr con --fix-shortcuts cuando SharePoint refleje el espacio liberado.`);
  if (DELETE && !PURGE) console.log('Recordatorio: lo borrado está en la papelera del sitio y sigue contando contra la cuota hasta vaciarla.');
  await pool?.end();
  if (failed) process.exit(2);
}

main().catch((err) => { console.error(err); process.exit(1); });
