// @ts-nocheck — port casi literal de scripts/construir.js de la skill
// sapience-propuestas (validado con propuestas reales; ver skill/SKILL.md).
// Se conserva su código denso tal cual a propósito: "no se rediseñan ni se
// reescriben sus reglas; se conectan". Cambios respecto al original, y solo
// estos: (1) en vez de leer argv/escribir archivo, exporta
// construirPropuesta(contenido, archivos) y devuelve el .pptx como Buffer;
// (2) los ajustes de paleta se devuelven en vez de imprimirse; (3) las rutas
// de fotos/ilustraciones del contenido se resuelven contra `archivos`
// (ruta de Storage -> archivo temporal); (4) el estado (page, AJUSTES, TH)
// vive dentro de la función, porque en el servidor se llama muchas veces.
import pptxgenMod from 'pptxgenjs';
import fs from 'node:fs';
import path from 'node:path';
import icon from './iconos';

// Bajo tsx (el servidor corre con `tsx index.ts`) el import por default de este
// paquete CJS llega envuelto en { default }; bajo Node/Vite llega directo.
const pptxgen = (pptxgenMod as any).default ?? pptxgenMod;

const SKILL = path.join(import.meta.dirname, 'skill');
const A = (...p: string[]) => path.join(SKILL, 'assets', ...p);

const CLAVES_RUTA = new Set(['fotos_portada', 'ilustracion', 'ilustraciones', 'archivo', 'foto']);
function resolverRutas(obj: any, archivos: Record<string, string>, clave = ''): any {
  if (typeof obj === 'string') return CLAVES_RUTA.has(clave) && archivos[obj] ? archivos[obj] : obj;
  if (Array.isArray(obj)) return obj.map(v => resolverRutas(v, archivos, clave));
  if (obj && typeof obj === 'object') return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, resolverRutas(v, archivos, k)]));
  return obj;
}

