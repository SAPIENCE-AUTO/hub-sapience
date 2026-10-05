// Revisor de ENCAJE del Hub: SOLO lo que revisar.py (la skill) no cubre.
// Todo lo demás (título de una línea, títulos de objetivos y de cajas de color,
// «el brief», corchetes sueltos, entrada del contexto, notas y descripciones)
// vive en revisar.ts, que es el port fiel de revisar.py. Aquí queda lo que
// depende de la geometría de láminas que revisar.py no mide; la lista está en
// el mensaje de cambios para pasarla a la skill. Se mide con la misma función
// de renglones que revisar.py y construir.js (palabra por palabra, anchos
// medidos en Montserrat) y con las geometrías de construir.js.
import fs from 'node:fs';
import path from 'node:path';
import { renglonesTexto, K_REGULAR, K_NEGRITAS, K_MAYUS, type Problema } from './revisar';

const CW = 12.13;
const SKILL = path.join(import.meta.dirname, 'skill');

const esMayus = (t: string) => t === t.toUpperCase() && /[A-ZÁÉÍÓÚÑ]/.test(t);
// Mismas k que construir.js: lineas() (regular) y lineasB() (negritas).
const lineas = (t: string, w: number, pt: number, bold = false) =>
  renglonesTexto(t, w, pt, bold ? (esMayus(t) ? K_MAYUS : K_NEGRITAS) : (esMayus(t) ? 0.66 : K_REGULAR));
const textoDe = (it: any): string => (typeof it === 'string' ? it : it?.texto ?? '');
// altoLista de construir.js (pulgadas): texto suelto o lista de flechas.
const altoLista = (items: any, w: number, sz: number): number => {
  if (!items) return 0;
  if (typeof items === 'string') return lineas(items, w, sz) * sz * 1.25 / 72;
  return items.reduce((h: number, it: any) => h + lineas(textoDe(it), w - 0.25, sz) * sz * 1.22 / 72 + 6 / 72, 0);
};
// Alto en puntos de una lista de flechas.
const altoFlechasPt = (items: any[], wIn: number, pt: number, esp = 6) =>
  items.reduce((h, it) => h + lineas(textoDe(it), wIn - 0.25, pt) * pt * 1.2 + esp, 0);
