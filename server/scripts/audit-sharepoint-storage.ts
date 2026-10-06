// Auditoría de almacenamiento de SharePoint/OneDrive vía Microsoft Graph.
//
// Solo lectura: no mueve, copia ni borra nada. Sirve para saber QUÉ sitios u
// OneDrives están llenando la cuota del tenant (10,655 GB de 1,444 GB
// reportados en el admin center, sept 2026) antes de decidir qué migrar a
// otro storage (Blob, S3, lo que sea).
//
// Dos caminos, en este orden:
//
//   1. El reporte agregado de Graph (`getSharePointSiteUsageDetail` /
//      `getOneDriveUsageAccountDetail`), que ya trae `Storage Used` por sitio
//      sin tener que recorrer nada. Necesita el permiso de aplicación
//      `Reports.Read.All` — HOY NO está en la lista de permisos otorgados
//      (ver server/microsoft/README.md, Paso 3: Mail.Send, Calendars.ReadWrite,
//      Files.ReadWrite.All, Group.Read.All, + ChannelSettings.ReadWrite.All).
//      Si falta, el script lo dice explícito y cae al plan B.
//
//   2. Recorrer sitios uno por uno con `/sites?search=*` + `/sites/{id}/drive`,
//      usando `drive.quota` (ya viene calculado por SharePoint, no hay que
//      sumar archivo por archivo). Enumerar sitios normalmente necesita
//      `Sites.Read.All`, que tampoco está otorgado hoy — puede fallar igual.
//
// Si ambos caminos fallan por 403, el permiso que falta queda impreso con
// instrucciones (mismo Paso 3 del README: Azure AD → App registrations →
// Hub Sapience → API permissions → Add a permission → Application → el
// permiso indicado → Grant admin consent for Sapience).
//
// Uso:
//   npx tsx --env-file=../.env --env-file=../.env.local audit-sharepoint-storage.ts [--onedrive] [--top 25]

const args = process.argv.slice(2);
const includeOneDrive = args.includes('--onedrive');
const topArgIdx = args.indexOf('--top');
const TOP_N = topArgIdx >= 0 ? Number(args[topArgIdx + 1]) || 25 : 25;

for (const name of ['MS_TENANT_ID', 'MS_CLIENT_ID', 'MS_CLIENT_SECRET']) {
  if (!process.env[name]) {
    console.error(`Falta ${name} — ver server/microsoft/README.md.`);
    process.exit(1);
  }
}

const GiB = 1024 ** 3;
const fmtGiB = (bytes: number) => (bytes / GiB).toFixed(2);

interface SiteUsage { label: string; url: string; usedBytes: number; allocatedBytes: number }

async function getGraphToken(): Promise<string> {
  const url = `https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID!,
    client_secret: process.env.MS_CLIENT_SECRET!,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  const resp = await fetch(url, { method: 'POST', body });
  if (!resp.ok) throw new Error(`No se pudo autenticar con Graph (${resp.status}): ${await resp.text()}`);
  const json = await resp.json();
  return json.access_token;
}

class GraphPermissionError extends Error {
  constructor(readonly permission: string, readonly detail: string) {
    super(`Falta el permiso de aplicación "${permission}" (o falta admin consent). Detalle: ${detail.slice(0, 200)}`);
  }
}

/** GET con reintento en 429 (respeta Retry-After) y traducción de 403 a un error legible. */
async function graphGet(token: string, url: string, permissionHint: string): Promise<Response> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (resp.status === 429 || resp.status === 503) {
      const wait = Number(resp.headers.get('Retry-After') ?? '2') * 1000;
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (resp.status === 403) {
      throw new GraphPermissionError(permissionHint, await resp.text().catch(() => ''));
    }
    return resp;
  }
  throw new Error(`Graph sigue respondiendo 429/503 tras varios reintentos: ${url}`);
}

/** Parser CSV mínimo (RFC4180: comillas dobles, comas dentro de comillas). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || r[0] !== '');
}

async function tryUsageReport(token: string, endpoint: string, label: string): Promise<SiteUsage[] | null> {
  let resp: Response;
  try {
    resp = await graphGet(token, `https://graph.microsoft.com/v1.0/reports/${endpoint}(period='D7')`, 'Reports.Read.All');
  } catch (err) {
    if (err instanceof GraphPermissionError) {
      console.warn(`⚠️  ${label}: ${err.message}`);
      return null;
    }
    throw err;
  }
  if (!resp.ok) {
    console.warn(`⚠️  ${label}: respuesta ${resp.status}, se ignora este reporte.`);
    return null;
  }
  const rows = parseCsv(await resp.text());
  const header = rows[0]?.map((h) => h.trim()) ?? [];
  const idx = (name: string) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const iUsed = idx('Storage Used (Byte)');
  const iAllocated = idx('Storage Allocated (Byte)');
  const iUrl = idx('Site URL');
  const iOwner = idx('Owner Display Name');
  if (iUsed < 0 || iUrl < 0) {
    console.warn(`⚠️  ${label}: no encontré las columnas esperadas en el CSV, se ignora.`);
    return null;
  }
  return rows.slice(1).map((r) => ({
    label: r[iOwner] || r[iUrl],
    url: r[iUrl],
    usedBytes: Number(r[iUsed] || 0),
    allocatedBytes: Number(r[iAllocated] || 0),
  }));
}

