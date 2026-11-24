// Excel con los resultados de una sesión de Swipe: un libro de tres hojas. «Resumen» (los números de la sesión y cómo leer cada columna), «Resultados» (una fila por idea, con su lugar dentro del capítulo) y
// «Votos» (una fila por voto: quién, en qué idea, qué votó y cuánto tardó, para cruzarlo en tablas dinámicas). Los números son los MISMOS que ve el facilitador en pantalla (getSwipeResultadosSesion): aquí no se
// recalcula nada, solo se ordena y se pone en columnas.
//
// `armarLibroSwipe` no sabe de navegador (recibe la clase de exceljs): se prueba en Node (server/scripts/test-swipe-excel.ts). `exportSwipeResultadosExcel` hace lo del navegador: arma el libro y lo descarga,
// igual que exportDealsExcel (100% en el cliente, exceljs cargado al momento).

export interface IdeaResultado {
  id: string;
  titulo: string;
  descripcion?: string;
  imagenUrl?: string;
  totalVotos: number;
  potencial: number;
  descarte: number;
  superLikes: number;
  pctPotencial: number;
  score: number;
  avgMsDecision?: number;
  quadrante?: string;
}

export interface CapituloResultado {
  capituloId: string;
  capituloNombre: string;
  totalParticipantesVotaron: number;
  ideas: IdeaResultado[];
}

export interface VotoDeSesion {
  capituloId: string;
  capituloNombre: string;
  ideaId: string;
  ideaTitulo: string;
  alias: string;
  valor: string;
  msDecision?: number;
  createdAt: string;
}

export interface DatosExcelSwipe {
  sesionNombre: string;
  cliente?: string;
  codigo?: string;
  /** Participantes que entraron a la sesión (el detalle de la sesión); si no se pasa, se cuentan los que votaron. */
  participantes?: number;
  capitulos: CapituloResultado[];
  votos: VotoDeSesion[];
  /** Cuándo se exporta (para el encabezado y el nombre del archivo); por omisión, ahora. */
  generado?: Date;
}

// Los mismos nombres que muestra la pantalla (QUADRANTE_META en SwipeResultsProjection.tsx) y la tarjeta del participante (Potencial, Descarte, Super like).
export const CUADRANTE_ETIQUETA: Record<string, string> = {
  consenso_rapido: 'Consenso rápido',
  convence_cuesta: 'Convence, cuesta pensarlo',
  rechazo_inmediato: 'Rechazo inmediato',
  duda_genuina: 'Duda genuina',
};
export const VOTO_ETIQUETA: Record<string, string> = { potencial: 'Potencial', descarte: 'Descarte', super: 'Super like' };

const TEAL = 'FF0F3D4C';
const GRIS = 'FF6B7280';
const BORDE = { style: 'hair' as const, color: { argb: 'FFE5E7EB' } };
const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const ZONA = 'America/Mexico_City';

/** Excel no sabe de husos horarios: la hora de México se escribe como si fuera la del reloj de Excel (si no, saldría la de UTC, seis horas adelantada). */
export function comoHoraDeMexico(iso: string): Date | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(d);
  const n = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value);
  return new Date(Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second')));
}

/** «Swipe - WS Norte (2026-11-24).xlsx», sin los caracteres que un nombre de archivo no admite. */
export function nombreArchivoSwipe(sesionNombre: string, fecha: Date = new Date()): string {
  const limpio = sesionNombre.replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim() || 'sesión';
  const dia = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(fecha);
  return `Swipe - ${limpio.slice(0, 80)} (${dia}).xlsx`;
}

/** Lo que falta se deja VACÍO de verdad (null), no como texto vacío: así el filtro «Vacías» y los promedios de Excel lo tratan como lo que es. */
const segundos = (ms?: number): number | null => (ms === undefined || ms === null ? null : Math.round((ms / 1000) * 10) / 10);

type Fila = (string | number | Date | null | { text: string; hyperlink: string })[];

