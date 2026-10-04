// Revisor de ENCAJE y VOZ del Hub (oct 2026). NO es parte del revisar.py de la
// skill (ese se porta tal cual y no se toca): es una capa aparte, del Hub, que
// alimenta el mismo bucle de corrección. Nace de una propuesta real generada
// por Claude cuyo PowerPoint salió con texto desbordado (detalle de fase,
// muestra, objetivo general) y con frases como «las dos ciudades del brief».
//
// El constructor mide el texto con 0.48 em por carácter, que se queda corto
// con Montserrat; aquí se mide con 0.51 em (regular), 0.57 em (negritas) y
// 0.68 em (negritas en mayúsculas), calibrados con láminas reales ya
// renderizadas (p. ej. 100 caracteres en negritas de 15 pt ocupan ≈ 11.6 in).
// No hay renderizador en el servidor para medir; si hay falsos positivos o se
// cuela algún desborde, el ajuste es REG / BOLD / CAPS. Las geometrías
// (posiciones y alturas) son las de construir.ts.
import fs from 'node:fs';
import path from 'node:path';
import type { Problema } from './revisar';

const CW = 12.13;
const REG = 0.51, BOLD = 0.57, CAPS = 0.68;

// Líneas que ocupa un texto: cada salto de línea abre una línea nueva.
function lineas(t: string, wIn: number, pt: number, bold = false, caps = false): number {
  const porLinea = Math.max(1, Math.floor((wIn * 72) / ((caps ? CAPS : bold ? BOLD : REG) * pt)));
  return String(t).split('\n').reduce((n, l) => n + Math.max(1, Math.ceil([...l].length / porLinea)), 0);
}
const textoDe = (it: any): string => (typeof it === 'string' ? it : it?.texto ?? '');
// Alto en puntos de una lista de flechas (indent .25 in, 6 pt entre viñetas).
const altoFlechasPt = (items: any[], wIn: number, pt: number) =>
  items.reduce((h, it) => h + lineas(textoDe(it), wIn - 0.25, pt) * pt * 1.2 + 6, 0);
// Lo que el constructor cree que ocupa (0.48 em) — para saber si su caja saldrá corta.
const lineasCtor = (t: string, w: number, sz: number) => String(t).split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length * 0.48 * sz / (w * 72))), 0);
const altoListaCtor = (items: any, w: number, sz: number) =>
  typeof items === 'string' ? lineasCtor(items, w, sz) * sz * 1.25 / 72
    : (items ?? []).reduce((h: number, it: any) => h + lineasCtor(textoDe(it), w - 0.25, sz) * sz * 1.22 / 72 + 6 / 72, 0);

const SKILL = path.join(import.meta.dirname, 'skill');
function muestraTabla(estilo: string): boolean {
  try { return JSON.parse(fs.readFileSync(path.join(SKILL, 'assets', 'estilos', `estilo_${estilo}.json`), 'utf8')).muestra === 'table'; } catch { return false; }
}

// Cuántos caracteres caben, para decirle a Claude un número concreto.
const aprox = (wIn: number, pt: number, nLineas: number, bold = false) => Math.floor((wIn * 72) / ((bold ? BOLD : REG) * pt)) * nLineas;

const estilos: Record<string, any> = {};
function estilo(id: string): any {
  if (!(id in estilos)) {
    try { estilos[id] = JSON.parse(fs.readFileSync(path.join(SKILL, 'assets', 'estilos', `estilo_${id}.json`), 'utf8')); } catch { estilos[id] = {}; }
  }
  return estilos[id];
}