export async function construirPropuesta(
  contenido: any,
  archivos: Record<string, string> = {},
): Promise<{ buffer: Buffer; ajustes: string[] }> {
  const C = resolverRutas(JSON.parse(JSON.stringify(contenido)), archivos);
  const TH = JSON.parse(fs.readFileSync(A('estilos', `estilo_${C.estilo}.json`), 'utf8'));
// ---------- paleta propia con candados (contraste, saturación, distinción entre fases) ----------
const hex2rgb = h => [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
const rgb2hex = c => c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
const lum = h => { const [r, g, b] = hex2rgb(h).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contraste = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
function hsl(h) { let [r, g, b] = hex2rgb(h).map(v => v / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let H = 0, S = 0; const L = (mx + mn) / 2;
  if (mx !== mn) { const d = mx - mn; S = L > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    H = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; H /= 6; } return [H, S, L]; }
function desdeHsl(H, S, L) { const f = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
  if (S === 0) return rgb2hex([L * 255, L * 255, L * 255]); const q = L < 0.5 ? L * (1 + S) : L + S - L * S, p = 2 * L - q;
  return rgb2hex([f(p, q, H + 1 / 3) * 255, f(p, q, H) * 255, f(p, q, H - 1 / 3) * 255]); }
const satura = (h, min = 0.45) => { const [H, S, L] = hsl(h); return S < min ? desdeHsl(H, min + 0.05, L) : h; };   // rango Sapience: acentos saturados; las fases toleran menos saturación
function legible(h, fondo, min) { let [H, S, L] = hsl(h), k = 0; const oscurecer = lum(fondo) > 0.4; let c = h;
  while (contraste(c, fondo) < min && k++ < 40) { L = oscurecer ? L - 0.02 : L + 0.02; c = desdeHsl(H, S, Math.max(0, Math.min(1, L))); } return c; }
const textoSobre = h => contraste('FFFFFF', h) >= contraste('212833', h) ? 'FFFFFF' : '212833';
const AJUSTES = [];
if (C.paleta) {
  const P = C.paleta, nota = (a, b, q) => { if (a !== b) AJUSTES.push(`${q}: ${a} → ${b}`); };
  if (P.fondo) { TH.BG = P.fondo; }
  let acc = satura(P.acento); nota(P.acento, acc, 'acento saturado'); const acc2 = legible(acc, TH.BG, 3); nota(acc, acc2, 'acento con contraste sobre el fondo');
  TH.ACC = acc2; TH.ACCT = textoSobre(acc2);
  if (P.secundario) { TH.SEC = satura(P.secundario); TH.SECT = legible(TH.SEC, TH.BG, 4.5); }
  if (P.fases) {
    const fs = [];
    P.fases.forEach((c0, i) => { let c = satura(c0, 0.18);
      // que cada fase se distinga de las anteriores: si se parece demasiado, se mueve el tono
      let k = 0; while (fs.some(o => { const a = hex2rgb(o), b = hex2rgb(c); return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 70; }) && k++ < 12) { const [H, S, L] = hsl(c); c = desdeHsl((H + 0.08) % 1, S, L); }
      nota(c0, c, `fase ${i + 1} distinguible`); fs.push(c); });
    TH.colores_fase = fs.map(c => ({ c, t: textoSobre(c), tx: legible(c, TH.BG, 3) }));
  }
}
const PORTADAS = JSON.parse(fs.readFileSync(A('portadas.json'), 'utf8'));

const pres = new pptxgen(); pres.layout = 'LAYOUT_WIDE'; pres.title = `${C.proyecto} · ${C.cliente}`;
const F = TH.F, TF = TH.TF, BG = TH.BG, SURF = TH.SURF, TXT = TH.TXT, MUT = TH.MUT, LINE = TH.LINE;
const ACC = TH.ACC, SECT = TH.SECT, DIM = TH.DIM;
const FASES = (C.fases || []).map((f, i) => Object.assign({ n: f.nombre, etapa: f.etapa, icono: f.icono || 'FiCircle' }, TH.colores_fase[i % TH.colores_fase.length]));
const W = 13.333, X0 = 0.6, CW = 12.13;
let page = 1;

const T = (s, t, o) => s.addText(t, Object.assign({ fontFace: F, color: TXT, margin: 0, isTextBox: true, valign: 'top' }, o));
const flechas = (arr, sz = 13.5) => arr.map((t, i) => ({ text: (t && t.texto) ? t.texto : t, options: { bullet: { code: '2192', indent: 18 }, breakLine: i < arr.length - 1, paraSpaceAfter: 6, fontSize: sz } }));
const runs = (arr) => arr.map(r => typeof r === 'string' ? { text: r } : { text: r.texto, options: Object.assign({}, r.resalta ? { color: ACC, bold: true } : {}, r.negrita ? { bold: true } : {}) });

function pill(s, x, y, w, h, txt, fill, col, sz = 15, lowkey = false) {
  const sh = TH.shape || 'pill';
  if (sh === 'outline' && !lowkey && fill !== SURF && fill !== TH.CELL) {
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, fill: { color: BG }, rectRadius: Math.min(0.12, h / 2), line: { color: fill, width: 2 } });
    col = TH.OUTTXT || fill;
  } else if (sh === 'square') {
    s.addShape(pres.shapes.RECTANGLE, { x, y, w, h, fill: { color: fill }, line: { color: fill } });
  } else if (sh === 'soft' || sh === 'outline') {
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, fill: { color: fill }, rectRadius: Math.min(0.12, h / 2), line: { color: fill } });
  } else {
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, fill: { color: fill }, rectRadius: h / 2, line: { color: fill } });
  }
  if (txt) T(s, txt, { x, y, w, h, fontSize: sz, bold: true, color: col, align: 'center', valign: 'middle' });
}
function box(s, x, y, w, h, fill, borde) {
  const sh = TH.shape || 'pill';
  const o = { x, y, w, h, fill: { color: fill }, line: { color: borde || fill, width: borde ? 1.5 : 0.75 } };
  if (sh === 'square') s.addShape(pres.shapes.RECTANGLE, o);
  else s.addShape(pres.shapes.ROUNDED_RECTANGLE, Object.assign(o, { rectRadius: 0.12 }));
}
const runsC = (arr, hl) => arr.map(r => typeof r === 'string' ? { text: r } : { text: r.texto, options: Object.assign({}, r.resalta ? { color: hl, bold: true } : {}, r.negrita ? { bold: true } : {}) });
function lineas(t, w, sz) { return String(t).split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length * 0.48 * sz / (w * 72))), 0); }
function altoLista(items, w, sz) { // alto en pulgadas de una lista de flechas o de un texto
  if (!items) return 0;
  if (typeof items === 'string') return lineas(items, w, sz) * sz * 1.25 / 72;
  return items.reduce((h, it) => h + lineas(it.texto || it, w - 0.25, sz) * sz * 1.22 / 72 + 6 / 72, 0);
}
function ilustracion(s, x, y, w, h, archivo) {
  if (archivo) { s.addImage({ path: archivo, x, y, w, h, sizing: { type: 'contain', w, h } }); return; }
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, fill: { color: SURF }, rectRadius: 0.1, line: { color: DIM, width: 1, dashType: 'dash' }, objectName: 'ILUSTRACION' });
  T(s, 'ILUSTRACIÓN', { x, y, w, h, fontSize: 10, bold: true, color: DIM, align: 'center', valign: 'middle' });
}
const ILU = !!C.ilustraciones;
function iconBox(s, cx, cy, d, fill) {
  const k = TH.iconShape || 'circle';
  if (k === 'square') s.addShape(pres.shapes.RECTANGLE, { x: cx - d / 2, y: cy - d / 2, w: d, h: d, fill: { color: fill }, line: { color: fill } });
  else if (k === 'rsquare') s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: cx - d / 2, y: cy - d / 2, w: d, h: d, fill: { color: fill }, rectRadius: 0.25, line: { color: fill } });
  else if (k === 'diamond') { const e = d * 0.78; s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: cx - e / 2, y: cy - e / 2, w: e, h: e, fill: { color: fill }, rectRadius: 0.2, rotate: 45, line: { color: fill } }); }
  else s.addShape(pres.shapes.OVAL, { x: cx - d / 2, y: cy - d / 2, w: d, h: d, fill: { color: fill }, line: { color: fill } });
}
const band = TH.header === 'band';
const yTitulo = band ? 0.8 : 0.95, yBis = band ? 1.82 : 1.88, yCont = 2.75;