function tabla(ws: any, encabezados: string[], filas: Fila[], opciones: { anchos: number[]; formatos?: Record<number, string>; envolver?: number[] }) {
  const cabecera = ws.getRow(1);
  encabezados.forEach((h, i) => {
    const c = cabecera.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL } };
    c.alignment = { vertical: 'middle', wrapText: true };
  });
  cabecera.height = 32;
  filas.forEach((fila, r) => {
    const row = ws.getRow(r + 2);
    fila.forEach((v, i) => {
      const c = row.getCell(i + 1);
      c.value = v as any;
      c.font = typeof v === 'object' && v !== null && 'hyperlink' in v ? { size: 10, underline: true, color: { argb: 'FF027495' } } : { size: 10 };
      c.border = { top: BORDE, left: BORDE, bottom: BORDE, right: BORDE };
      c.alignment = { vertical: 'top', wrapText: !!opciones.envolver?.includes(i + 1) };
      if (opciones.formatos?.[i + 1]) c.numFmt = opciones.formatos[i + 1];
    });
  });
  opciones.anchos.forEach((a, i) => { ws.getColumn(i + 1).width = a; });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  if (filas.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: filas.length + 1, column: encabezados.length } };
}

/** Arma el libro (sin descargarlo). `ExcelJS` es la clase de exceljs: así sirve igual en el navegador y en las pruebas de Node. */
export function armarLibroSwipe(ExcelJS: any, datos: DatosExcelSwipe): any {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Hub Sapience';
  wb.created = datos.generado ?? new Date();
  const generado = datos.generado ?? new Date();

  const ideas = datos.capitulos.reduce((a, c) => a + c.ideas.length, 0);
  const quienesVotaron = new Set(datos.votos.map((v) => v.alias)).size;
  const participantes = datos.participantes ?? quienesVotaron;

  // ── Resumen ────────────────────────────────────────────────────────────────
  const rs = wb.addWorksheet('Resumen');
  rs.getColumn(1).width = 30;
  rs.getColumn(2).width = 96;
  rs.getCell('A1').value = `Swipe: ${datos.sesionNombre}`;
  rs.getCell('A1').font = { bold: true, size: 15, color: { argb: TEAL } };
  rs.getRow(1).height = 26;
  const fecha = generado.toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric', timeZone: ZONA });
  const hora = generado.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: ZONA });
  rs.getCell('A2').value = [datos.cliente, datos.codigo ? `código ${datos.codigo}` : '', `exportado el ${fecha} a las ${hora}`].filter(Boolean).join(', ');
  rs.getCell('A2').font = { size: 10.5, color: { argb: GRIS } };

  const cifras: [string, number][] = [
    ['Capítulos', datos.capitulos.length], ['Ideas', ideas], ['Participantes', participantes], ['Participantes que votaron', quienesVotaron], ['Votos', datos.votos.length],
  ];
  cifras.forEach(([etiqueta, valor], i) => {
    const fila = 4 + i;
    rs.getCell(fila, 1).value = etiqueta;
    rs.getCell(fila, 1).font = { bold: true, size: 10.5 };
    rs.getCell(fila, 2).value = valor;
    rs.getCell(fila, 2).alignment = { horizontal: 'left' };
    rs.getCell(fila, 2).font = { size: 10.5 };
  });

  // Los títulos de sección empiezan con «Cómo»; el resto son «término → qué significa».
  const guia: [string, string][] = [
    ['Cómo leer «Resultados»', ''],
    ['Lugar', 'Posición de la idea dentro de su capítulo, de mayor a menor score. Las ideas de capítulos distintos no se comparan entre sí.'],
    ['Votos', 'Cuántas personas votaron esa idea.'],
    ['Potencial', 'Votos a favor: los de «Potencial» más los «Super like» (un super like también cuenta como a favor).'],
    ['Descarte', 'Votos en contra.'],
    ['Super likes', 'Cuántos de los votos a favor fueron super like.'],
    ['% potencial', 'Potencial ÷ (Potencial + Descarte). Queda vacío si nadie votó la idea.'],
    ['Score', '% potencial + 50 × (super likes ÷ participantes que votaron en el capítulo). Sirve para ordenar; no es un porcentaje. Queda vacío si nadie votó la idea.'],
    ['Tiempo promedio (s)', 'Segundos que tardaron en decidir, en promedio.'],
    ['Cuadrante', 'Cruza el % potencial con la rapidez: «Consenso rápido» = 50% o más a favor y decisión más rápida que la mediana de su capítulo; «Convence, cuesta pensarlo» = 50% o más a favor pero más lenta; «Rechazo inmediato» = menos de 50% y rápida; «Duda genuina» = menos de 50% y lenta.'],
    ['', ''],
    ['Cómo leer «Votos»', 'Una fila por voto, en el orden de la sesión. Participante es el alias con el que entró cada persona. La hora es la de México.'],
    ['Capítulo, Lugar e Idea', 'Van igual que en «Resultados». Si dos ideas de un capítulo se llaman igual, Capítulo + Lugar dice cuál es cuál; su descripción está en «Resultados».'],
  ];
  guia.forEach(([titulo, texto], i) => {
    const fila = 10 + i;
    const seccion = titulo.startsWith('Cómo');
    const a = rs.getCell(fila, 1); const b = rs.getCell(fila, 2);
    a.value = titulo; b.value = texto;
    a.font = seccion ? { bold: true, size: 11, color: { argb: TEAL } } : { bold: true, size: 10 };
    b.font = { size: 10 };
    b.alignment = { wrapText: true, vertical: 'top' };
    a.alignment = { vertical: 'top', wrapText: true };
  });

  // ── Resultados ─────────────────────────────────────────────────────────────
  // Una idea que nadie votó no tiene % ni score (sería 0 de 0): se deja vacío, no en «0%», para que un promedio o una tabla dinámica no la cuenten como rechazo total.
  const filasResultados: Fila[] = [];
  const lugarDeIdea = new Map<string, number>();
  for (const cap of datos.capitulos) {
    cap.ideas.forEach((idea, i) => {
      lugarDeIdea.set(idea.id, i + 1);
      filasResultados.push([
        cap.capituloNombre, i + 1, idea.titulo, idea.descripcion || null, idea.totalVotos, idea.potencial, idea.descarte, idea.superLikes,
        idea.totalVotos > 0 ? idea.pctPotencial / 100 : null, idea.totalVotos > 0 ? idea.score : null, segundos(idea.avgMsDecision), idea.quadrante ? (CUADRANTE_ETIQUETA[idea.quadrante] ?? idea.quadrante) : null,
        idea.imagenUrl ? { text: 'Ver imagen', hyperlink: idea.imagenUrl } : null,
      ]);
    });
  }
  tabla(wb.addWorksheet('Resultados'),
    ['Capítulo', 'Lugar', 'Idea', 'Descripción', 'Votos', 'Potencial', 'Descarte', 'Super likes', '% potencial', 'Score', 'Tiempo promedio (s)', 'Cuadrante', 'Imagen'],
    filasResultados,
    { anchos: [24, 8, 38, 60, 9, 11, 10, 11, 12, 9, 14, 26, 12], formatos: { 9: '0%', 11: '0.0' }, envolver: [3, 4] });

  // ── Votos ──────────────────────────────────────────────────────────────────
  // El «Lugar» es el mismo de «Resultados»: hay talleres donde varias ideas de un capítulo llevan el mismo nombre (solo cambia la descripción) y, sin el lugar, una tabla dinámica las juntaría en una.
  const filasVotos: Fila[] = datos.votos.map((v) => [
    v.capituloNombre, lugarDeIdea.get(v.ideaId) ?? null, v.ideaTitulo, v.alias, VOTO_ETIQUETA[v.valor] ?? v.valor, segundos(v.msDecision), comoHoraDeMexico(v.createdAt) ?? v.createdAt,
  ]);
  tabla(wb.addWorksheet('Votos'),
    ['Capítulo', 'Lugar', 'Idea', 'Participante', 'Voto', 'Tiempo de decisión (s)', 'Hora'],
    filasVotos,
    { anchos: [24, 8, 42, 22, 12, 14, 18], formatos: { 6: '0.0', 7: 'dd/mm/yyyy hh:mm' }, envolver: [3] });

  return wb;
}

/** Arma el libro y lo descarga (navegador). Devuelve cuántas ideas y cuántos votos salieron. */
export async function exportSwipeResultadosExcel(datos: DatosExcelSwipe): Promise<{ ideas: number; votos: number }> {
  const ExcelJS = (await import('exceljs')).default;
  const generado = datos.generado ?? new Date();
  const wb = armarLibroSwipe(ExcelJS, { ...datos, generado });
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: TIPO_XLSX });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombreArchivoSwipe(datos.sesionNombre, generado);
  a.click();
  URL.revokeObjectURL(url);
  return { ideas: datos.capitulos.reduce((s, c) => s + c.ideas.length, 0), votos: datos.votos.length };
}
