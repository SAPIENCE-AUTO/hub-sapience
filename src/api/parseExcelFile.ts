import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { inflateRawSync, inflateSync } from 'zlib';

// ── CSV parser ─────────────────────────────────────────────────────────────────
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  for (const line of lines) {
    if (!line.trim()) { rows.push([]); continue; }
    const row: string[] = [];
    let i = 0;
    while (i < line.length) {
      if (line[i] === '"') {
        let field = ''; i++;
        while (i < line.length) {
          if (line[i] === '"' && line[i + 1] === '"') { field += '"'; i += 2; }
          else if (line[i] === '"') { i++; break; }
          else { field += line[i++]; }
        }
        row.push(field);
        if (line[i] === ',') i++;
      } else {
        let j = i;
        while (j < line.length && line[j] !== ',') j++;
        row.push(line.slice(i, j));
        i = j + 1;
      }
    }
    rows.push(row);
  }
  return rows;
}

// ── XLSX (ZIP + XML) parser ────────────────────────────────────────────────────
interface ZipEntry {
  filename: string;
  localOffset: number;
  compSize: number;
  compression: number;
}

/** Parse the ZIP central directory (always has correct sizes, even with data descriptors) */
function parseCentralDirectory(buf: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = [];

  // Find End of Central Directory record (PK\x05\x06) by scanning from end
  let eocdPos = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65536); i--) {
    if (buf[i] === 0x50 && buf[i+1] === 0x4B && buf[i+2] === 0x05 && buf[i+3] === 0x06) {
      eocdPos = i; break;
    }
  }
  if (eocdPos === -1) return entries;

  const cdOffset = buf.readUInt32LE(eocdPos + 16);
  let pos = cdOffset;

  while (pos + 46 < buf.length) {
    if (buf[pos] !== 0x50 || buf[pos+1] !== 0x4B || buf[pos+2] !== 0x01 || buf[pos+3] !== 0x02) break;
    const compression     = buf.readUInt16LE(pos + 10);
    const compSize        = buf.readUInt32LE(pos + 20);
    const fnLen           = buf.readUInt16LE(pos + 28);
    const extraLen        = buf.readUInt16LE(pos + 30);
    const commentLen      = buf.readUInt16LE(pos + 32);
    const localOffset     = buf.readUInt32LE(pos + 42);
    const filename        = buf.toString('utf8', pos + 46, pos + 46 + fnLen).replace(/\\/g, '/');
    entries.push({ filename, localOffset, compSize, compression });
    pos += 46 + fnLen + extraLen + commentLen;
  }
  return entries;
}

function extractEntry(buf: Buffer, entry: ZipEntry): string | null {
  const localFnLen    = buf.readUInt16LE(entry.localOffset + 26);
  const localExtraLen = buf.readUInt16LE(entry.localOffset + 28);
  const dataStart     = entry.localOffset + 30 + localFnLen + localExtraLen;
  if (dataStart + entry.compSize > buf.length || entry.compSize === 0) return null;
  const compressed = buf.slice(dataStart, dataStart + entry.compSize);
  try {
    const out = entry.compression === 0 ? compressed : inflateRawSync(compressed);
    return out.toString('utf8');
  } catch {
    try { return inflateSync(compressed).toString('utf8'); } catch { return null; }
  }
}

function getEntry(buf: Buffer, entries: ZipEntry[], path: string): string | null {
  const e = entries.find(x => x.filename === path);
  return e ? extractEntry(buf, e) : null;
}

function findEntry(buf: Buffer, entries: ZipEntry[], predicate: (name: string) => boolean): string | null {
  for (const e of entries) {
    if (predicate(e.filename)) {
      const content = extractEntry(buf, e);
      if (content) return content;
    }
  }
  return null;
}

function colLetterToIndex(col: string): number {
  let result = 0;
  for (const ch of col.toUpperCase()) result = result * 26 + (ch.charCodeAt(0) - 64);
  return result - 1;
}

