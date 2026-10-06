/**
 * SAS de solo lectura, de un solo blob y de vida corta, para el archivo de
 * grabaciones (archived_files). El contenedor es privado: el Hub firma un
 * permiso de minutos cada vez que alguien abre un archivo, en vez de repartir
 * links permanentes.
 *
 * Firma "service SAS" a mano con HMAC-SHA256 (sin @azure/storage-blob), según
 * https://learn.microsoft.com/rest/api/storageservices/create-service-sas
 *
 * Variables de entorno:
 *   AZURE_STORAGE_ACCOUNT    — p. ej. sapiencearchivo9027
 *   AZURE_STORAGE_KEY        — key1 de la cuenta (base64)
 *   AZURE_ARCHIVE_CONTAINER  — opcional, default sharepoint-archivo
 */
import { createHmac } from 'node:crypto';

const SAS_VERSION = '2022-11-02';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable de entorno ${name}`);
  return v;
}

/** Segundos sin milisegundos: Azure rechaza fechas ISO con fracción. */
const isoNoMs = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

export function archiveBlobSasUrl(
  blobName: string,
  opts: { minutes?: number; downloadName?: string } = {},
): string {
  const account = requireEnv('AZURE_STORAGE_ACCOUNT');
  const key = requireEnv('AZURE_STORAGE_KEY');
  const container = process.env.AZURE_ARCHIVE_CONTAINER || 'sharepoint-archivo';

  // 5 min de holgura hacia atrás por desfase de reloj entre servidores.
  const start = isoNoMs(new Date(Date.now() - 5 * 60_000));
  const expiry = isoNoMs(new Date(Date.now() + (opts.minutes ?? 120) * 60_000));
  const disposition = opts.downloadName
    ? `attachment; filename*=UTF-8''${encodeURIComponent(opts.downloadName)}`
    : '';

  const stringToSign = [
    'r', // permisos
    start,
    expiry,
    `/blob/${account}/${container}/${blobName}`,
    '', // signedIdentifier
    '', // signedIP
    'https',
    SAS_VERSION,
    'b', // signedResource: blob
    '', // signedSnapshotTime
    '', // signedEncryptionScope
    '', // rscc
    disposition, // rscd
    '', // rsce
    '', // rscl
    '', // rsct
  ].join('\n');

  const sig = createHmac('sha256', Buffer.from(key, 'base64')).update(stringToSign, 'utf8').digest('base64');

  const q = new URLSearchParams({ sv: SAS_VERSION, st: start, se: expiry, sr: 'b', sp: 'r', spr: 'https', sig });
  if (disposition) q.set('rscd', disposition);
  const path = blobName.split('/').map(encodeURIComponent).join('/');
  return `https://${account}.blob.core.windows.net/${container}/${path}?${q.toString()}`;
}
