import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import { esNota, tramosDe, type Bloque, type Color, type FilaOpcion, type Linea, type Matriz, type PreguntaDoc, type Tramo } from '../../lib/formularios/documento';
import { COLOR_RESALTADO } from '../../lib/formularios/formato';
import { descargarImagen, esImagenNuestra } from './imagenesEnlace';

// Dibuja el documento del filtro (lib/formularios/documento.ts) en Word y en
// PDF con el mismo diseño: el encabezado de Sapience (la franja gris oscuro
// con el logo, el mismo de la plantilla de las guías y de los filtros del
// equipo, en marca/), A4, Montserrat, cada sección con su franja y cada pregunta en
// un recuadro, con CONTINUAR / TERMINAR / notas en verde, rojo y azul.

const MARCA = path.join(import.meta.dirname, 'marca');
const leerMarca = (archivo: string) => fs.readFileSync(path.join(MARCA, archivo));

const COLORES: Record<Color, string> = { verde: '00B050', rojo: 'FF0000', azul: '0070C0', gris: '7F7F7F', resaltado: COLOR_RESALTADO.slice(1) };
const OSCURO = '262626';
const MEDIO = '595959';
const CLARO = 'F2F2F2';
const LINEA = 'D9D9D9';
const SUAVE = '404040';

interface Imagen { datos: Buffer; ancho: number; alto: number }