async function* paginate(token: string, firstUrl: string, permissionHint: string) {
  let url: string | undefined = firstUrl;
  while (url) {
    const resp = await graphGet(token, url, permissionHint);
    if (!resp.ok) throw new Error(`${resp.status} en ${url}: ${await resp.text().catch(() => '')}`);
    const json = await resp.json();
    for (const item of json.value ?? []) yield item;
    url = json['@odata.nextLink'];
  }
}

async function crawlSites(token: string): Promise<SiteUsage[] | null> {
  const results: SiteUsage[] = [];
  try {
    let n = 0;
    for await (const site of paginate(
      token,
      'https://graph.microsoft.com/v1.0/sites?search=*&$select=id,displayName,webUrl&$top=100',
      'Sites.Read.All',
    )) {
      n++;
      if (n % 25 === 0) console.log(`  ...${n} sitios revisados`);
      const driveResp = await graphGet(
        token,
        `https://graph.microsoft.com/v1.0/sites/${site.id}/drive?$select=quota,webUrl`,
        'Sites.Read.All',
      );
      if (!driveResp.ok) continue; // sitio sin biblioteca de documentos (raro pero pasa)
      const drive = await driveResp.json();
      const used = drive.quota?.used ?? 0;
      const total = drive.quota?.total ?? 0;
      results.push({ label: site.displayName || site.webUrl, url: site.webUrl, usedBytes: used, allocatedBytes: total });
    }
  } catch (err) {
    if (err instanceof GraphPermissionError) {
      console.warn(`⚠️  Recorrido de sitios: ${err.message}`);
      return results.length ? results : null;
    }
    throw err;
  }
  return results;
}

async function crawlOneDrives(token: string): Promise<SiteUsage[] | null> {
  const results: SiteUsage[] = [];
  try {
    let n = 0;
    for await (const user of paginate(
      token,
      'https://graph.microsoft.com/v1.0/users?$select=id,displayName,mail&$top=100',
      'User.Read.All',
    )) {
      n++;
      if (n % 25 === 0) console.log(`  ...${n} usuarios revisados`);
      const driveResp = await fetch(`https://graph.microsoft.com/v1.0/users/${user.id}/drive?$select=quota,webUrl`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!driveResp.ok) continue; // sin OneDrive aprovisionado
      const drive = await driveResp.json();
      const used = drive.quota?.used ?? 0;
      const total = drive.quota?.total ?? 0;
      if (used > 0) results.push({ label: user.displayName || user.mail, url: drive.webUrl, usedBytes: used, allocatedBytes: total });
    }
  } catch (err) {
    if (err instanceof GraphPermissionError) {
      console.warn(`⚠️  Recorrido de OneDrives: ${err.message}`);
      return results.length ? results : null;
    }
    throw err;
  }
  return results;
}

function printTop(title: string, items: SiteUsage[], topN: number) {
  const sorted = [...items].sort((a, b) => b.usedBytes - a.usedBytes);
  const total = items.reduce((s, i) => s + i.usedBytes, 0);
  console.log(`\n=== ${title} — total ${fmtGiB(total)} GiB en ${items.length} sitio(s) ===`);
  console.log('GiB usado'.padEnd(12) + 'GiB asignado'.padEnd(14) + 'Sitio / dueño / URL');
  for (const s of sorted.slice(0, topN)) {
    console.log(fmtGiB(s.usedBytes).padEnd(12) + fmtGiB(s.allocatedBytes).padEnd(14) + `${s.label} — ${s.url}`);
  }
}

async function main() {
  const token = await getGraphToken();

  console.log('Intentando reporte agregado de Graph (getSharePointSiteUsageDetail)...');
  const spReport = await tryUsageReport(token, 'getSharePointSiteUsageDetail', 'Reporte de sitios SharePoint');

  let odReport: SiteUsage[] | null = null;
  if (includeOneDrive) {
    console.log('Intentando reporte agregado de Graph (getOneDriveUsageAccountDetail)...');
    odReport = await tryUsageReport(token, 'getOneDriveUsageAccountDetail', 'Reporte de OneDrive');
  }

  let sites = spReport;
  if (!sites) {
    console.log('\nSin Reports.Read.All — recorriendo sitios uno por uno (más lento, puede tardar varios minutos)...');
    sites = await crawlSites(token);
  }

  let onedrives = odReport;
  if (includeOneDrive && !onedrives) {
    console.log('\nSin Reports.Read.All — recorriendo OneDrives uno por uno...');
    onedrives = await crawlOneDrives(token);
  }

  if (!sites && !onedrives) {
    console.error(
      '\n❌ No se pudo leer nada. Hace falta agregar en Azure AD → App registrations → Hub Sapience → ' +
      'API permissions → Add a permission → Application, alguno de: Reports.Read.All (recomendado, un solo ' +
      'reporte con todo) o Sites.Read.All + User.Read.All (para el recorrido manual). Luego "Grant admin ' +
      'consent for Sapience" — igual que el Paso 3 de server/microsoft/README.md.',
    );
    process.exit(1);
  }

  if (sites) printTop('Sitios de SharePoint (equipos, proyectos, etc.)', sites, TOP_N);
  if (onedrives) printTop('OneDrive personales', onedrives, TOP_N);

  const grandTotal = (sites ?? []).reduce((s, i) => s + i.usedBytes, 0) + (onedrives ?? []).reduce((s, i) => s + i.usedBytes, 0);
  console.log(`\nTotal combinado detectado: ${fmtGiB(grandTotal)} GiB (el admin center reportó 10,655.43 GB — compara para ver si esto cubrió todo).`);
}

main().catch((err) => { console.error(err); process.exit(1); });
