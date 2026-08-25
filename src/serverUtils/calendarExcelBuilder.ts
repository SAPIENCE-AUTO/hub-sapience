import ExcelJS from 'exceljs';

// Mismo logo y sistema de color que src/pages/RecruitmentPage.tsx (exportRecruitmentExcel) —
// duplicado a propósito: ese vive en el bundle del cliente (browser build de exceljs), este
// corre en el backend (Node), no comparten runtime así que no vale la pena forzar un módulo
// compartido para ~40 líneas de constantes.
const LOGO_URL = 'https://qmqtjfhifzxvnhiyifyh.supabase.co/storage/v1/object/public/zite-uploads/branding/sapience-logo.png';
const LOGO_ASPECT = 816 / 203;
const FONT_NAME = 'Aptos';

const GROUP_COLOR_HSL: Record<string, [number, number, number]> = {
  'red-1': [4, 85, 65], 'red-2': [4, 85, 55], 'red-3': [4, 82, 45], 'red-4': [4, 78, 37], 'red-5': [4, 72, 28],
  'orange-1': [25, 90, 65], 'orange-2': [25, 88, 55], 'orange-3': [25, 85, 45], 'orange-4': [25, 82, 37], 'orange-5': [25, 78, 28],
  'yellow-1': [47, 95, 62], 'yellow-2': [47, 92, 52], 'yellow-3': [47, 88, 43], 'yellow-4': [47, 84, 35], 'yellow-5': [47, 78, 27],
  'green-1': [142, 52, 60], 'green-2': [142, 56, 50], 'green-3': [142, 58, 40], 'green-4': [142, 56, 32], 'green-5': [142, 52, 24],
  'blue-1': [215, 82, 68], 'blue-2': [215, 80, 58], 'blue-3': [215, 78, 48], 'blue-4': [215, 76, 38], 'blue-5': [215, 72, 29],
  'purple-1': [265, 68, 68], 'purple-2': [265, 70, 58], 'purple-3': [265, 68, 48], 'purple-4': [265, 65, 38], 'purple-5': [265, 62, 29],
};
const DEFAULT_GROUP_HEX = '94A3B8';

function hslToHex([h, s, l]: [number, number, number]): string {
  const sN = s / 100, lN = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sN * Math.min(lN, 1 - lN);
  const f = (n: number) => lN - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (x: number) => Math.round(255 * x).toString(16).padStart(2, '0');
  return `${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`.toUpperCase();
}

function groupHex(colorId?: string | null): string {
  return colorId && GROUP_COLOR_HSL[colorId] ? hslToHex(GROUP_COLOR_HSL[colorId]) : DEFAULT_GROUP_HEX;
}

function contrastText(hex: string): string {
  const r = parseInt(hex.slice(0, 2), 16) / 255, g = parseInt(hex.slice(2, 4), 16) / 255, b = parseInt(hex.slice(4, 6), 16) / 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.6 ? '1F2937' : 'FFFFFF';
}

// Código de color por status — mismo criterio que ya se usó en el preview aprobado:
// "Realizada" se apaga a gris (ya no compite por atención), el resto conserva su urgencia.
const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  'Por realizar': { bg: 'FFDBEAFE', text: 'FF1D4ED8' },
  'Realizada': { bg: 'FFE5E7EB', text: 'FF6B7280' },
  'Reprogramada': { bg: 'FFFEF3C7', text: 'FF92400E' },
  'Caída': { bg: 'FFFEE2E2', text: 'FF991B1B' },
  'Cancelada': { bg: 'FFFEE2E2', text: 'FFB91C1C' },
  'Reposición': { bg: 'FFEDE9FE', text: 'FF5B21B6' },
};
const DONE_STATUS_VALUE = 'Realizada';

export interface CalendarExcelColumn {
  key: string;
  title: string;
  type: string;
  align?: string;
  /** JSON de opciones del tipo Select — si viene, la columna se vuelve un dropdown real en Excel. */
  optionsJson?: string | null;
}

export interface CalendarExcelGroup {
  groupId: string;
  groupName: string;
  colorId?: string | null;
  rows: Record<string, string | number>[];
}

export interface BuildCalendarExcelInput {
  calendarTitle: string;
  version: string;
  columns: CalendarExcelColumn[];
  groups: CalendarExcelGroup[];
}

