import pptxgen from 'pptxgenjs';
import { TEAL, GOLD } from '@/lib/toolColors';
import type { ResultadoIdea } from '@/components/swipe/SwipeResultsProjection';

const IDEAS_POR_SLIDE = 6; // grid 3×2, para que no se amontonen
const SLIDE_W = 10; // pulgadas — LAYOUT_16x9
const SLIDE_H = 5.63;
const hex = (color: string) => color.replace('#', '');

async function imagenABase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('No se pudo leer la imagen'));
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * Genera el .pptx 100% en el navegador (sin backend ni un flujo nuevo de
 * n8n) y dispara la descarga. Portada + slide(s) de grid con las
 * ganadoras — si una imagen falla al descargarse (CORS, url caída, etc.)
 * cae a solo texto para esa celda en vez de tronar el export completo.
 */
export async function exportGanadorasPpt(sesionNombre: string, cliente: string | undefined, ideas: ResultadoIdea[]) {
  const pptx = new pptxgen();
  pptx.layout = 'LAYOUT_16x9';

  const portada = pptx.addSlide();
  portada.background = { color: hex(TEAL) };
  portada.addText((cliente ?? 'SAPIENCE').toUpperCase(), {
    x: 0.6, y: 1.9, w: 8.8, h: 0.4, fontSize: 14, bold: true, color: hex(GOLD), charSpacing: 2,
  });
  portada.addText(sesionNombre, { x: 0.6, y: 2.3, w: 8.8, h: 0.9, fontSize: 32, bold: true, color: 'FFFFFF' });
  portada.addText('Ideas ganadoras', { x: 0.6, y: 3.2, w: 8.8, h: 0.5, fontSize: 18, color: 'BFD8DE' });
  const fecha = new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });
  portada.addText(fecha, { x: 0.6, y: 3.75, w: 8.8, h: 0.4, fontSize: 12, color: '8FB6C0' });

  const paginas: ResultadoIdea[][] = [];
  for (let i = 0; i < ideas.length; i += IDEAS_POR_SLIDE) paginas.push(ideas.slice(i, i + IDEAS_POR_SLIDE));

  const cols = 3, rows = 2;
  const marginX = 0.4, marginY = 0.4, gap = 0.25;
  const cellW = (SLIDE_W - marginX * 2 - gap * (cols - 1)) / cols;
  const cellH = (SLIDE_H - marginY * 2 - gap * (rows - 1)) / rows;
  const imgH = cellH * 0.55;

  for (const pagina of paginas) {
    const slide = pptx.addSlide();
    slide.background = { color: 'FFFFFF' };

    for (let idx = 0; idx < pagina.length; idx++) {
      const idea = pagina[idx];
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const x = marginX + col * (cellW + gap);
      const y = marginY + row * (cellH + gap);

      slide.addShape('roundRect', {
        x, y, w: cellW, h: cellH, rectRadius: 0.08,
        fill: { color: 'F7FAFA' }, line: { color: 'E4EBEC', width: 0.75 },
      });

      const base64 = idea.imagenUrl ? await imagenABase64(idea.imagenUrl) : null;

      if (base64) {
        slide.addImage({
          data: base64, x: x + 0.06, y: y + 0.06, w: cellW - 0.12, h: imgH - 0.12,
          sizing: { type: 'contain', w: cellW - 0.12, h: imgH - 0.12 },
        });
      } else {
        // Sin imagen: mismo criterio ya establecido en el resto del
        // producto — el título es el protagonista, no un hueco vacío.
        slide.addShape('rect', { x, y, w: cellW, h: imgH, fill: { color: hex(TEAL) } });
        slide.addText(idea.titulo, {
          x: x + 0.1, y: y + 0.1, w: cellW - 0.2, h: imgH - 0.2,
          fontSize: 13, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle',
        });
      }

      const textY = y + imgH + 0.06;
      if (base64) {
        slide.addText(idea.titulo, { x: x + 0.1, y: textY, w: cellW - 0.2, h: 0.28, fontSize: 11, bold: true, color: hex(TEAL) });
      }
      if (idea.descripcion) {
        const descY = base64 ? textY + 0.26 : textY;
        const descH = cellH - (descY - y) - 0.08;
        slide.addText(idea.descripcion, { x: x + 0.1, y: descY, w: cellW - 0.2, h: Math.max(0.2, descH), fontSize: 8.5, color: '5B687B' });
      }
    }
  }

  const nombreArchivo = `${sesionNombre.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '')}-ideas-ganadoras.pptx`;
  await pptx.writeFile({ fileName: nombreArchivo });
}