/** Las imágenes del documento, achicadas y en JPEG (las que no se pueden traer se omiten). */
async function traerImagenes(bloques: Bloque[]): Promise<Map<string, Imagen>> {
  const urls = new Set<string>();
  for (const b of bloques) {
    if ((b.tipo === 'contenido' || b.tipo === 'pregunta') && b.imagen) urls.add(b.imagen);
    if (b.tipo === 'pregunta') for (const f of b.opciones ?? []) if (f.imagen) urls.add(f.imagen);
  }
  const mapa = new Map<string, Imagen>();
  await Promise.all([...urls].map(async (url) => {
    try {
      let bruto: Buffer;
      const data = /^data:image\/[\w+.-]+;base64,(.+)$/.exec(url);
      if (data) bruto = Buffer.from(data[1], 'base64');
      else if (esImagenNuestra(url)) {
        const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
        if (!r.ok) return;
        bruto = Buffer.from(await r.arrayBuffer());
      } else bruto = (await descargarImagen(url)).datos;
      const { data: datos, info } = await sharp(bruto).rotate().resize(900, 900, { fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' }).jpeg({ quality: 82 }).toBuffer({ resolveWithObject: true });
      mapa.set(url, { datos, ancho: info.width, alto: info.height });
    } catch (err) {
      console.warn('[filtros] imagen omitida en el documento', url.slice(0, 80), (err as Error).message);
    }
  }));
  return mapa;
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ── Word ─────────────────────────────────────────────────────────────────────
const EMU_POR_PULGADA = 914400;
const ANCHO = 9029; // A4 con márgenes de 1": el ancho útil de la plantilla de Sapience

interface FormatoRun {
  negrita?: boolean; tam?: number; mayusculas?: boolean; espaciado?: number;
  /** Color si el tramo no trae el suyo. */
  color?: string;
  /** CONTINUAR / TERMINAR: un poco más abiertas, como etiqueta. */
  etiqueta?: boolean;
}

function run(t: Tramo, o: FormatoRun = {}): string {
  const color = t.color ? COLORES[t.color] : o.color;
  const espaciado = o.espaciado ?? (o.etiqueta && t.negrita ? 10 : undefined);
  const rPr = `${t.negrita || o.negrita ? '<w:b/>' : ''}${t.cursiva ? '<w:i/>' : ''}${t.subrayado ? '<w:u w:val="single"/>' : ''}${o.mayusculas ? '<w:caps/>' : ''}${color ? `<w:color w:val="${color}"/>` : ''}`
    + `${espaciado ? `<w:spacing w:val="${espaciado}"/>` : ''}${o.tam ? `<w:sz w:val="${o.tam}"/><w:szCs w:val="${o.tam}"/>` : ''}`;
  return `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(t.texto)}</w:t></w:r>`;
}
const runs = (l: Linea, o: FormatoRun = {}) => l.map((t) => run(t, o)).join('');

interface FormatoParrafo { antes?: number; despues?: number; centro?: boolean; seguir?: boolean; izquierda?: number }
function parrafo(contenido: string, o: FormatoParrafo = {}): string {
  return `<w:p><w:pPr>${o.seguir ? '<w:keepNext/>' : ''}<w:spacing w:before="${o.antes ?? 0}" w:after="${o.despues ?? 60}"/>`
    + `${o.izquierda ? `<w:ind w:left="${o.izquierda}"/>` : ''}${o.centro ? '<w:jc w:val="center"/>' : ''}</w:pPr>${contenido}</w:p>`;
}
/** Un respiro entre dos tablas (si van pegadas, Word las junta). */
const respiro = (alto = 160) => `<w:p><w:pPr><w:spacing w:before="0" w:after="${alto}"/><w:rPr><w:sz w:val="8"/></w:rPr></w:pPr></w:p>`;

interface Celda { contenido: string; ancho: number; abarca?: number; fondo?: string; centro?: boolean; margen?: number }
const celda = (c: Celda) => `<w:tc><w:tcPr><w:tcW w:w="${c.ancho}" w:type="dxa"/>${c.abarca && c.abarca > 1 ? `<w:gridSpan w:val="${c.abarca}"/>` : ''}`
  + `${c.fondo ? `<w:shd w:val="clear" w:color="auto" w:fill="${c.fondo}"/>` : ''}`
  + `${c.margen ? `<w:tcMar><w:top w:w="${c.margen}" w:type="dxa"/><w:bottom w:w="${c.margen}" w:type="dxa"/></w:tcMar>` : ''}<w:vAlign w:val="center"/></w:tcPr>`
  + `${c.contenido || '<w:p/>'}</w:tc>`;

type Bordes = 'ninguno' | 'caja' | 'rejilla' | 'renglones';
function tabla(anchos: number[], filas: Celda[][], bordes: Bordes = 'ninguno'): string {
  const b = (lado: string, si: boolean) => (si ? `<w:${lado} w:val="single" w:sz="4" w:space="0" w:color="${LINEA}"/>` : `<w:${lado} w:val="nil"/>`);
  const caja = bordes !== 'ninguno' && bordes !== 'renglones';
  const bordesXml = `<w:tblBorders>${b('top', caja || bordes === 'renglones')}${b('left', caja)}${b('bottom', caja || bordes === 'renglones')}${b('right', caja)}`
    + `${b('insideH', bordes === 'rejilla' || bordes === 'renglones')}${b('insideV', bordes === 'rejilla')}</w:tblBorders>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="${anchos.reduce((a, x) => a + x, 0)}" w:type="dxa"/>${bordesXml}<w:tblLayout w:type="fixed"/>`
    + '<w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="110" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="110" w:type="dxa"/></w:tblCellMar><w:tblLook w:val="0000"/></w:tblPr>'
    + `<w:tblGrid>${anchos.map((a) => `<w:gridCol w:w="${a}"/>`).join('')}</w:tblGrid>`
    + filas.map((f) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${f.map(celda).join('')}</w:tr>`).join('')
    + '</w:tbl>';
}

/** La franja oscura de una sección (o de «Muestra»), como la del encabezado. */
const franja = (texto: string) => tabla([ANCHO], [[{
  ancho: ANCHO, fondo: OSCURO, margen: 90,
  contenido: parrafo(run({ texto, negrita: true }, { color: 'FFFFFF', mayusculas: true, espaciado: 20, tam: 21 }), { despues: 0, seguir: true }),
}]]);

class Word {
  medios: { nombre: string; datos: Buffer }[] = [];
  private rels = new Map<string, string>();
  private id = 0;
  constructor(readonly imagenes: Map<string, Imagen>) {}

  /** La imagen en línea, de hasta `maxPulgadas` de ancho y de alto. */
  imagen(url: string, maxPulgadas: number): string {
    const img = this.imagenes.get(url);
    if (!img) return '';
    let rid = this.rels.get(url);
    if (!rid) {
      rid = `rIdImg${this.medios.length + 1}`;
      this.medios.push({ nombre: `imagen${this.medios.length + 1}.jpeg`, datos: img.datos });
      this.rels.set(url, rid);
    }
    const escala = Math.min(maxPulgadas / (img.ancho / 150), maxPulgadas / (img.alto / 150), 1);
    const cx = Math.round((img.ancho / 150) * escala * EMU_POR_PULGADA);
    const cy = Math.round((img.alto / 150) * escala * EMU_POR_PULGADA);
    const id = ++this.id;
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Imagen ${id}"/>`
      + '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
      + `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="imagen${id}.jpeg"/><pic:cNvPicPr/></pic:nvPicPr>`
      + `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
      + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>`
      + '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
  }

  relaciones(): string {
    return [...this.rels.values()].map((rid, i) => `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${this.medios[i].nombre}"/>`).join('');
  }
}

function matrizWord(m: Matriz, ancho: number): string {
  const primera = Math.min(2800, Math.round(ancho * 0.34));
  const resto = Math.floor((ancho - primera) / Math.max(1, m.columnas.length));
  const anchos = [primera, ...m.columnas.map(() => resto)];
  const p = (contenido: string, centro = false) => parrafo(contenido, { despues: 0, centro });
  return tabla(anchos, [
    [{ ancho: primera, fondo: OSCURO, contenido: '' }, ...m.columnas.map((c) => ({
      ancho: resto, fondo: OSCURO, contenido: p(run({ texto: `${c.letra}  `, negrita: true }, { color: 'BFBFBF', tam: 15 }) + run({ texto: c.texto, negrita: true }, { color: 'FFFFFF', tam: 15 }), true),
    }))],
    ...m.filas.map((f) => [
      { ancho: primera, contenido: p(run({ texto: `${f.codigo}  `, negrita: true }, { color: MEDIO, tam: 15 }) + run({ texto: f.texto }, { tam: 16 })) },
      ...f.celdas.map((c) => ({ ancho: resto, contenido: p(runs(c, { tam: 13, etiqueta: true }), true) })),
    ]),
  ], 'rejilla') + '<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:p>';
}

/** Cada pregunta en un recuadro: el número en oscuro, la pregunta en gris claro y debajo sus opciones. */
function preguntaWord(w: Word, b: PreguntaDoc): string {
  const conImagen = !!b.opciones?.some((f) => f.imagen && w.imagenes.has(f.imagen));
  const anchos = conImagen ? [620, 1500, ANCHO - 620 - 1500 - 2700, 2700] : [620, ANCHO - 620 - 2700, 2700];
  const resto = ANCHO - 620;
  const todo = anchos.length;
  // La ayuda (lo que lee el participante) un punto más grande que las notas para el equipo.
  const lineas = (ls: Linea[], seguir: boolean) => ls.map((l) => parrafo(runs(l, { tam: esNota(l) ? 15 : 16, color: SUAVE }), { despues: 30, seguir })).join('');
  const filas: Celda[][] = [[
    { ancho: 620, fondo: OSCURO, centro: true, margen: 70, contenido: parrafo(run({ texto: String(b.numero), negrita: true }, { color: 'FFFFFF', tam: 21 }), { despues: 0, centro: true, seguir: true }) },
    { ancho: resto, abarca: todo - 1, fondo: CLARO, margen: 70, contenido: parrafo(runs(tramosDe(b.texto, { negrita: true }), { tam: 20, color: OSCURO }), { despues: 0, seguir: true }) },
  ]];
  const entera = (contenido: string): Celda[] => [{ ancho: ANCHO, abarca: todo, contenido }];
  if (b.antes.length) filas.push(entera(lineas(b.antes, true)));
  if (b.imagen && w.imagenes.has(b.imagen)) filas.push(entera(parrafo(w.imagen(b.imagen, 3), { despues: 40 })));
  for (const f of b.opciones ?? []) {
    filas.push([
      { ancho: anchos[0], contenido: parrafo(run({ texto: f.codigo, negrita: true }, { color: MEDIO, tam: 15 }), { despues: 0, centro: true }) },
      ...(conImagen ? [{ ancho: anchos[1], contenido: parrafo(f.imagen ? w.imagen(f.imagen, 0.85) : '', { despues: 0 }) }] : []),
      { ancho: anchos[todo - 2], contenido: parrafo(run({ texto: f.texto }, { tam: 16 }), { despues: 0 }) },
      { ancho: anchos[todo - 1], contenido: parrafo(runs(f.instruccion, { tam: 14, etiqueta: true }), { despues: 0 }) },
    ]);
  }
  if (b.matriz) filas.push(entera(matrizWord(b.matriz, ANCHO - 240)));
  if (b.abierta) filas.push(entera(parrafo(run({ texto: b.abierta, cursiva: true, color: 'gris' }, { tam: 16 }), { despues: 0 })));
  if (b.despues.length) filas.push(entera(lineas(b.despues, false)));
  return tabla(anchos, filas, 'caja') + respiro();
}

function cuerpoWord(w: Word, bloques: Bloque[]): string {
  const dosColumnas = (filas: [string, string][], etiqueta = 2300) => tabla([etiqueta, ANCHO - etiqueta], filas.map(([k, v]) => [
    { ancho: etiqueta, contenido: parrafo(run({ texto: k, negrita: true }, { color: MEDIO, tam: 14, mayusculas: true, espaciado: 10 }), { despues: 0 }) },
    { ancho: ANCHO - etiqueta, contenido: parrafo(runs(tramosDe(v), { tam: 18 }), { despues: 0 }) },
  ]), 'renglones');
  return bloques.map((b) => {
    switch (b.tipo) {
      case 'portada':
        return parrafo(run({ texto: 'Filtro de reclutamiento', negrita: true }, { color: MEDIO, mayusculas: true, espaciado: 30, tam: 16 }), { antes: 120, despues: 60 })
          + parrafo(run({ texto: b.titulo, negrita: true }, { color: OSCURO, tam: 44 }), { despues: 280 })
          + dosColumnas(b.ficha) + respiro(240);
      case 'muestra': {
        const anchos = [2500, 1000, ANCHO - 3500];
        const encabezado = (t: string, ancho: number, centro = false): Celda => ({ ancho, fondo: OSCURO, contenido: parrafo(run({ texto: t, negrita: true }, { color: 'FFFFFF', tam: 15 }), { despues: 0, centro, seguir: true }) });
        return franja('Muestra') + respiro(80)
          + tabla(anchos, [
            [encabezado('Perfil', anchos[0]), encabezado('Cuota', anchos[1], true), encabezado('Quién entra', anchos[2])],
            ...b.perfiles.map((p, i) => [
              { ancho: anchos[0], contenido: parrafo(run({ texto: `${i + 1}. `, negrita: true }, { color: MEDIO, tam: 16 }) + run({ texto: p.nombre, negrita: true }, { tam: 17 }), { despues: 0 }) },
              { ancho: anchos[1], contenido: parrafo(run({ texto: String(p.cuota), negrita: true }, { tam: 18 }), { despues: 0, centro: true }) },
              { ancho: anchos[2], contenido: parrafo(run({ texto: p.quien }, { tam: 15, color: SUAVE }), { despues: 0 }) },
            ]),
          ], 'rejilla')
          + b.alertas.map((a) => parrafo(run({ texto: 'Alerta: ', negrita: true, color: 'azul' }) + run({ texto: a, color: 'azul' }), { antes: 60, despues: 0 })).join('')
          + respiro(240);
      }
      case 'bienvenida':
        return tabla([ANCHO], [[{ ancho: ANCHO, fondo: CLARO, margen: 90, contenido:
          parrafo(run({ texto: 'Lo que lee al entrar', negrita: true }, { color: MEDIO, mayusculas: true, espaciado: 10, tam: 14 }), { despues: 40 })
          + parrafo(runs(tramosDe(b.texto, { cursiva: true }), { tam: 17 }), { despues: 0 }) }]]) + respiro(240);
      case 'seccion':
        return franja(b.titulo)
          + b.notas.map((n) => parrafo(run({ texto: n, color: 'azul', cursiva: true }, { tam: 15 }), { antes: 60, despues: 0, seguir: true })).join('')
          + (b.intro ? parrafo(runs(tramosDe(b.intro, { cursiva: true })), { antes: 60, despues: 0, seguir: true }) : '')
          + respiro(140);
      case 'pregunta': return preguntaWord(w, b);
      case 'contenido':
        return (b.texto ? parrafo(runs(tramosDe(b.texto, { cursiva: true })), { despues: 80 }) : '')
          + (b.imagen && w.imagenes.has(b.imagen) ? parrafo(w.imagen(b.imagen, 3.4), { despues: 160 }) : '');
      case 'final':
        return franja('Al terminar') + respiro(80) + dosColumnas([['Si califica', b.califica], ['Si no califica', b.noCalifica]]);
    }
  }).join('');
}

export async function wordDeDocumento(bloques: Bloque[], pie: string): Promise<Buffer> {
  const w = new Word(await traerImagenes(bloques));
  const cuerpo = cuerpoWord(w, bloques);
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
    + '<Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="emf" ContentType="image/x-emf"/>'
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
    + '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>'
    + '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rIdEstilos" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    + '<Relationship Id="rIdEncabezado" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>'
    + `<Relationship Id="rIdPie" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>${w.relaciones()}</Relationships>`);
  // El encabezado tal cual la plantilla de Sapience (su logo es la relación rId1).
  zip.file('word/header1.xml', leerMarca('encabezado.xml'));
  zip.file('word/_rels/header1.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo.emf"/></Relationships>');
  zip.file('word/media/logo.emf', leerMarca('logo.emf'));
  zip.file('word/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Montserrat" w:hAnsi="Montserrat" w:eastAsia="Montserrat" w:cs="Montserrat"/><w:color w:val="1F1F1F"/><w:sz w:val="16"/><w:szCs w:val="16"/><w:lang w:val="es-MX"/></w:rPr></w:rPrDefault>'
    + '<w:pPrDefault><w:pPr><w:spacing w:after="60" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
    + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
    + '<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/></w:style>'
    + '<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/></w:style></w:styles>');
  const pieRun = (t: string) => `<w:r><w:rPr><w:color w:val="7F7F7F"/><w:sz w:val="14"/></w:rPr>${t}</w:r>`;
  zip.file('word/footer1.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="center"/></w:pPr>'
    + pieRun(`<w:t xml:space="preserve">${esc(pie)} · </w:t>`) + pieRun('<w:fldChar w:fldCharType="begin"/>') + pieRun('<w:instrText xml:space="preserve"> PAGE </w:instrText>')
    + pieRun('<w:fldChar w:fldCharType="separate"/>') + pieRun('<w:t>1</w:t>') + pieRun('<w:fldChar w:fldCharType="end"/>') + '</w:p></w:ftr>');
  zip.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">'
    + `<w:body>${cuerpo}<w:p/><w:sectPr><w:headerReference w:type="default" r:id="rIdEncabezado"/><w:footerReference w:type="default" r:id="rIdPie"/>`
    + '<w:pgSz w:w="11909" w:h="16834"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1000" w:left="1440" w:header="720" w:footer="500" w:gutter="0"/></w:sectPr></w:body></w:document>');
  for (const m of w.medios) zip.file(`word/media/${m.nombre}`, m.datos);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// ── PDF ──────────────────────────────────────────────────────────────────────
const tramoHtml = (t: Tramo) => {
  const estilo = [t.negrita && 'font-weight:700', t.cursiva && 'font-style:italic', t.subrayado && 'text-decoration:underline', t.color && `color:#${COLORES[t.color]}`].filter(Boolean).join(';');
  return estilo ? `<span style="${estilo}">${esc(t.texto)}</span>` : esc(t.texto);
};
const lineaHtml = (l: Linea) => l.map(tramoHtml).join('');

/** Montserrat dentro del PDF (el servidor no la tiene instalada). */
let fuentes: string | null = null;
const fuentesCss = () => (fuentes ??= ([['Regular', 400, 'normal'], ['Italic', 400, 'italic'], ['Bold', 700, 'normal'], ['BoldItalic', 700, 'italic']] as const)
  .map(([v, peso, estilo]) => `@font-face { font-family: Montserrat; font-weight: ${peso}; font-style: ${estilo}; src: url(data:font/ttf;base64,${leerMarca(`fuentes/Montserrat-${v}.ttf`).toString('base64')}) format('truetype'); }`)
  .join('\n'));

function htmlDeDocumento(bloques: Bloque[], imagenes: Map<string, Imagen>): string {
  const src = (url?: string) => { const i = url ? imagenes.get(url) : undefined; return i ? `data:image/jpeg;base64,${i.datos.toString('base64')}` : ''; };
  const dosColumnas = (filas: [string, string][]) => `<table class="ficha">${filas.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${lineaHtml(tramosDe(v))}</td></tr>`).join('')}</table>`;
  const opcion = (f: FilaOpcion, conImagen: boolean) => `<tr><td class="cod">${esc(f.codigo)}</td>${conImagen ? `<td class="img">${src(f.imagen) ? `<img src="${src(f.imagen)}">` : ''}</td>` : ''}<td>${esc(f.texto)}</td><td class="ins">${lineaHtml(f.instruccion)}</td></tr>`;
  const matriz = (m: Matriz) => `<table class="matriz"><tr><th></th>${m.columnas.map((c) => `<th><span class="letra">${c.letra}</span>${esc(c.texto)}</th>`).join('')}</tr>`
    + m.filas.map((f) => `<tr><td><span class="letra2">${f.codigo}</span>${esc(f.texto)}</td>${f.celdas.map((c) => `<td class="c">${lineaHtml(c)}</td>`).join('')}</tr>`).join('') + '</table>';
  const pregunta = (b: PreguntaDoc) => {
    const conImagen = !!b.opciones?.some((f) => src(f.imagen));
    return `<div class="tarjeta"><div class="cabeza"><span class="num">${b.numero}</span><span class="texto">${lineaHtml(tramosDe(b.texto, { negrita: true }))}</span></div><div class="cuerpo">`
      + b.antes.map((l) => `<p${esNota(l) ? ' class="nota"' : ''}>${lineaHtml(l)}</p>`).join('')
      + (src(b.imagen) ? `<p><img class="grande" src="${src(b.imagen)}"></p>` : '')
      + (b.opciones ? `<table class="opciones">${b.opciones.map((f) => opcion(f, conImagen)).join('')}</table>` : '')
      + (b.matriz ? matriz(b.matriz) : '')
      + (b.abierta ? `<p class="abierta">${esc(b.abierta)}</p>` : '')
      + b.despues.map((l) => `<p${esNota(l) ? ' class="nota"' : ''}>${lineaHtml(l)}</p>`).join('')
      + '</div></div>';
  };
  const cuerpo = bloques.map((b) => {
    switch (b.tipo) {
      case 'portada': return `<p class="sobre">Filtro de reclutamiento</p><h1>${esc(b.titulo)}</h1>${dosColumnas(b.ficha)}`;
      case 'muestra': return '<div class="seccion"><div class="franja">Muestra</div></div><table class="muestra"><tr><th>Perfil</th><th class="c">Cuota</th><th>Quién entra</th></tr>'
        + b.perfiles.map((p, i) => `<tr><td><b><span class="gris">${i + 1}.</span> ${esc(p.nombre)}</b></td><td class="c"><b>${p.cuota}</b></td><td class="chico">${esc(p.quien)}</td></tr>`).join('')
        + '</table>' + b.alertas.map((a) => `<p class="alerta"><b>Alerta:</b> ${esc(a)}</p>`).join('');
      case 'bienvenida': return `<div class="bienvenida"><p class="sobre">Lo que lee al entrar</p><p><i>${lineaHtml(tramosDe(b.texto))}</i></p></div>`;
      case 'seccion': return `<div class="seccion"><div class="franja">${esc(b.titulo)}</div>${b.notas.map((n) => `<p class="nota-seccion">${esc(n)}</p>`).join('')}${b.intro ? `<p><i>${lineaHtml(tramosDe(b.intro))}</i></p>` : ''}</div>`;
      case 'pregunta': return pregunta(b);
      case 'contenido': return `${b.texto ? `<p><i>${lineaHtml(tramosDe(b.texto))}</i></p>` : ''}${src(b.imagen) ? `<p><img class="grande" src="${src(b.imagen)}"></p>` : ''}`;
      case 'final': return `<div class="seccion"><div class="franja">Al terminar</div></div>${dosColumnas([['Si califica', b.califica], ['Si no califica', b.noCalifica]])}`;
    }
  }).join('\n');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>
    ${fuentesCss()}
    @page { size: A4; margin: 2.6cm 2.54cm 2cm 2.54cm; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: Montserrat, Arial, sans-serif; font-size: 8pt; line-height: 1.38; color: #1F1F1F; margin: 0; }
    p { margin: 0 0 3pt; }
    b { font-weight: 700; }
    .sobre { font-size: 8pt; font-weight: 700; letter-spacing: .15em; text-transform: uppercase; color: #${MEDIO}; margin: 0 0 4pt; }
    h1 { font-size: 22pt; line-height: 1.15; color: #${OSCURO}; margin: 0 0 14pt; }
    table { border-collapse: collapse; width: 100%; }
    tr { break-inside: avoid; }
    .ficha th, .ficha td { border-top: .5pt solid #${LINEA}; border-bottom: .5pt solid #${LINEA}; padding: 4pt 6pt; text-align: left; vertical-align: top; }
    .ficha th { width: 4cm; color: #${MEDIO}; font-size: 7pt; text-transform: uppercase; letter-spacing: .08em; }
    .ficha td { font-size: 9pt; }
    .muestra th { background: #${OSCURO}; color: #fff; font-size: 7.5pt; text-align: left; padding: 4pt 6pt; }
    .muestra td { border: .5pt solid #${LINEA}; padding: 4pt 6pt; vertical-align: top; }
    .muestra td:first-child { width: 4.3cm; font-size: 8.5pt; } .muestra .c { text-align: center; width: 1.7cm; } .muestra td.c { font-size: 9pt; }
    .chico { font-size: 7.5pt; color: #${SUAVE}; } .gris { color: #${MEDIO}; }
    .alerta { color: #${COLORES.azul}; margin-top: 4pt; }
    .bienvenida { background: #${CLARO}; padding: 8pt 10pt; margin: 14pt 0 4pt; break-inside: avoid; }
    .bienvenida .sobre { font-size: 7pt; } .bienvenida p { font-size: 8.5pt; }
    .seccion { margin: 16pt 0 6pt; break-after: avoid; }
    .franja { background: #${OSCURO}; color: #fff; font-weight: 700; text-transform: uppercase; letter-spacing: .1em; font-size: 10.5pt; padding: 6pt 9pt; }
    .nota-seccion { color: #${COLORES.azul}; font-style: italic; font-size: 7.5pt; margin-top: 4pt; }
    .tarjeta { border: .5pt solid #${LINEA}; margin: 0 0 8pt; break-inside: avoid; }
    .cabeza { display: flex; align-items: stretch; background: #${CLARO}; }
    .cabeza .num { background: #${OSCURO}; color: #fff; font-weight: 700; min-width: 1.2cm; display: flex; align-items: center; justify-content: center; font-size: 10.5pt; }
    .cabeza .texto { font-weight: 700; font-size: 10pt; color: #${OSCURO}; padding: 6pt 9pt; }
    .cuerpo { padding: 5pt 9pt 6pt; font-size: 8pt; color: #${SUAVE}; }
    .cuerpo p.nota { font-size: 7.5pt; }
    .opciones td { padding: 1.5pt 3pt; vertical-align: middle; font-size: 8pt; color: #1F1F1F; }
    .opciones td.cod { width: .9cm; font-weight: 700; color: #${MEDIO}; text-align: center; font-size: 7.5pt; }
    .opciones td.img { width: 2.4cm; } .opciones td.img img { max-width: 2.1cm; max-height: 2.1cm; display: block; }
    .opciones td.ins { width: 4.6cm; font-size: 7pt; }
    .opciones td.ins span[style*="700"], .matriz td.c span[style*="700"] { letter-spacing: .05em; }
    .matriz { margin: 3pt 0; }
    .matriz th, .matriz td { border: .5pt solid #${LINEA}; padding: 3pt 4pt; font-size: 8pt; color: #1F1F1F; }
    .matriz td.c { font-size: 6.5pt; } .matriz th { font-size: 7.5pt; }
    .matriz th { background: #${OSCURO}; color: #fff; text-align: center; }
    .matriz .letra { color: #BFBFBF; margin-right: 4pt; } .matriz .letra2 { color: #${MEDIO}; font-weight: 700; margin-right: 5pt; }
    .matriz td.c { text-align: center; }
    .abierta { font-style: italic; color: #7F7F7F; font-size: 8pt; }
    img.grande { max-width: 8cm; max-height: 9cm; }
  </style></head><body>${cuerpo}</body></html>`;
}

export async function pdfDeDocumento(bloques: Bloque[], pie: string): Promise<Buffer> {
  const html = htmlDeDocumento(bloques, await traerImagenes(bloques));
  const logo = `data:image/png;base64,${leerMarca('logo_blanco.png').toString('base64')}`;
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    return Buffer.from(await page.pdf({
      format: 'A4', printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true,
      // La franja del encabezado de Sapience, de lado a lado, como en el Word.
      headerTemplate: `<div style="-webkit-print-color-adjust:exact;position:absolute;top:0;left:0;right:0;height:1.65cm;background:#${OSCURO};display:flex;align-items:center;padding-left:1.05cm"><img src="${logo}" style="height:.62cm"></div>`,
      footerTemplate: `<div style="width:100%;text-align:center;font-family:Montserrat,Arial;font-size:7px;color:#7F7F7F">${esc(pie)} · <span class="pageNumber"></span></div>`,
    }));
  } finally {
    await browser.close();
  }
}