function parseXlsx(buf: Buffer): string[][] {
  // Use central directory — always has correct sizes even with data descriptors
  const entries = parseCentralDirectory(buf);

  const ssXml = getEntry(buf, entries, 'xl/sharedStrings.xml');

  // Strategy 1: standard path
  let wsXml: string | null = getEntry(buf, entries, 'xl/worksheets/sheet1.xml');

  // Strategy 2: via workbook.xml.rels relationships
  if (!wsXml) {
    const relsXml = getEntry(buf, entries, 'xl/_rels/workbook.xml.rels');
    if (relsXml) {
      const targets: string[] = [];
      for (const m of relsXml.matchAll(/Type="[^"]*worksheet[^"]*"[^>]*Target="([^"]+)"/gi)) targets.push(m[1]);
      for (const m of relsXml.matchAll(/Target="([^"]+)"[^>]*Type="[^"]*worksheet[^"]*"/gi)) targets.push(m[1]);
      for (const target of targets) {
        const path = target.startsWith('xl/') ? target : `xl/${target.replace(/^\//,'')}`;
        wsXml = getEntry(buf, entries, path.replace(/\\/g, '/'));
        if (wsXml) break;
      }
    }
  }

  // Strategy 3: any entry containing "worksheet" in path (case-insensitive)
  if (!wsXml) {
    wsXml = findEntry(buf, entries, n => {
      const low = n.toLowerCase();
      return low.includes('worksheets/') && low.endsWith('.xml');
    });
  }

  // Strategy 4: any XML entry with sheetData content
  if (!wsXml) {
    wsXml = findEntry(buf, entries, n => n.endsWith('.xml') && !n.includes('_rels') && !n.includes('[Content'));
    if (wsXml && !wsXml.includes('<sheetData')) wsXml = null;
  }

  if (!wsXml) throw new Error('Archivo XLSX sin hoja de datos. Intenta exportar como CSV.');

  const sharedStrings: string[] = [];
  if (ssXml) {
    for (const m of ssXml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      let text = '';
      for (const t of m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)) text += t[1];
      sharedStrings.push(text);
    }
  }

  const result: string[][] = [];
  for (const rowM of wsXml.matchAll(/<row[^>]+r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const rowIdx = parseInt(rowM[1]) - 1;
    const cells = new Map<number, string>();
    for (const c of rowM[2].matchAll(/<c\s+r="([A-Z]+\d+)"([^>]*)>([\s\S]*?)<\/c>/g)) {
      const colPart = c[1].match(/^([A-Z]+)/)?.[1] ?? '';
      const colIdx = colLetterToIndex(colPart);
      const attrs = c[2], inner = c[3];
      let val = '';
      if (attrs.includes('t="s"')) {
        const v = inner.match(/<v>(\d+)<\/v>/);
        if (v) val = sharedStrings[parseInt(v[1])] ?? '';
      } else if (attrs.includes('t="inlineStr"')) {
        val = inner.match(/<t[^>]*>([^<]*)<\/t>/)?.[1] ?? '';
      } else {
        val = inner.match(/<v>([^<]*)<\/v>/)?.[1] ?? '';
      }
      cells.set(colIdx, val);
    }
    if (cells.size > 0) {
      while (result.length <= rowIdx) result.push([]);
      const maxCol = Math.max(...cells.keys());
      const row = Array(maxCol + 1).fill('');
      cells.forEach((v, k) => { row[k] = v; });
      result[rowIdx] = row;
    }
  }
  return result.filter(r => r && r.length > 0);
}

// ── Monday-style group & structure detection ───────────────────────────────────
const HEADER_INDICATORS = new Set(['name', 'nombre', 'nombres', 'participante', 'participantes']);
const SKIP_ROW_PREFIXES  = ['subitems', 'sub-items', 'sub items'];

function detectStructure(raw: string[][]): {
  groups: { name: string; rowIndices: number[] }[];
  headers: string[];
  rows: string[][];
  totalRows: number;
} {
  const groups: { name: string; rowIndices: number[] }[] = [];
  const dataRows: string[][] = [];
  let headers: string[] = [];
  let currentGroupIdx = -1;

  for (const row of raw) {
    if (!row || row.length === 0) continue;
    const first = (row[0] || '').trim();
    if (!first) continue;
    const firstLower = first.toLowerCase();
    const nonEmpty = row.slice(1).filter(v => v && v.trim()).length;

    if (HEADER_INDICATORS.has(firstLower)) {
      // Column header row — capture once
      if (headers.length === 0) headers = row.map(h => (h || '').trim());
    } else if (SKIP_ROW_PREFIXES.some(s => firstLower.startsWith(s))) {
      // Monday "Subitems" header rows — skip
    } else if (nonEmpty === 0 && first.length > 3) {
      // Group header: single non-empty cell in first column
      groups.push({ name: first, rowIndices: [] });
      currentGroupIdx = groups.length - 1;
    } else {
      const idx = dataRows.length;
      dataRows.push(row);
      if (currentGroupIdx >= 0) groups[currentGroupIdx].rowIndices.push(idx);
    }
  }

  // Fallback: first data row as headers
  if (headers.length === 0 && dataRows.length > 0) {
    headers = dataRows.shift()!.map(h => (h || '').trim());
    for (const g of groups) g.rowIndices = g.rowIndices.map(i => i - 1).filter(i => i >= 0);
  }

  return { groups, headers, rows: dataRows, totalRows: dataRows.length };
}

export default createEndpoint({
  authenticated: true,
  description: 'Download and parse an Excel (.xlsx) or CSV file, detecting Monday-style group sections',
  inputSchema: z.object({ fileUrl: z.string(), fileName: z.string() }),
  outputSchema: z.object({
    groups:    z.array(z.object({ name: z.string(), rowIndices: z.array(z.number()) })),
    headers:   z.array(z.string()),
    rows:      z.array(z.array(z.string())),
    totalRows: z.number(),
  }),
  execute: async ({ input }) => {
    const res = await fetch(input.fileUrl);
    if (!res.ok) throw new Error('No se pudo descargar el archivo');
    const buf = Buffer.from(await res.arrayBuffer());

    // Detect format by ZIP magic bytes or file extension
    const isZip = buf[0] === 0x50 && buf[1] === 0x4B;
    const nameLow = input.fileName.toLowerCase();

    let raw: string[][];
    if (isZip || nameLow.endsWith('.xlsx') || nameLow.endsWith('.xlsm')) {
      raw = parseXlsx(buf);
    } else {
      raw = parseCsv(buf.toString('utf8'));
    }

    return detectStructure(raw);
  },
});