function base(titulo, bisagra) {
  const s = pres.addSlide(); s.background = { color: BG }; page++;
  if (band) {
    s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: W, h: 0.62, fill: { color: TH.BAND }, line: { color: TH.BAND } });
    s.addImage({ path: A('img', 'logo_blanco.png'), x: 0.45, y: 0.13, w: 1.4, h: 0.354 });
    s.addShape(pres.shapes.LINE, { x: 2.1, y: 0.14, w: 0, h: 0.34, line: { color: 'FFFFFF', width: 0.75 } });
    T(s, C.proyecto, { x: 2.3, y: 0.16, w: 7, h: 0.3, fontSize: 12, color: 'C9D1DB', valign: 'middle' });
    T(s, String(page), { x: 12.1, y: 0.16, w: 0.75, h: 0.3, fontSize: 14, bold: true, color: 'FFFFFF', align: 'right', valign: 'middle' });
  } else {
    T(s, C.proyecto, { x: X0, y: 0.32, w: 6, h: 0.3, fontSize: 11, color: MUT });
    s.addShape(pres.shapes.LINE, { x: X0, y: 0.78, w: CW, h: 0, line: { color: LINE, width: 0.75 } });
    if (TH.footer !== 'band') s.addImage({ path: A('img', 'logo_blanco.png'), x: 11.28, y: 0.24, w: 1.45, h: 0.367 });
  }
  if (TH.footer === 'band') {
    s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 6.95, w: W, h: 0.55, fill: { color: TH.FBAND }, line: { color: TH.FBAND } });
    s.addImage({ path: A('img', 'logo_oscuro.png'), x: 0.45, y: 7.05, w: 1.35, h: 0.342 });
    s.addShape(pres.shapes.LINE, { x: 2.0, y: 7.04, w: 0, h: 0.36, line: { color: '323232', width: 0.75 } });
    T(s, String(page), { x: 12.1, y: 7.07, w: 0.75, h: 0.3, fontSize: 14, bold: true, color: '323232', align: 'right', valign: 'middle' });
  } else if (!band) {
    T(s, `${C.tipo} para ${C.cliente} · ${C.fecha}`, { x: X0, y: 7.02, w: 7, h: 0.25, fontSize: 9, color: MUT });
    T(s, String(page), { x: 12.23, y: 7.02, w: 0.5, h: 0.25, fontSize: 10, bold: true, align: 'right' });
  }
  if (titulo) T(s, titulo.toUpperCase(), { x: X0, y: yTitulo, w: CW, h: 0.95, fontSize: TH.TS, bold: true, color: ACC, fontFace: TF });
  if (bisagra) T(s, bisagra, { x: X0, y: yBis, w: CW, h: 0.5, fontSize: 18, bold: true });
  return s;
}
function nav(s, activa, y = 2.55) {
  const n = FASES.length, gap = 0.18, w = (CW - gap * (n - 1)) / n;
  if (FASES.some(f => f.etapa)) { // etiqueta de etapa sobre sus fases, encendida si contiene la fase activa
    const et = [...new Set(FASES.map(f => f.etapa))];
    et.forEach(e => { const idx = FASES.map((f, i) => f.etapa === e ? i : -1).filter(i => i >= 0);
      const x0 = X0 + idx[0] * (w + gap), x1 = X0 + idx[idx.length - 1] * (w + gap) + w;
      T(s, e, { x: x0, y: y - 0.42, w: x1 - x0, h: 0.36, fontSize: 15, bold: true, color: idx.includes(activa) ? ACC : DIM, align: 'center', fontFace: TF }); });
  }
  FASES.forEach((p, i) => pill(s, X0 + i * (w + gap), y, w, 0.48, p.n.toUpperCase(), i === activa ? p.c : SURF, i === activa ? p.t : DIM, 14));
}
const cols = (n, gap = 0.3) => { const w = (CW - gap * (n - 1)) / n; return [...Array(n).keys()].map(i => ({ x: X0 + i * (w + gap), w })); };