export function revisarEncaje(C: any): Problema[] {
  const out: Problema[] = [];
  const add = (ruta: string, problema: string) => out.push({ ruta, problema });
  const TS = estilo(C.estilo).TS ?? 54;
  // Portada: el título del estudio comparte caja con «para» y el cliente.
  if (C.proyecto && [...C.proyecto].length > 40) add('proyecto', `El nombre del estudio («${C.proyecto}») es muy largo para la portada y se encima con el nombre del cliente. Déjalo en máximo 40 caracteres (nombre de marca y tema, sin subtítulo).`);
  // Títulos de lámina: una sola línea en mayúsculas (la caja mide 0.95 in; a dos líneas se encima con la bisagra).
  const maxTit = Math.floor((CW * 72) / (CAPS * TS));
  const mismasLineas = (ruta: string, titulos: string[], wIn: number, pt: number, max: number, que: string) => {
    const ls = titulos.map(t => lineas(String(t).toUpperCase(), wIn, pt, true, true));
    if (Math.max(...ls) > max) add(ruta, `Hay ${que} que ocupan más de ${max} línea(s). Acórtalos (máximo ~${Math.floor((wIn * 72) / (CAPS * pt)) * max} caracteres).`);
    else if (new Set(ls).size > 1) add(ruta, `Los ${que} no ocupan el mismo número de renglones (${ls.join(', ')}) y las cajas de color se ven dispares. Acórtalos para que todos ocupen ${Math.min(...ls)} renglón(es), con largo parecido (máximo ~${Math.floor((wIn * 72) / (CAPS * pt)) * Math.min(...ls)} caracteres cada uno).`);
  };
  (C.laminas ?? []).forEach((l: any, i: number) => {
    const r = `laminas[${i}]`;
    if (l.titulo && lineas(String(l.titulo).toUpperCase(), CW, TS, true, true) > 1) add(`${r}.titulo`, `El título «${l.titulo}» no cabe en una línea (la lámina lo escribe en mayúsculas grandes; máximo ~${maxTit} caracteres) y se encima con el texto de abajo. Acórtalo, o quita el titulo para usar el de la skill.`);
    if (l.tipo === 'objetivos' && l.general) {
      const n = lineas(l.general, CW - 0.5, 15, true);
      if (n > 2) add(`${r}.general`, `El objetivo general ocupa ${n} líneas y en la lámina caben 2 (se sale de su caja). Reescríbelo en máximo ~${aprox(CW - 0.5, 15, 2, true)} caracteres, una sola oración.`);
    }
    if (l.tipo === 'objetivos' && (l.especificos ?? []).length) {
      const E: any[] = l.especificos, n = E.length, porFila = n <= 3 ? n : (n === 4 ? 2 : 3), filas = Math.ceil(n / porFila), gap = 0.2;
      const wCol = (CW - gap * (porFila - 1)) / porFila - 0.4 - (C.ilustraciones ? 0.85 : 0);
      const pt = (filas > 1 ? 12 : 13) + 2;
      E.forEach((e, k) => {
        const nl = lineas(e.titulo ?? '', wCol, pt, true);
        if (nl > 2) add(`${r}.especificos[${k}].titulo`, `El título del objetivo específico ocupa ${nl} líneas y debe ocupar máximo 2 (~${aprox(wCol, pt, 2, true)} caracteres). Dilo con menos palabras; el detalle va en las viñetas.`);
      });
    }
    if (l.tipo === 'seccion' && (l.columnas ?? []).length) {
      const n = l.columnas.length, w = (CW - 0.3 * (n - 1)) / n;
      mismasLineas(`${r}.columnas`, l.columnas.map((c: any) => c.titulo ?? ''), w - 0.2, 15, 1, 'títulos de columna');
    }
    if (l.tipo === 'contexto') {
      const cs: any[] = l.columnas ?? [];
      if (cs.length) {
        const w = (CW - 0.25 * (cs.length - 1)) / cs.length;
        const hayIcono = cs.some(c => c.icono) && !C.ilustraciones;   // el icono le quita 0.5 in a la caja de color
        mismasLineas(`${r}.columnas`, cs.map(c => c.titulo ?? ''), w - (hayIcono ? 0.7 : 0.2), 14, 2, 'títulos de las cajas de color');
      }
      if (l.entrada) {
        const t = (l.entrada as any[]).map(textoDe).join('');
        const n = lineas(t, CW, 15);
        if (n > 3) add(`${r}.entrada`, `El párrafo de entrada ocupa ${n} líneas y caben 3 (~${aprox(CW, 15, 3)} caracteres). Acórtalo conservando la idea central.`);
      }
      const cols: any[] = l.columnas ?? [];
      const n = cols.length;
      if (n) {
        const gap = 0.25, w = (CW - gap * (n - 1)) / n;
        const calc = Math.max(...cols.map(c => altoFlechasPt(c.puntos ?? [c.texto ?? ''], w - 0.32, 13))) / 72 + 0.3;
        const ctor = Math.max(...cols.map(c => altoListaCtor(c.texto || c.puntos, w - 0.32, 13))) + 0.3;
        if (calc > ctor + 0.25) add(`${r}.columnas`, `Las columnas de contexto traen más texto del que cabe en su caja (el texto se sale por abajo). Acorta cada punto a una oración corta (~${aprox(w - 0.57, 13, 3)} caracteres como máximo por punto).`);
      }
    }
    if (l.tipo === 'detalle_fase') {
      const wTxt = 6.6, conFoto = !!l.foto, wo = conFoto ? 2.4 : 3.23;
      const nG = lineas(l.goal ?? '', wTxt, 14, true);
      if (nG > 3) add(`${r}.goal`, `El goal ocupa ${nG} líneas y caben 3. Máximo ~${aprox(wTxt, 14, 3, true)} caracteres.`);
      const hComo = (l.como ?? []).reduce((h: number, c: any) => h + lineas(c.titulo ?? '', wTxt, 13.5, true) * 16.2 + lineas(c.texto ?? '', wTxt, 13.5) * 16.2 + 8, 0);
      if (hComo > 2.0 * 72) {
        add(`${r}.como`, `«¿Cómo lo haremos?» no cabe: se sale de la lámina y se encima con el pie de página. Máximo 2 entradas, cada una con título de una línea y texto de ~${aprox(wTxt, 13.5, 3)} caracteres (3 líneas).`);
      }
      const hOut = altoFlechasPt(l.output ?? [], wo, 12.5);
      if (hOut > 3.1 * 72) add(`${r}.output`, `El output no cabe en su caja. Máximo 3 viñetas de ~${aprox(wo - 0.25, 12.5, 3)} caracteres cada una.`);
    }
    if (l.tipo === 'muestra') {
      const nc = (l.columnas ?? []).length, nf = (l.filas ?? []).length, gap = 0.15, wl = 3.5, yCont = 2.75;
      const tabla = (l.acomodo ?? (muestraTabla(C.estilo) ? 'tabla' : 'celdas')) === 'tabla';
      const filasH = nf > 3 ? 0.6 : 0.75;
      const wc = (CW - wl - 0.2 - gap * (nc - 1)) / Math.max(1, nc);
      const yEnd = tabla ? yCont + 0.55 + nf * filasH : yCont + 0.7 + nf * (filasH + 0.2) - 0.2;
      const maxLin = Math.floor((filasH * 72) / (tabla ? 19.2 : 20.4));
      (l.filas ?? []).forEach((f: any, j: number) => {
        (f.celdas ?? []).forEach((c: string, k: number) => {
          const n = lineas(c, wc - (tabla ? 0.2 : 0), tabla ? 16 : 17, !tabla);
          if (n > maxLin) add(`${r}.filas[${j}].celdas[${k}]`, `La celda «${c}» no cabe en su casilla (${n} líneas, caben ${maxLin}). Hazla telegráfica: cifra y unidad (~${aprox(wc, tabla ? 16 : 17, maxLin, !tabla)} caracteres).`);
        });
        const nl = lineas(f.nombre ?? '', wl, 14, true);
        if (nl > Math.floor((filasH * 72) / 16.8)) add(`${r}.filas[${j}].nombre`, `La etiqueta de fila «${f.nombre}» no cabe en su casilla. Acórtala (~${aprox(wl, 14, 2, true)} caracteres).`);
      });
      if (l.notas?.length) {
        const yNotas = Math.min(yEnd + 0.3, 5.7);
        const hNotas = altoFlechasPt(l.notas, CW, 13) / 72;
        if (yNotas < yEnd - 0.02) {
          add(`${r}.notas`, `Con ${nf} filas la tabla de muestra llega hasta ${yEnd.toFixed(1)} in y las notas empiezan antes (${yNotas.toFixed(1)} in): se encima el texto. Quita las notas de esta lámina (llévalas a otra) o reduce las filas a 2.`);
        } else if (yNotas + hNotas > 6.95) {
          add(`${r}.notas`, `Las notas de la muestra no caben bajo la tabla (se salen por abajo). Deja máximo ${Math.max(1, Math.floor(((6.95 - yNotas) * 72) / (13 * 1.2 * 2 + 6)))} nota(s) de una o dos líneas.`);
        }
      }
    }
  });
  return out;
}

