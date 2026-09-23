import type { GetDealsOutputType } from 'zite-endpoints-sdk';

type Deal = GetDealsOutputType['deals'][0];

const COLUMNS: { key: keyof Deal; label: string; type?: 'date' }[] = [
  { key: 'dealName', label: 'Deal' },
  { key: 'client', label: 'Cliente' },
  { key: 'phase', label: 'Fase' },
  { key: 'statusPropuesta', label: 'Status propuesta' },
  { key: 'projectType', label: 'Tipo de proyecto' },
  { key: 'tematica', label: 'Temática' },
  { key: 'owner', label: 'Owner' },
  { key: 'gerente', label: 'Gerente' },
  { key: 'hechaPor', label: 'Hecha por' },
  { key: 'currency', label: 'Moneda' },
  { key: 'clientPrice', label: 'Precio cliente' },
  { key: 'quotedCost', label: 'Costo cotizado' },
  { key: 'taxesPct', label: '% Impuestos' },
  { key: 'retenciones', label: 'Retenciones' },
  { key: 'exchangeRate', label: 'Tipo de cambio' },
  { key: 'empresaOperadora', label: 'Empresa operadora' },
  { key: 'puntoDeContacto', label: 'Punto de contacto' },
  { key: 'fechaDeBrief', label: 'Fecha de brief', type: 'date' },
  { key: 'proposalDate', label: 'Fecha de propuesta', type: 'date' },
  { key: 'approvalDate', label: 'Fecha de aprobación', type: 'date' },
  { key: 'fechaPerdida', label: 'Fecha perdida', type: 'date' },
  { key: 'notes', label: 'Notas' },
];

// Los campos de fecha llegan del backend como string ISO ("2026-08-17" o con
// hora) — antes se escribían con String(v), que Excel guarda como texto
// (no se puede ordenar/filtrar/formatear como fecha). new Date(...) a secas
// interpreta "2026-08-17" como medianoche UTC y la corre un día hacia atrás
// en cualquier huso al oeste de UTC (mismo bug ya visto y corregido en
// ProjectHubLanding.tsx) — se arma la fecha en LOCAL a partir de sus partes.
function toExcelDate(iso: string): Date | null {
  const datePart = iso.split('T')[0];
  const m = datePart.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function cellValue(deal: Deal, key: keyof Deal, type: 'date' | undefined): string | number | Date {
  const v = deal[key] as unknown;
  if (v === null || v === undefined) return '';
  if (type === 'date' && typeof v === 'string') {
    const d = toExcelDate(v);
    if (d) return d;
  }
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'number') return v;
  return String(v);
}

// Mismo patrón 100%-client-side que exportRecruitmentExcel (RecruitmentPage.tsx) —
// exceljs cargado dinámicamente, sin ida y vuelta al servidor.
export async function exportDealsExcel(deals: Deal[]): Promise<number> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Hub Sapience';
  wb.created = new Date();
  const ws = wb.addWorksheet('Deals');

  const headers = COLUMNS.map(c => c.label);

  ws.mergeCells(1, 1, 1, headers.length);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = 'Comercial / Deals';
  titleCell.font = { bold: true, size: 15, color: { argb: 'FF0F3D4C' } };
  ws.getRow(1).height = 26;

  ws.mergeCells(2, 1, 2, headers.length);
  const subCell = ws.getCell(2, 1);
  const now = new Date();
  const fecha = now.toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Mexico_City' });
  const hora = now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Mexico_City' });
  subCell.value = `Exportado el ${fecha} a las ${hora} · ${deals.length} deal${deals.length === 1 ? '' : 's'}`;
  subCell.font = { size: 10.5, color: { argb: 'FF6B7280' } };
  ws.getRow(2).height = 16;

  const RULE_ROW = 3;
  ws.mergeCells(RULE_ROW, 1, RULE_ROW, headers.length);
  ws.getCell(RULE_ROW, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F3D4C' } };
  ws.getRow(RULE_ROW).height = 4;

  const HEADER_ROW = 4;
  const headerRow = ws.getRow(HEADER_ROW);
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F3D4C' } };
    cell.alignment = { vertical: 'middle' };
  });
  headerRow.height = 20;
  ws.views = [{ state: 'frozen', ySplit: HEADER_ROW }];

  const cellBorder = { style: 'hair' as const, color: { argb: 'FFE5E7EB' } };
  const colMaxLen = headers.map(h => h.length);

  let r = HEADER_ROW + 1;
  for (const deal of deals) {
    const dataRow = ws.getRow(r);
    COLUMNS.forEach((c, i) => {
      const v = cellValue(deal, c.key, c.type);
      const cell = dataRow.getCell(i + 1);
      cell.value = v;
      if (c.type === 'date' && v instanceof Date) cell.numFmt = 'dd/mm/yyyy';
      cell.border = { top: cellBorder, left: cellBorder, bottom: cellBorder, right: cellBorder };
      cell.font = { size: 9 };
      colMaxLen[i] = Math.max(colMaxLen[i], v instanceof Date ? 10 : String(v).length);
    });
    r++;
  }
  headers.forEach((h, i) => { ws.getColumn(i + 1).width = Math.min(48, Math.max(12, colMaxLen[i] + 4)); });

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `deals-${new Date().toISOString().slice(0, 10)}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
  return deals.length;
}
