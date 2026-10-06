// Arma el Word de la guía sobre assets/plantilla-guia.docx (encabezado con el logo de Sapience,
// estilos con Source Sans Pro y la viñeta de la agencia, numId 18). Funciones puras: sirven igual
// en Node que en el navegador. El cuerpo reemplaza {{BODY}} en word/document.xml.
//
// guia = { proyecto, tipo, duracion, tema?, muestra: string[], bloques: [{ nombre, minutos, objetivos[] }],
//          guia: [{ moderador, secciones: [{ subtema, intro?, preguntas: (string | { texto, sub[] })[], notas[] }] } | null] }
// (También acepta la forma del generador original, con muestra y bloques dentro de `roadmap`.)

const FONT = 'Source Sans Pro';
const SEMI = 'Source Sans Pro SemiBold';
const W = 9019;   // ancho útil de la plantilla (A4 con márgenes de 1440)

const esc = (s) => String(s ?? '')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')   // XML no los admite
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Los hijos de rPr y pPr van en el orden del esquema de Word.
function r(text, o = {}) {
  const f = o.semi ? SEMI : FONT;
  const sz = o.sz || 16;
  return `<w:r><w:rPr><w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:cs="${f}"/>${o.b ? '<w:b/><w:bCs/>' : ''}${o.i ? '<w:i/><w:iCs/>' : ''}`
    + `${o.color ? `<w:color w:val="${o.color}"/>` : ''}<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>${o.u ? '<w:u w:val="single"/>' : ''}`
    + `<w:lang w:val="es-MX"/></w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}

function p(runs, o = {}) {
  let ppr = '';
  if (o.list !== undefined) ppr += '<w:pStyle w:val="ListParagraph"/>';
  if (o.keepNext) ppr += '<w:keepNext/>';
  if (o.pageBreakBefore) ppr += '<w:pageBreakBefore/>';
  if (o.list !== undefined) ppr += `<w:numPr><w:ilvl w:val="${o.list}"/><w:numId w:val="18"/></w:numPr>`;
  ppr += `<w:spacing w:before="${o.before ?? 0}" w:after="${o.after ?? 0}"/>`;
  if (o.list === 0) ppr += '<w:ind w:left="595" w:hanging="238"/><w:contextualSpacing w:val="0"/>';
  if (o.list === 1) ppr += '<w:ind w:left="1060" w:hanging="238"/><w:contextualSpacing w:val="0"/>';
  if (o.center) ppr += '<w:jc w:val="center"/>';
  return `<w:p><w:pPr>${ppr}</w:pPr>${Array.isArray(runs) ? runs.join('') : runs}</w:p>`;
}
const empty = () => p(r(''));

/** **negritas** dentro del texto. */
function rich(text, base = {}) {
  return String(text ?? '').split(/(\*\*[^*]+\*\*)/g).filter(Boolean)
    .map((s) => (s.startsWith('**') && s.endsWith('**') ? r(s.slice(2, -2), { ...base, b: true }) : r(s, base))).join('');
}

const borders = '<w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="262626"/><w:left w:val="single" w:sz="4" w:space="0" w:color="262626"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="262626"/><w:right w:val="single" w:sz="4" w:space="0" w:color="262626"/></w:tcBorders>';
const tblPr = (w) => `<w:tblPr><w:tblW w:w="${w}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="110" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="110" w:type="dxa"/></w:tblCellMar></w:tblPr>`;
function tc(content, w, o = {}) {
  return `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${borders}${o.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.fill}"/>` : ''}<w:vAlign w:val="${o.v || 'top'}"/></w:tcPr>${content || empty()}</w:tc>`;
}

const limpio = (xs) => (xs || []).map((x) => String(x ?? '').trim()).filter(Boolean);

function blockTable(n, nombre, minutos, g) {
  const head = p([r(`${n}. ${nombre || ''} `, { b: true, color: 'FFFFFF', sz: 18 }), r(`(${minutos} min.)`, { color: 'FFFFFF', sz: 13 })], { keepNext: true });
  let body = '';
  if (g?.moderador) body += p([r('Moderador: ', { semi: true, sz: 18 }), r(g.moderador, { i: true })], { after: 60 });
  (g?.secciones || []).forEach((s, si) => {
    if (s.subtema) body += p(r(s.subtema, { semi: true, b: true, sz: 17 }), { before: si === 0 && !g.moderador ? 0 : 200, keepNext: true });
    if (s.intro) body += p(rich(s.intro, { i: true }), { before: 60 });
    for (const q of s.preguntas || []) {
      body += p(rich(typeof q === 'string' ? q : q.texto), { list: 0, before: 100 });
      if (q && typeof q === 'object' && Array.isArray(q.sub)) for (const sb of q.sub) body += p(rich(sb), { list: 1, before: 40 });
    }
    for (const nt of limpio(s.notas)) body += p([r('Nota: ', { b: true, i: true, color: '595959' }), r(nt, { i: true, color: '595959' })], { before: 100 });
  });
  if (!body) body = p(r('(Bloque por escribir)', { i: true, color: '595959' }));
  return `<w:tbl>${tblPr(W)}<w:tblGrid><w:gridCol w:w="${W}"/></w:tblGrid><w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="341"/></w:trPr>${tc(head, W, { fill: '262626', v: 'center' })}</w:tr><w:tr>${tc(body, W)}</w:tr></w:tbl>${empty()}`;
}

function roadmapTable(bloques) {
  const ws = [600, 2700, 900, 4819];
  const hdr = ['', 'Bloque temático', 'Tiempo', 'Objetivos'].map((h, i) => tc(p(r(h, { b: true, color: 'FFFFFF', sz: 16 }), { center: true }), ws[i], { fill: '262626', v: 'center' })).join('');
  let rows = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${hdr}</w:tr>`;
  bloques.forEach((b, i) => {
    const obj = limpio(b.objetivos).map((o) => p(r(o, { sz: 14 }), { list: 0, before: 20 })).join('') || empty();
    rows += `<w:tr><w:trPr><w:cantSplit/></w:trPr>${tc(p(r(String(i + 1), { b: true, sz: 24 }), { center: true }), ws[0], { v: 'center' })}`
      + `${tc(p(r(b.nombre, { b: true, sz: 16 })), ws[1], { v: 'center' })}${tc(p(r(`${b.minutos} min.`, { sz: 14 })), ws[2], { v: 'center' })}${tc(obj, ws[3])}</w:tr>`;
  });
  return `<w:tbl>${tblPr(W)}<w:tblGrid>${ws.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${rows}</w:tbl>`;
}