export async function buildCalendarExcelBuffer(input: BuildCalendarExcelInput): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Hub Sapience';
  wb.created = new Date();
  const ws = wb.addWorksheet((input.calendarTitle || 'Calendario').slice(0, 31));

  const headers = input.columns.map(c => c.title);
  const colCount = headers.length;
  const totalActivities = input.groups.reduce((n, g) => n + g.rows.length, 0);
  const namedGroupCount = input.groups.filter(g => g.groupId !== 'ungrouped' && g.rows.length > 0).length;

  // ── Masthead: logo (proporción real 816×203) + título ──
  try {
    const resp = await fetch(LOGO_URL);
    if (resp.ok) {
      const buf = Buffer.from(await resp.arrayBuffer());
      const imgId = wb.addImage({ buffer: buf, extension: 'png' });
      ws.addImage(imgId, { tl: { col: 0.3, row: 0.12 }, ext: { width: 220, height: 220 / LOGO_ASPECT } });
    }
  } catch { /* sin logo si falla la descarga — no bloquea el export */ }

  ws.mergeCells(1, 1, 3, 2);
  ws.mergeCells(1, 3, 1, colCount);
  ws.mergeCells(2, 3, 2, colCount);
  ws.getCell(1, 3).value = `Calendario de Actividades — ${input.calendarTitle}`;
  ws.getCell(1, 3).font = { name: FONT_NAME, bold: true, size: 15, color: { argb: 'FF0F3D4C' } };
  const actWord = totalActivities === 1 ? 'actividad' : 'actividades';
  const grpWord = namedGroupCount === 1 ? 'grupo' : 'grupos';
  const now = new Date();
  const fechaStr = now.toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Mexico_City' });
  const horaStr  = now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Mexico_City' });
  ws.getCell(2, 3).value =
    `Actualizado el ${fechaStr} a las ${horaStr}` +
    ` · ${totalActivities} ${actWord}${namedGroupCount > 0 ? ` · ${namedGroupCount} ${grpWord}` : ''} · v${input.version}`;
  ws.getCell(2, 3).font = { name: FONT_NAME, size: 10.5, color: { argb: 'FF6B7280' } };
  ws.getRow(1).height = 30;
  ws.getRow(2).height = 18;
  ws.getRow(3).height = 12;

  const RULE_ROW = 4;
  ws.mergeCells(RULE_ROW, 1, RULE_ROW, colCount);
  ws.getCell(RULE_ROW, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F3D4C' } };
  ws.getRow(RULE_ROW).height = 4;

  const HEADER_ROW = 5;
  const headerRow = ws.getRow(HEADER_ROW);
  input.columns.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = c.title;
    cell.font = { name: FONT_NAME, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F3D4C' } };
    cell.alignment = { vertical: 'middle' };
  });
  headerRow.height = 20;
  ws.views = [{ state: 'frozen', ySplit: HEADER_ROW }];

  const cellBorder = { style: 'hair' as const, color: { argb: 'FFE5E7EB' } };
  const colMaxLen = headers.map(h => h.length);
  const titleColIndex = input.columns.findIndex(c => c.key === 'dinamica');
  const statusColIndex = input.columns.findIndex(c => c.title === 'Status');
  // Cualquier columna con optionsJson real se vuelve dropdown — no solo Status.
  const dropdownCols = input.columns
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => !!c.optionsJson);

  let r = HEADER_ROW + 1;
  for (const group of input.groups) {
    if (group.rows.length === 0) continue;

    const hex = groupHex(group.colorId);
    const contrast = contrastText(hex);
    const sectionRow = ws.getRow(r);
    ws.mergeCells(r, 1, r, colCount);
    const activityLabel = group.rows.length === 1 ? 'actividad' : 'actividades';
    sectionRow.getCell(1).value = {
      richText: [
        { font: { name: FONT_NAME, bold: true, size: 11, color: { argb: `FF${contrast}` } }, text: `●  ${group.groupName}` },
        { font: { name: FONT_NAME, size: 10, color: { argb: `FF${contrast}` } }, text: `   ·  ${group.rows.length} ${activityLabel}` },
      ],
    };
    sectionRow.getCell(1).alignment = { vertical: 'middle' };
    for (let c = 1; c <= colCount; c++) {
      ws.getCell(r, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${hex}` } };
    }
    sectionRow.height = 20;
    r++;

    for (const row of group.rows) {
      const dataRow = ws.getRow(r);
      const statusVal = statusColIndex >= 0 ? row[input.columns[statusColIndex].key] : undefined;
      const isDone = statusVal === DONE_STATUS_VALUE;

      input.columns.forEach((c, i) => {
        const v = row[c.key] ?? '';
        const cell = dataRow.getCell(i + 1);
        cell.value = v;
        cell.border = { top: cellBorder, left: cellBorder, bottom: cellBorder, right: cellBorder };
        cell.alignment = { wrapText: true, vertical: 'middle', horizontal: c.align === 'center' ? 'center' : 'left' };

        const baseFont = i === titleColIndex ? { name: FONT_NAME, bold: true, size: 9 } : { name: FONT_NAME, size: 9 };
        cell.font = isDone ? { ...baseFont, color: { argb: 'FF94A3B8' } } : baseFont;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };

        // La celda de Status se pinta con su propio código de color; el resto de la fila queda en blanco.
        if (i === statusColIndex && typeof v === 'string' && STATUS_STYLES[v]) {
          cell.font = { ...baseFont, bold: true, color: { argb: STATUS_STYLES[v].text } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STATUS_STYLES[v].bg } };
        }

        colMaxLen[i] = Math.max(colMaxLen[i], String(v).length);
      });
      dataRow.height = 46; // ≈ 3 renglones a 9pt — mismo alto para toda la fila

      for (const { c: dvCol, i: dvIdx } of dropdownCols) {
        try {
          const raw = JSON.parse(dvCol.optionsJson ?? '[]');
          const opts: string[] = (Array.isArray(raw) ? raw : [])
            .map((o: unknown) => (typeof o === 'string' ? o : (o as { label?: string })?.label ?? ''))
            .filter(Boolean);
          if (opts.length > 0) {
            dataRow.getCell(dvIdx + 1).dataValidation = {
              type: 'list',
              allowBlank: true,
              formulae: [`"${opts.join(',')}"`],
            };
          }
        } catch { /* optionsJson inválido — esa fila se queda sin dropdown, no truena el export */ }
      }

      r++;
    }
  }

  input.columns.forEach((c, i) => { ws.getColumn(i + 1).width = Math.min(48, Math.max(14, colMaxLen[i] + 4)); });
  // Piso extra en la columna 1 para que el logo (220px) siempre tenga aire dentro del
  // bloque A+B del masthead, incluso cuando el contenido real de "Dinámica" es corto.
  ws.getColumn(1).width = Math.max(ws.getColumn(1).width ?? 14, 26);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