// Voz: la propuesta la lee el cliente, así que no habla «del brief» ni usa
// corchetes angulares como número suelto («<12>»). Los corchetes con sentido
// completo son estilo Sapience (redaccion.md) y NO se tocan.
const MENCION_BRIEF = /\b(?:el|del|al|en el|según el|segun el|que el|y el)\s+brief\b/i;
const CORCHETE_SUELTO = /<\s*[\d.,]+\s*>/;

function* textos(obj: any, ruta = ''): Generator<[string, string]> {
  if (typeof obj === 'string') yield [ruta, obj];
  else if (Array.isArray(obj)) for (let i = 0; i < obj.length; i++) yield* textos(obj[i], `${ruta}[${i}]`);
  else if (obj && typeof obj === 'object') for (const [k, v] of Object.entries(obj)) yield* textos(v, ruta ? `${ruta}.${k}` : k);
}

export function revisarVoz(C: any): Problema[] {
  const out: Problema[] = [];
  for (const [ruta, t] of textos(C)) {
    if (/(archivo|fuente|foto|estilo|portada|tipo|icono|acomodo)$/.test(ruta) || ruta.includes('fotos_portada')) continue;
    if (MENCION_BRIEF.test(t)) out.push({ ruta, problema: 'No menciones «el brief»: la propuesta se escribe para el cliente. Afirma directamente (p. ej. nombra las ciudades en vez de «las ciudades del brief») o di «lo que nos compartieron».' });
    if (CORCHETE_SUELTO.test(t)) out.push({ ruta, problema: 'Corchetes angulares con un número suelto («<12>»). Los corchetes son para una aclaración operativa con sentido completo («<6 participantes por sesión>»); si no, escribe el número en el texto.' });
  }
  return out;
}