// ---------- portada ----------
function plantilla(t) {
  const tipo = C.tipo || 'Propuesta de trabajo';
  const m = { titulo: C.proyecto, cliente: C.cliente, fecha: C.fecha, tipo };
  return t.replace(/\{(TIPO_RESTO|titulo|TITULO|cliente|CLIENTE|fecha|FECHA|tipo|TIPO)\}/g, (_, k) => {
    if (k === 'TIPO_RESTO') return tipo.replace(/^propuesta\s*/i, '').toUpperCase();
    const v = m[k.toLowerCase()]; return k === k.toUpperCase() ? v.toUpperCase() : v;
  });
}
function ajusta(t, w, h, sz, bold) {
  // reduce el tamaño hasta que el texto quepa en la caja (estimación por ancho promedio de carácter)
  const k = bold ? 0.64 : 0.56;
  for (let z = sz; z >= sz * 0.55; z -= 1) {
    const lineas = t.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length * k * z / w)), 0);
    if (lineas * z * 1.08 <= h + 2) return z;
  }
  return sz * 0.55;
}
function portada() {
  const P = PORTADAS[C.portada || TH.portada];
  const s = pres.addSlide();
  P.huecos.forEach(([x, y, w, h], i) => {
    const f = (C.fotos_portada || [])[i];
    if (f) s.addImage({ path: f, x, y, w, h, sizing: { type: 'cover', w, h }, objectName: `FOTO_${i + 1}` });
    else { s.addShape(pres.shapes.RECTANGLE, { x, y, w, h, fill: { color: '9AA4AF' }, line: { color: '9AA4AF' }, objectName: `FOTO_${i + 1}` });
      T(s, 'FOTO ' + (i + 1), { x, y, w, h, fontSize: 20, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle' }); }
  });
  s.addImage({ path: A('marcos', P.marco), x: 0, y: 0, w: W, h: 7.5, objectName: 'MARCO' });
  P.textos.forEach(([t, x, y, w, h, sz, b, c, al], i) => T(s, plantilla(t), { x: x / 72, y: y / 72, w: w / 72, h: h / 72, fontSize: ajusta(plantilla(t), w, h, sz, b), bold: !!b, color: c, align: al, fontFace: TH.CF || 'Montserrat', lineSpacingMultiple: 0.92, objectName: `TEXTO_${i + 1}` }));
  s.addNotes(`Portada ${P.nombre}. Para cambiar una foto, abre el Panel de selección, elige FOTO_n, clic derecho y Cambiar imagen.`);
}

// ---------- módulos ----------
const M = {
  async contexto(d) {
    const s = base(d.titulo || 'Contexto', d.entrada ? null : d.bisagra);
    let y = yCont;
    if (d.entrada) { T(s, runs(d.entrada), { x: X0, y: yBis, w: CW, h: ILU ? 0.85 : 0.95, fontSize: ILU ? 14 : 15 }); y = yBis + (ILU ? 0.95 : 1.12); }
    const n = d.columnas.length, cs = cols(n, 0.25), sz = 13;
    if (ILU) { cs.forEach(({ x, w }, i) => ilustracion(s, x + w * 0.25, y, w * 0.5, 0.72, d.columnas[i].ilustracion)); y += 0.82; }
    const hC = Math.max(...d.columnas.map((c, i) => altoLista(c.texto || c.puntos, cs[i].w - 0.32, sz))) + 0.3;
    for (const [i, { x, w }] of cs.entries()) {
      const c = d.columnas[i], p = TH.colores_fase[i % TH.colores_fase.length];
      box(s, x, y, w, 0.62, p.c);
      const ic = c.icono && !ILU;
      if (ic) s.addImage({ data: await icon(c.icono, '#' + (p.t === 'FFFFFF' ? 'FFFFFF' : '212833')), x: x + 0.18, y: y + 0.13, w: 0.36, h: 0.36 });
      T(s, c.titulo.toUpperCase(), { x: x + (ic ? 0.6 : 0.1), y, w: w - (ic ? 0.7 : 0.2), h: 0.62, fontSize: 14, bold: true, color: p.t, align: ic ? 'left' : 'center', valign: 'middle' });
      box(s, x, y + 0.72, w, hC, SURF);
      if (c.texto) T(s, c.texto, { x: x + 0.18, y: y + 0.77, w: w - 0.32, h: hC - 0.1, fontSize: sz, align: 'center', valign: 'middle' });
      else T(s, flechas(c.puntos, sz), { x: x + 0.18, y: y + 0.77, w: w - 0.32, h: hC - 0.1, valign: 'middle' });
    }
    if (d.cierre) {
      const f = band ? TH.BAND : (TH.BG === 'FFFFFF' ? '323F4F' : SURF);
      const yc = y + 0.72 + hC + 0.22, hc = Math.min(0.95, 6.85 - yc);
      box(s, X0, yc, CW, hc, f);
      T(s, runsC(d.cierre, TH.SEC), { x: X0 + 0.3, y: yc, w: CW - 0.6, h: hc, fontSize: hc < 0.9 ? 15 : 16, color: 'FFFFFF', valign: 'middle' });
    }
  },
  async punto_partida(d) {
    // Lo que ya se sabe: insight central y bloques de conocimiento previo (como Grinch)
    const s = base(d.titulo || 'Punto de partida', d.bisagra);
    let y = yCont;
    if (ILU) { ilustracion(s, 5.67, y - 0.1, 2.0, 1.2, d.ilustracion); y += 1.2; }
    box(s, X0 + 1.5, y, CW - 3, 1.0, ACC);
    T(s, runsC(d.insight, 'FFFFFF'), { x: X0 + 1.7, y, w: CW - 3.4, h: 1.0, fontSize: 15, bold: true, color: TH.ACCT || 'FFFFFF', align: 'center', valign: 'middle' });
    const n = d.bloques.length, cs = cols(n, 0.2), y2 = y + 1.25;
    const hB = Math.max(...d.bloques.map((b, i) => altoLista(b.texto, cs[i].w - 0.3, 13))) + 0.75;
    d.bloques.forEach((b, i) => { const { x, w } = cs[i];
      box(s, x, y2, w, hB, SURF);
      T(s, b.titulo, { x: x + 0.15, y: y2 + 0.12, w: w - 0.3, h: 0.4, fontSize: 15, bold: true, color: ACC, align: 'center' });
      T(s, b.texto, { x: x + 0.15, y: y2 + 0.55, w: w - 0.3, h: hB - 0.6, fontSize: 13, align: 'center' }); });
  },
  async objetivos(d) {
    // Estructura fija: objetivo general y de 2 a 6 objetivos específicos con verbo en infinitivo y desagregado breve.
    const s = base(d.titulo || 'Objetivos');
    box(s, X0, yBis, CW, 1.05, ACC);
    T(s, 'OBJETIVO GENERAL', { x: X0 + 0.25, y: yBis + 0.1, w: 6, h: 0.28, fontSize: 12, bold: true, color: TH.ACCT || 'FFFFFF' });
    T(s, d.general, { x: X0 + 0.25, y: yBis + 0.38, w: CW - 0.5, h: 0.62, fontSize: 15, bold: true, color: TH.ACCT || 'FFFFFF' });
    const yE = yBis + 1.2;
    T(s, 'OBJETIVOS ESPECÍFICOS', { x: X0, y: yE, w: 6, h: 0.3, fontSize: 12, bold: true, color: SECT });
    const E = d.especificos, n = E.length;
    const porFila = n <= 3 ? n : (n === 4 ? 2 : 3), filas = Math.ceil(n / porFila);
    const y0 = yE + 0.4, altoTotal = 6.85 - y0, gapY = 0.15;
    const cs = cols(porFila, 0.2), li = ILU ? 0.85 : 0, disp = (altoTotal - gapY * (filas - 1)) / filas;
    const req = z => Math.max(...E.map((e, i) => altoLista(e.texto || e.puntos || e.preguntas, cs[i % porFila].w - 0.4 - li, z) + lineas(e.titulo, cs[i % porFila].w - 0.4 - li, z + 2) * (z + 2) * 1.3 / 72)) + 0.35;
    let sz = filas > 1 ? 12 : 13; while (sz > 10 && req(sz) > disp) sz -= 0.5;   // baja la letra antes que dejar texto fuera de la caja
    const hCel = Math.min(req(sz), disp);
    E.forEach((e, i) => {
      const { x, w } = cs[i % porFila], y = y0 + Math.floor(i / porFila) * (hCel + gapY);
      box(s, x, y, w, hCel, SURF);
      if (ILU) ilustracion(s, x + 0.12, y + 0.12, 0.7, Math.min(0.7, hCel - 0.24), e.ilustracion);
      const xt = x + 0.2 + li, wt = w - 0.4 - li;
      const tit = { text: e.titulo, options: { bold: true, color: ACC, fontSize: sz + 2, breakLine: true, paraSpaceAfter: 6 } };
      const cuerpo = e.texto ? [{ text: e.texto, options: { fontSize: sz } }] : flechas(e.puntos || e.preguntas, sz);
      T(s, [tit].concat(cuerpo), { x: xt, y: y + 0.08, w: wt, h: hCel - 0.16, valign: 'middle' });
    });
  },
  async enfoque(d) {
    const s = base(d.titulo || 'Nuestro enfoque', d.bisagra);
    const n = FASES.length, lay = d.acomodo || (TH.enfoque === 'band' ? 'banda' : 'circulos');
    if (lay === 'banda') {
      const w = (CW + 0.12 * (n - 1)) / n;
      for (let i = 0; i < n; i++) { const x = X0 + i * (w - 0.12), p = FASES[i];
        s.addShape(i === 0 ? pres.shapes.PENTAGON : pres.shapes.CHEVRON, { x, y: yCont, w, h: 0.9, fill: { color: p.c }, line: { color: p.c } });
        T(s, p.n.toUpperCase(), { x: x + (i ? 0.45 : 0.15), y: yCont, w: w - 0.75, h: 0.9, fontSize: 15, bold: true, color: p.t, align: 'center', valign: 'middle' });
        if (ILU) ilustracion(s, x + 0.35, 3.8, w - 0.9, 1.1, (d.ilustraciones || [])[i]);
        else { iconBox(s, x + w / 2 - 0.1, 4.35, 0.95, SURF);
        s.addImage({ data: await icon(p.icono, '#' + (p.tx || p.c)), x: x + w / 2 - 0.35, y: 4.1, w: 0.5, h: 0.5 }); }
        T(s, (d.verbos[i] || []).join('\n'), { x: x + 0.1, y: 5.05, w: w - 0.4, h: 1.4, fontSize: 13, align: 'center', color: MUT, paraSpaceAfter: 4 }); }
    } else {
      const step = CW / n, dia = Math.min(1.7, step * 0.55);
      for (let i = 0; i < n; i++) { const cx = X0 + step * (i + 0.5), p = FASES[i];
        if (ILU) ilustracion(s, cx - step * 0.4, 2.65, step * 0.8, 1.7, (d.ilustraciones || [])[i]);
        else { iconBox(s, cx, 3.5, dia, p.c);
        s.addImage({ data: await icon(p.icono, p.t === 'FFFFFF' ? '#FFFFFF' : '#212833'), x: cx - dia * 0.25, y: 3.5 - dia * 0.25, w: dia * 0.5, h: dia * 0.5 }); }
        if (i < n - 1 && !ILU) T(s, '➜', { x: cx + step / 2 - 0.3, y: 3.2, w: 0.6, h: 0.6, fontSize: 26, color: LINE, align: 'center' });
        T(s, p.n.toUpperCase(), { x: cx - step / 2, y: 4.5, w: step, h: 0.45, fontSize: 17, bold: true, align: 'center', color: p.tx || p.c });
        T(s, (d.verbos[i] || []).join('\n'), { x: cx - step / 2 + 0.1, y: 5.0, w: step - 0.2, h: 1.4, fontSize: 13, align: 'center', color: MUT, paraSpaceAfter: 4 }); }
    }
  },
  async detalle_fase(d) {
    const s = base(d.titulo || 'Metodología a detalle'); nav(s, d.fase);
    const conFoto = !!d.foto, wTxt = 6.6;
    T(s, 'GOAL', { x: X0, y: 3.3, w: 3, h: 0.35, fontSize: 16, bold: true, color: ACC });
    T(s, d.goal, { x: X0, y: 3.68, w: wTxt, h: 0.8, fontSize: 14, bold: true });
    T(s, '¿CÓMO LO HAREMOS?', { x: X0, y: 4.55, w: 5, h: 0.35, fontSize: 16, bold: true, color: ACC });
    const r = []; d.como.forEach((c, i) => { r.push({ text: c.titulo, options: { bold: true, breakLine: true } }); r.push({ text: c.texto, options: { breakLine: i < d.como.length - 1, paraSpaceAfter: 8 } }); });
    T(s, r, { x: X0, y: 4.95, w: wTxt, h: 1.9, fontSize: 13.5 });
    if (conFoto) s.addImage({ path: d.foto, x: 7.6, y: 3.3, w: 2.5, h: 3.4, sizing: { type: 'cover', w: 2.5, h: 3.4 } });
    else { const p = FASES[d.fase]; box(s, 7.6, 3.3, 1.6, 3.4, p.c);
      s.addImage({ data: await icon(p.icono, p.t === 'FFFFFF' ? '#FFFFFF' : '#212833'), x: 7.95, y: 4.55, w: 0.9, h: 0.9 }); }
    const xo = conFoto ? 10.35 : 9.5, wo = conFoto ? 2.4 : 3.23;
    box(s, xo - 0.15, 3.2, wo + 0.3, 3.6, SURF);
    T(s, 'OUTPUT', { x: xo, y: 3.3, w: wo, h: 0.35, fontSize: 16, bold: true, color: ACC });
    T(s, flechas(d.output, 12.5), { x: xo, y: 3.7, w: wo, h: 3 });
  },
  async muestra(d) {
    const s = base(d.titulo || 'Target y muestra', d.bisagra);
    const lay = d.acomodo || (TH.muestra === 'table' ? 'tabla' : 'celdas');
    const nc = d.columnas.length, wl = 3.5, gap = 0.15, wc = (CW - wl - 0.2 - gap * (nc - 1)) / nc, xc = X0 + wl + 0.2;
    const lay0 = d.acomodo || (TH.muestra === 'table' ? 'tabla' : 'celdas');
    const filasH = d.filas.length > 3 ? 0.6 : 0.75;
    const yEnd = lay0 === 'tabla' ? yCont + 0.55 + d.filas.length * filasH : yCont + 0.7 + d.filas.length * (filasH + 0.2) - 0.2;
    if (lay === 'tabla') {
      const hdr = [{ text: '', options: { fill: { color: BG } } }].concat(d.columnas.map(c => ({ text: c, options: { bold: true, color: TH.HDRT || 'FFFFFF', fill: { color: TH.HDR || SURF }, align: 'center' } })));
      const rows = d.filas.map(f => [{ text: f.nombre, options: { bold: true, color: ACC } }].concat(f.celdas.map(c => ({ text: c, options: { align: 'center', color: TXT } }))));
      s.addTable([hdr].concat(rows), { x: X0, y: yCont, w: CW, colW: [wl + 0.2].concat(Array(nc).fill((CW - wl - 0.2) / nc)), rowH: [0.55].concat(Array(d.filas.length).fill(filasH)), fontFace: F, fontSize: 16, valign: 'middle', border: { type: 'solid', pt: 1, color: LINE }, color: TXT });
    } else {
      d.columnas.forEach((c, i) => pill(s, xc + i * (wc + gap), yCont, wc, 0.5, c, SURF, SECT, 15));
      d.filas.forEach((f, j) => { const y = yCont + 0.7 + j * (filasH + 0.2);
        pill(s, X0, y, wl, filasH, f.nombre, ACC, 'FFFFFF', 14);
        f.celdas.forEach((t, i) => pill(s, xc + i * (wc + gap), y, wc, filasH, t, TH.CELL, TH.CELLT, 17, true)); });
    }
    if (d.notas) T(s, flechas(d.notas, 13), { x: X0, y: Math.min(yEnd + 0.3, 5.7), w: CW, h: 1.2 });
  },
  async entregables(d) {
    const s = base(d.titulo || 'Ejemplos de entregables', d.bisagra);
    cols(d.imagenes.length, 0.25).forEach(({ x, w }, i) => { const im = d.imagenes[i], h = w * 0.62;
      s.addShape(pres.shapes.RECTANGLE, { x, y: yCont, w, h, fill: { color: TH.CELL }, line: { color: LINE } });
      s.addImage({ path: im.archivo, x: x + 0.08, y: yCont + 0.08, w: w - 0.16, h: h - 0.16, sizing: { type: 'contain', w: w - 0.16, h: h - 0.16 } });
      T(s, im.pie, { x, y: yCont + h + 0.15, w, h: 0.6, fontSize: 13, bold: true, color: SECT, align: 'center' }); });
  },
  async tiempos(d) {
    const s = base(d.titulo || 'Tiempos', d.bisagra);
    const n = d.semanas.length, cw = CW / n, y0 = d.bisagra ? 2.6 : 2.0, gh = 6.2 - y0 - 0.7;
    d.semanas.forEach((w, i) => { pill(s, X0 + i * cw + 0.03, y0, cw - 0.06, 0.38, w, SURF, TXT, 11, true);
      'LMMJVSD'.split('').forEach((dd, k) => { const dx = X0 + i * cw + 0.05 + k * (cw - 0.1) / 7;
        T(s, dd, { x: dx, y: y0 + 0.45, w: (cw - 0.1) / 7, h: 0.22, fontSize: 8, color: k > 4 ? DIM : MUT, align: 'center' });
        s.addShape(pres.shapes.RECTANGLE, { x: dx + 0.01, y: y0 + 0.7, w: (cw - 0.1) / 7 - 0.02, h: gh, fill: { color: k > 4 ? TH.WEND : TH.WDAY }, line: { color: BG, width: 0 } }); }); });
    const rowH = Math.min(0.75, (gh - 0.2) / d.barras.length);
    d.barras.forEach((b, j) => { const p = (b.fase === undefined || b.fase === null) ? { n: b.etiqueta, c: DIM, t: 'FFFFFF' } : FASES[b.fase], x = X0 + b.inicio * cw, y = y0 + 0.95 + j * rowH, w = Math.max((b.fin - b.inicio) * cw, 0.5);
      const corto = (b.fin - b.inicio) < 1;
      pill(s, x, y, w, 0.45, corto ? '' : (b.etiqueta || p.n).toUpperCase(), p.c, p.t, 12);
      if (corto) T(s, (b.etiqueta || p.n) + ' →', { x: x - 3.3, y, w: 3.2, h: 0.45, fontSize: 11, bold: true, align: 'right', valign: 'middle' }); });
    if (d.nota) T(s, d.nota, { x: X0, y: 6.35, w: CW, h: 0.3, fontSize: 12, color: MUT });
  },
  async inversion(d) {
    const s = base(d.titulo || 'Inversión', d.bisagra);
    if (d.partidas) {
      cols(d.partidas.length, 0.18).forEach(({ x, w }, i) => { const pa = d.partidas[i], p = FASES[pa.fase];
        pill(s, x, 2.7, w, 0.5, p.n.toUpperCase(), p.c, p.t, 13);
        T(s, pa.descripcion, { x, y: 3.35, w, h: 0.6, fontSize: 13, align: 'center', color: MUT });
        const largo = pa.precio.length > 16;
        T(s, pa.precio, { x, y: 4.0, w, h: 0.8, fontSize: largo ? 16 : 21, bold: true, align: 'center' }); });
    } else if (d.incluye) {
      box(s, X0, 2.6, CW, 2.5, SURF);
      T(s, 'LA INVERSIÓN INCLUYE', { x: X0 + 0.3, y: 2.75, w: 6, h: 0.3, fontSize: 12, bold: true, color: SECT });
      T(s, flechas(d.incluye, 13.5), { x: X0 + 0.3, y: 3.15, w: CW - 0.6, h: 1.9 });
    }
    if (d.paquete) {
      if (d.paquete.etiqueta) T(s, d.paquete.etiqueta.toUpperCase(), { x: X0, y: 5.25, w: 8, h: 0.4, fontSize: 15, bold: true, color: SECT });
      T(s, d.paquete.precio, { x: X0, y: 5.65, w: 10, h: 0.75, fontSize: 40, bold: true, color: ACC });
      T(s, `(${d.paquete.letra})`, { x: X0, y: 6.38, w: 10, h: 0.35, fontSize: 13, color: MUT });
    }
    if (d.nota) T(s, d.nota, { x: X0, y: 6.72, w: CW, h: 0.25, fontSize: 10, color: MUT });
  },
  async seccion(d) {
    const s = base(d.titulo, d.bisagra);
    if (d.columnas) cols(d.columnas.length, 0.3).forEach(({ x, w }, i) => { const c = d.columnas[i];
      pill(s, x, yCont, w, 0.5, c.titulo.toUpperCase(), SURF, SECT, 15);
      T(s, flechas(c.puntos), { x: x + 0.1, y: yCont + 0.7, w: w - 0.15, h: 3.2 }); });
    else if (d.puntos) T(s, flechas(d.puntos, 15), { x: X0, y: yCont, w: CW, h: 3.8 });
    if (d.nota) T(s, d.nota, { x: X0, y: 6.3, w: CW, h: 0.5, fontSize: 13, color: MUT });
  },
  async cierre() { const s = pres.addSlide(); s.addImage({ path: A('img', 'cierre.png'), x: 0, y: 0, w: W, h: 7.5 }); },
};

  portada();
  for (const l of C.laminas) {
    if (!M[l.tipo]) throw new Error('Módulo desconocido: ' + l.tipo);
    await M[l.tipo](l);
  }
  const buffer = await pres.write({ outputType: 'nodebuffer' });
  return { buffer: Buffer.from(buffer as ArrayBuffer), ajustes: AJUSTES };
}
