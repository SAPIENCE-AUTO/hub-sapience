import { columnas, type FilaRespuesta } from './tabla';
import type { Definicion } from './tipos';

// Mismo membrete que el Excel del tablero de reclutamiento (RecruitmentPage.tsx → exportRecruitmentExcel).
const LOGO_URL = 'https://qmqtjfhifzxvnhiyifyh.supabase.co/storage/v1/object/public/zite-uploads/branding/sapience-logo.png';
const LOGO_ASPECT = 816 / 203;
const TEAL = 'FF0F3D4C';
const SECCION_FONDO = 'FFE6EEF0';
const COLOR_RESULTADO: Record<string, string> = { Califica: 'FF257E55', 'No califica': 'FFD32222', Incompleta: 'FF8B93A1' };

/**
 * Arma el .xlsx de un formulario: una fila por persona, una columna por
 * pregunta, agrupadas por sección. No toca el DOM (se puede correr en Node
 * para probarlo); `descargarExcel` es la parte del navegador.
 */
export async function construirExcel(titulo: string, def: Definicion, filas: FilaRespuesta[]): Promise<ArrayBuffer> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Hub Sapience';
  wb.created = new Date();
  const ws = wb.addWorksheet('Respuestas');
  const cols = columnas(def, filas);
  const n = Math.max(cols.length, 4);

  try {
    const resp = await fetch(LOGO_URL);
    if (resp.ok) {
      const imgId = wb.addImage({ buffer: await resp.arrayBuffer(), extension: 'png' });
      ws.addImage(imgId, { tl: { col: 0.15, row: 0.12 }, ext: { width: 200, height: 200 / LOGO_ASPECT } });
    }
  } catch { /* sin logo si falla la descarga — no bloquea el Excel */ }

  ws.mergeCells(1, 1, 3, 2);
  ws.mergeCells(1, 3, 1, n);
  ws.mergeCells(2, 3, 2, n);
  const califican = filas.filter((f) => f.resultado.califica).length;
  const ahora = new Date();
  ws.getCell(1, 3).value = `Formulario — ${titulo}`;
  ws.getCell(1, 3).font = { bold: true, size: 15, color: { argb: TEAL } };
  ws.getCell(2, 3).value = `Descargado el ${ahora.toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Mexico_City' })} · ${filas.length} respuesta${filas.length === 1 ? '' : 's'} · ${califican} califica${califican === 1 ? '' : 'n'}`;
  ws.getCell(2, 3).font = { size: 10.5, color: { argb: 'FF6B7280' } };
  ws.getRow(1).height = 30;
  ws.getRow(2).height = 18;
  ws.getRow(3).height = 12;
  ws.mergeCells(4, 1, 4, n);
  ws.getCell(4, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL } };
  ws.getRow(4).height = 4;

  // Fila 5: sección (combinada sobre sus columnas). Fila 6: pregunta.
  const SECCION = 5;
  const ENCABEZADO = 6;
  let inicio = 0;
  cols.forEach((c, i) => {
    const fin = i === cols.length - 1 || cols[i + 1].seccion !== c.seccion;
    if (!fin) return;
    if (i > inicio) ws.mergeCells(SECCION, inicio + 1, SECCION, i + 1);
    const celda = ws.getCell(SECCION, inicio + 1);
    celda.value = c.seccion.toUpperCase();
    celda.font = { bold: true, size: 9, color: { argb: TEAL } };
    celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SECCION_FONDO } };
    celda.alignment = { vertical: 'middle' };
    inicio = i + 1;
  });
  ws.getRow(SECCION).height = 18;
  cols.forEach((c, i) => {
    const celda = ws.getCell(ENCABEZADO, i + 1);
    celda.value = c.titulo;
    celda.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL } };
    celda.alignment = { vertical: 'top', wrapText: true };
  });
  ws.getRow(ENCABEZADO).height = 48;
  ws.views = [{ state: 'frozen', xSplit: 2, ySplit: ENCABEZADO }];

  const borde = { style: 'hair' as const, color: { argb: 'FFE5E7EB' } };
  const largo = cols.map((c) => Math.min(c.titulo.length, 30));
  filas.forEach((f, r) => {
    cols.forEach((c, i) => {
      const v = c.valor(f);
      const celda = ws.getCell(ENCABEZADO + 1 + r, i + 1);
      celda.value = v ?? null;
      celda.border = { top: borde, bottom: borde, left: borde, right: borde };
      celda.alignment = { vertical: 'top' };
      if (c.titulo === 'Resultado' && typeof v === 'string') celda.font = { bold: true, color: { argb: COLOR_RESULTADO[v] ?? TEAL } };
      if (v !== undefined) largo[i] = Math.max(largo[i], String(v).length);
    });
  });
  cols.forEach((_, i) => { ws.getColumn(i + 1).width = Math.min(45, Math.max(12, largo[i] + 3)); });

  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

export async function descargarExcel(titulo: string, def: Definicion, filas: FilaRespuesta[]): Promise<void> {
  const buf = await construirExcel(titulo, def, filas);
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `formulario-${titulo.replace(/[^\w-]+/g, '_')}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
