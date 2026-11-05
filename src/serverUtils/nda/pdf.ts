// El PDF del NDA firmado: el texto con el nombre de quien firmó, su firma dibujada, la fecha y una constancia (cuándo se envió, cuándo abrió la liga, cuándo firmó, desde qué IP y dispositivo,
// y la huella del texto exacto). Se arma como HTML y se imprime con Chrome (puppeteer), igual que los PDF de Filtros y de las ODC; la marca (logo y Montserrat) sale de formularios/marca.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { NDA_SECCIONES, NDA_TEXTO_VERSION, NDA_TITULO, escaparHtml, fechaHoraMx, limpiarNombre } from './correo';

export interface DatosPdf {
  envioId: string;
  /** El nombre que la persona confirmó al firmar. */
  nombre: string;
  correo: string;
  /** La firma, PNG en base64 (sin el prefijo data:). */
  firmaPng: string;
  firmadoAt: Date;
  enviadoAt?: Date | null;
  abiertoAt?: Date | null;
  ip?: string | null;
  userAgent?: string | null;
  textoHash: string;
  textoVersion?: string;
  /** El renglón «Sesión: …» tal como lo vio la persona (sin el rótulo), si se conocía. */
  sesion?: string | null;
}

export const sha256 = (dato: string | Buffer) => crypto.createHash('sha256').update(dato).digest('hex');

const MARCA = path.join(import.meta.dirname, '../formularios/marca');
const leerMarca = (archivo: string) => fs.readFileSync(path.join(MARCA, archivo));
const OSCURO = '262626';

let fuentes: string | undefined;
const fuentesCss = () => (fuentes ??= ([['Regular', 400], ['Bold', 700]] as const)
  .map(([v, peso]) => `@font-face { font-family: Montserrat; font-weight: ${peso}; font-style: normal; src: url(data:font/ttf;base64,${leerMarca(`fuentes/Montserrat-${v}.ttf`).toString('base64')}) format('truetype'); }`)
  .join('\n'));

const fecha = (d?: Date | null) => (d ? fechaHoraMx(d) : '—');

export function htmlDelPdf(d: DatosPdf): string {
  const nombre = escaparHtml(limpiarNombre(d.nombre));
  const secciones = NDA_SECCIONES.map(
    (s) => `<h2>${escaparHtml(s.titulo)}</h2>${s.parrafos.map((p) => `<p>${escaparHtml(p)}</p>`).join('')}`,
  ).join('');
  const dispositivo = escaparHtml((d.userAgent ?? '').slice(0, 160) || 'No disponible');
  const filas: [string, string][] = [
    ['Documento', escaparHtml(d.envioId)],
    ['Enviado a', escaparHtml(d.correo)],
    ['Enviado el', fecha(d.enviadoAt)],
    ['Abrió la liga el', fecha(d.abiertoAt)],
    ['Firmado el', fecha(d.firmadoAt)],
    ['Dirección IP', escaparHtml(d.ip || 'No disponible')],
    ['Dispositivo', dispositivo],
    ['Versión del texto', escaparHtml(d.textoVersion ?? NDA_TEXTO_VERSION)],
    ['Huella (SHA-256) del texto', `<span class="mono">${escaparHtml(d.textoHash)}</span>`],
  ];
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>
    ${fuentesCss()}
    @page { size: A4; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Montserrat, Arial, sans-serif; font-size: 9pt; line-height: 1.6; color: #1F1F1F; }
    h1 { font-size: 10.5pt; font-weight: 700; margin: 0 0 12pt; line-height: 1.4; }
    .sesion { margin: 0 0 14pt; padding: 6pt 10pt; background: #F2F2F2; text-align: left; }
    h2 { font-size: 9.5pt; font-weight: 700; margin: 14pt 0 4pt; }
    p { margin: 0 0 6pt; text-align: justify; }
    .firma { margin-top: 26pt; page-break-inside: avoid; }
    .firma img { display: block; height: 52pt; max-width: 70mm; object-fit: contain; object-position: left bottom; }
    .firma .linea { border-top: .75pt solid #1F1F1F; width: 78mm; padding-top: 3pt; margin-top: 2pt; }
    .firma .fecha { margin-top: 8pt; }
    .constancia { margin-top: 24pt; padding: 10pt 12pt; border: .75pt solid #D9D9D9; background: #F7F7F7; page-break-inside: avoid; }
    .constancia h3 { margin: 0 0 6pt; font-size: 8pt; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: #595959; }
    .constancia table { border-collapse: collapse; width: 100%; }
    .constancia th, .constancia td { font-size: 7.5pt; line-height: 1.45; padding: 1.5pt 0; vertical-align: top; text-align: left; color: #404040; }
    .constancia th { width: 34mm; font-weight: 700; color: #595959; padding-right: 8pt; }
    .constancia td { word-break: break-word; }
    .mono { font-family: Menlo, Consolas, monospace; font-size: 6.5pt; }
  </style></head><body>
    ${d.sesion ? `<p class="sesion"><b>Sesión:</b> ${escaparHtml(d.sesion)}</p>` : ''}
    <h1>${escaparHtml(NDA_TITULO)}</h1>
    <p>Yo, <b>${nombre}</b> (nombre completo), declaro que:</p>
    ${secciones}
    <div class="firma">
      <img src="data:image/png;base64,${d.firmaPng}">
      <div class="linea">Firma del participante: ${nombre}</div>
      <div class="fecha">Fecha: ${fecha(d.firmadoAt)}</div>
    </div>
    <div class="constancia">
      <h3>Constancia de firma electrónica</h3>
      <table>${filas.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>
    </div>
  </body></html>`;
}

// Un solo Chrome a la vez: cada uno gasta cientos de MB y una tanda de firmas no debe tumbar el servidor.
let cola: Promise<unknown> = Promise.resolve();
export function enCola<T>(trabajo: () => Promise<T>): Promise<T> {
  const p = cola.then(trabajo, trabajo);
  cola = p.catch(() => undefined);
  return p;
}

export async function generarPdfNda(d: DatosPdf): Promise<Buffer> {
  const html = htmlDelPdf(d);
  const logo = `data:image/png;base64,${leerMarca('logo_blanco.png').toString('base64')}`;
  return enCola(async () => {
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      return Buffer.from(await page.pdf({
        format: 'A4', printBackground: true, displayHeaderFooter: true,
        margin: { top: '2.6cm', bottom: '1.9cm', left: '1.9cm', right: '1.9cm' },
        // La franja del encabezado de Sapience, de lado a lado, como en los documentos de Filtros.
        headerTemplate: `<div style="-webkit-print-color-adjust:exact;position:absolute;top:0;left:0;right:0;height:1.65cm;background:#${OSCURO};display:flex;align-items:center;padding-left:1.9cm"><img src="${logo}" style="height:.62cm"></div>`,
        footerTemplate: `<div style="width:100%;text-align:center;font-family:Arial;font-size:7px;color:#7F7F7F">Acuerdo firmado electrónicamente · ${escaparHtml(d.envioId.slice(0, 8))} · Página <span class="pageNumber"></span> de <span class="totalPages"></span></div>`,
      }));
    } finally {
      await browser.close();
    }
  });
}