// Caracteres que caben, para decirle a Claude un número concreto.
const aprox = (wIn: number, pt: number, nLineas: number, k = K_REGULAR) => Math.floor((wIn * 72) / (k * pt)) * nLineas;

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
  const TH = estilo(C.estilo ?? 'A');
  const ILU = !!C.ilustraciones;
  const yBis = TH.header === 'band' ? 1.82 : 1.88, yCont = 2.75;

  // Portada: el título del estudio comparte caja con «para» y el cliente.
  if (C.proyecto && [...C.proyecto].length > 40) add('proyecto', `El nombre del estudio («${C.proyecto}») es muy largo para la portada y se encima con el nombre del cliente. Déjalo en máximo 40 caracteres (nombre de marca y tema, sin subtítulo).`);

  (C.laminas ?? []).forEach((l: any, i: number) => {
    const r = `laminas[${i}]`;

    if (l.tipo === 'objetivos' && l.general) {
      const n = lineas(l.general, CW - 0.5, 15, true);
      if (n > 2) add(`${r}.general`, `El objetivo general ocupa ${n} líneas y en la lámina caben 2 (se sale de su caja). Reescríbelo en máximo ~${aprox(CW - 0.5, 15, 2, K_NEGRITAS)} caracteres, una sola oración.`);
    }

    if (l.tipo === 'seccion' && (l.columnas ?? []).length) {
      const n = l.columnas.length, w = (CW - 0.3 * (n - 1)) / n - 0.2;
      const ls: number[] = l.columnas.map((c: any) => lineas(String(c.titulo ?? '').toUpperCase(), w, 15, true));
      if (Math.max(...ls) > 1) add(`${r}.columnas`, `Hay títulos de columna que no caben en una línea (${ls.join(', ')} renglones). Acórtalos (máximo ~${aprox(w, 15, 1, K_MAYUS)} caracteres).`);
    }

    if (l.tipo === 'contexto' && (l.columnas ?? []).length) {
      // Alto total de la lámina con las mismas fórmulas del constructor: entrada, columnas y cierre.
      const cs: any[] = l.columnas, n = cs.length, w = (CW - 0.25 * (n - 1)) / n;
      let y = yCont;
      if (l.entrada) {
        const txt = l.entrada.map(textoDe).join(' ');
        let ze = ILU ? 14 : 15; const he = (z: number) => lineas(txt, CW, z, true) * z * 1.25 / 72;
        while (ze > 12 && he(ze) > (ILU ? 0.85 : 1.0)) ze -= 0.5;
        y = yBis + he(ze) + 0.2;
      }
      if (ILU) y += 0.82;
      const hC = Math.max(...cs.map(c => altoLista(c.texto || c.puntos, w - 0.32, 11))) + 0.3;   // texto de las cajas a 11; el reparto del espacio sobrante solo usa lo que sobra
      const yFin = y + 0.72 + hC;
      if (yFin > 6.85) add(`${r}.columnas`, `El contexto no cabe en la lámina: las columnas terminan en ${yFin.toFixed(1)} in y el límite es 6.9. Acorta cada punto a una oración corta (~${aprox(w - 0.57, 11, 2)} caracteres).`);
      else if (l.cierre && 6.85 - (yFin + 0.22) < 0.6) add(`${r}.cierre`, 'El cierre del contexto queda sin espacio debajo de las columnas. Acorta los puntos de las columnas o el cierre.');
    }

    if (l.tipo === 'detalle_fase') {
      const wTxt = 6.6, conFoto = !!l.foto, wo = conFoto ? 2.4 : 3.23;
      const nG = lineas(l.goal ?? '', wTxt, 14, true);
      if (nG > 3) add(`${r}.goal`, `El goal ocupa ${nG} líneas y caben 3. Máximo ~${aprox(wTxt, 14, 3, K_NEGRITAS)} caracteres.`);
      // tolerancia de 7 pt en «como»: la caja termina en 6.85 in y el pie empieza en 7.02
      const hComo = (l.como ?? []).reduce((h: number, c: any, k: number, a: any[]) =>
        h + lineas(c.titulo ?? '', wTxt, 13.5, true) * 16.2 + lineas(c.texto ?? '', wTxt, 11.5) * 11.5 * 1.2 + (k < a.length - 1 ? 10 : 0), 0);   // título 13.5, texto 11.5, 10 pt entre técnicas
      if (hComo > 1.9 * 72 + 7) add(`${r}.como`, `«¿Cómo lo haremos?» no cabe: se sale de la lámina y se encima con el pie de página. Máximo 2 entradas, cada una con título de una línea y descripción de máximo 2 renglones (~${aprox(wTxt, 11.5, 2)} caracteres).`);
      if (altoFlechasPt(l.output ?? [], wo, 12.5) > 3.0 * 72) add(`${r}.output`, `El output no cabe en su caja. Máximo 3 viñetas de ~${aprox(wo - 0.25, 12.5, 3)} caracteres cada una.`);
    }

    if (l.tipo === 'muestra') {
      // Geometría de muestra() en construir.js, con `grupos` (nombre de fase sobre sus columnas).
      const nc = (l.columnas ?? []).length, nf = (l.filas ?? []).length, gap = 0.15, wl = 3.3, G = !!(l.grupos && l.grupos.length);
      const conDetalle = G && l.grupos.some((g: any) => g?.detalle);
      const tabla = (l.acomodo ?? (TH.muestra === 'table' ? 'tabla' : 'celdas')) === 'tabla';
      const filasH = nf > 3 ? 0.55 : (G ? 0.62 : 0.75), gapF = G ? 0.16 : 0.2;
      const wc = (CW - wl - 0.2 - gap * (nc - 1)) / Math.max(1, nc);
      let yEnd: number;
      if (tabla) yEnd = yCont + (G ? (conDetalle ? 0.62 : 0.45) + 0.45 : 0.55) + nf * filasH;
      else { const yC = G ? yCont + (conDetalle ? 0.86 : 0.55) : yCont, hC = G ? 0.42 : 0.5, y0 = yC + hC + gapF; yEnd = y0 + nf * (filasH + gapF) - gapF; }
      const ptCelda = tabla ? 15 : (G ? 15 : 17), ptNombre = tabla ? 15 : 14;
      const maxLin = Math.floor((filasH * 72) / (ptCelda * 1.2));
      (l.filas ?? []).forEach((f: any, j: number) => {
        (f.celdas ?? []).forEach((c: string, k: number) => {
          const n = lineas(c, wc - (tabla ? 0.2 : 0), ptCelda, !tabla);
          if (n > maxLin) add(`${r}.filas[${j}].celdas[${k}]`, `La celda «${c}» no cabe en su casilla (${n} líneas, caben ${maxLin}). Hazla telegráfica: cifra y unidad (~${aprox(wc, ptCelda, maxLin, tabla ? K_REGULAR : K_NEGRITAS)} caracteres).`);
        });
        if (lineas(f.nombre ?? '', wl, ptNombre, true) > Math.floor((filasH * 72) / (ptNombre * 1.2))) add(`${r}.filas[${j}].nombre`, `La etiqueta de fila «${f.nombre}» no cabe en su casilla. Acórtala (~${aprox(wl, ptNombre, 2, K_NEGRITAS)} caracteres).`);
      });
      if (l.notas?.length) {
        const yNotas = Math.min(yEnd + 0.3, 5.8), hNotas = altoFlechasPt(l.notas.map((x: any) => textoDe(x).replace(/^\s*(→|->|➜|•|-)\s*/, '')), CW, 11.5, 4) / 72;
        if (yNotas < yEnd - 0.02) {
          add(`${r}.notas`, `Con ${nf} filas la tabla de muestra llega hasta ${yEnd.toFixed(1)} in y las notas empiezan antes (${yNotas.toFixed(1)} in): se encima el texto. Reduce las filas o pasa la tabla a menos cortes.`);
        } else if (yNotas + hNotas > 6.9) {
          add(`${r}.notas`, `Las notas de la muestra no caben bajo la tabla (se salen por abajo). Deja máximo ${Math.max(1, Math.floor(((6.9 - yNotas) * 72) / (11.5 * 1.2 * 2 + 4)))} nota(s) de una o dos líneas.`);
        }
      }
    }
  });
  return out;
}
