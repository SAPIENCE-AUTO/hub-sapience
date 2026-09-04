import pptxgen from 'pptxgenjs';
import { TEAL, GOLD } from '@/lib/toolColors';

const hex = (color: string) => color.replace('#', '');

/**
 * Genera un .pptx de una sola imagen (el gráfico exportado del módulo de
 * Análisis IA) 100% en el navegador, mismo patrón que
 * exportSwipeGanadorasPpt.ts (layout 16:9, portada teal/gold) para que se
 * vea consistente con el resto de exports del Hub.
 */
export async function exportChartPpt(titulo: string, imageDataUrl: string) {
  const pptx = new pptxgen();
  pptx.layout = 'LAYOUT_16x9';

  const slide = pptx.addSlide();
  slide.background = { color: 'FFFFFF' };

  slide.addShape('rect', { x: 0, y: 0, w: 10, h: 0.7, fill: { color: hex(TEAL) } });
  slide.addText(titulo || 'Análisis de ventas', {
    x: 0.4, y: 0, w: 9.2, h: 0.7, fontSize: 18, bold: true, color: 'FFFFFF', valign: 'middle',
  });
  slide.addShape('rect', { x: 0, y: 0.7, w: 10, h: 0.04, fill: { color: hex(GOLD) } });

  slide.addImage({
    data: imageDataUrl,
    x: 0.5, y: 1.1, w: 9, h: 4.3,
    sizing: { type: 'contain', w: 9, h: 4.3 },
  });

  const fecha = new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });
  slide.addText(fecha, { x: 0.5, y: 5.45, w: 9, h: 0.3, fontSize: 10, color: '8FB6C0' });

  const nombreArchivo = `${(titulo || 'analisis-ventas').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '')}.pptx`;
  await pptx.writeFile({ fileName: nombreArchivo });
}