function sessionWord(tipo) {
  const t = String(tipo || '').toLowerCase();
  if (t.includes('entrevista')) return 'la entrevista';
  if (t.includes('tríada') || t.includes('triada')) return 'la tríada';
  if (t.includes('mini')) return 'el mini grupo';
  return 'la sesión de grupo';
}

/** El XML del cuerpo (lo que reemplaza {{BODY}}). */
export function armarCuerpo(guia) {
  const muestra = limpio(guia.roadmap?.muestra ?? guia.muestra);
  const bloques = guia.roadmap?.bloques ?? guia.bloques ?? [];
  const escritos = guia.guia ?? [];
  let x = '';
  x += p(r('CARÁTULA', { b: true, sz: 28 }), { center: true, after: 200 });
  if (guia.proyecto) x += p(r(guia.proyecto, { semi: true, sz: 22 }), { center: true, after: 240 });
  if (guia.tema?.trim()) x += p([r('Tema: ', { b: true, sz: 16 }), ...[rich(guia.tema.trim(), { sz: 16 })]], { after: 160 });
  if (muestra.length) {
    x += p(r('Muestra', { i: true, sz: 26 }), { after: 80 });
    for (const m of muestra) {
      const mm = /\*\*/.test(m) ? m : m.replace(/^(\d+\s+(?:sesi[oó]n(?:es)?(?: de grupo)?|entrevistas?(?: a profundidad)?|tr[ií]adas?|mini ?grupos?)[^,]{0,25}?\bcon)\b/i, '**$1**');
      x += p(rich(mm, { sz: 16 }), { list: 0, before: 60 });
    }
  }
  x += p(r('—'.repeat(40), { color: 'BFBFBF', sz: 14 }), { before: 200, after: 200 });
  x += p(r('ROAD MAP:', { b: true, sz: 22 }), { after: 80 });
  x += p(r(`A continuación, se muestra el flujo general de ${sessionWord(guia.tipo)}. Estos bloques temáticos se irán abordando en el orden propuesto, pero el contenido de cada bloque se irá adecuando en función del desarrollo de la discusión.`, { sz: 16 }), { after: 160 });
  x += roadmapTable(bloques);
  x += p(r('Desarrollo de guía de tópicos', { b: true, sz: 28 }), { pageBreakBefore: true, center: true, after: 200 });
  x += p(r('Los bloques temáticos que se muestran a continuación contienen una serie de ejercicios y preguntas que buscan respuestas abiertas.', { sz: 17 }), { after: 60 });
  for (const t of [
    'Las preguntas expresadas son ejemplos de cómo abordar la temática, pero pueden modificarse de acuerdo con el flujo natural de la conversación.',
    'NO son preguntas cerradas que deban contestarse una a una.',
    'Algunas preguntas pueden omitirse porque la respuesta está implícita o surge de manera espontánea en la conversación.',
    'Algunas preguntas pueden postergarse, con el fin de ir hilando la conversación de manera natural.',
  ]) x += p(r(t, { sz: 15 }), { list: 0, before: 60 });
  x += p(r('INDICACIONES GENERALES', { sz: 17 }), { before: 240, after: 60 });
  for (const t of [
    'El moderador dará indicaciones con respecto a la forma de participar, permiso de grabación, duración de la sesión.',
    'El moderador establecerá el tono de la conversación y dejará claro que no trabaja para una marca específica, que todas las opiniones (respetuosas) son válidas, que se puede hablar sin miedo al juicio.',
  ]) x += p(r(t, { sz: 15 }), { list: 0, before: 60 });
  x += empty();
  bloques.forEach((b, i) => { x += blockTable(i + 1, b.nombre, b.minutos, escritos[i] ?? null); });
  x += p(r('Cierre y agradecimientos.', { b: true, sz: 18 }), { before: 200 });
  return x;
}

/**
 * El .docx completo. `plantilla`: el contenido de assets/plantilla-guia.docx (Buffer, ArrayBuffer o
 * Uint8Array). `JSZip`: el constructor de jszip (se pasa para que el módulo no dependa de cómo se
 * resuelve el paquete en cada entorno). Devuelve un Uint8Array.
 */
export async function construirWord({ guia, plantilla, JSZip }) {
  const zip = await JSZip.loadAsync(plantilla);
  const doc = await zip.file('word/document.xml').async('string');
  if (!doc.includes('{{BODY}}')) throw new Error('La plantilla no trae {{BODY}} en word/document.xml');
  zip.file('word/document.xml', doc.replace('{{BODY}}', armarCuerpo(guia)));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

/** «Gamers y snacks - Guía de sesiones.docx», sin caracteres que los sistemas no aceptan. */
export const nombreWord = (proyecto) =>
  `${String(proyecto || 'Guía').replace(/[\\/:*?"<>|\u0000-\u001F]/g, '').slice(0, 80).trim()} - Guía de sesiones.docx`;
