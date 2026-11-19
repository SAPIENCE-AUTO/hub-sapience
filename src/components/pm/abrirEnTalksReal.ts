import { toast } from 'sonner';
import { getTalksAccessLink } from 'zite-endpoints-sdk';
import { abrirEnTalks, type ResultadoAbrir, type VentanaTalks } from '@/lib/talksAbrir';

/**
 * Conecta «Abrir en Talks» con lo real: la ventana del navegador, el servidor (getTalksAccessLink) y los avisos. La lógica está en src/lib/talksAbrir.ts
 * (sin React ni servidor, probada en server/scripts/test-talks-acceso.ts). La usan los dos lugares del botón: la ventana del evento (TalksSessionPanel.tsx)
 * y la fila de la lista del calendario (TalksFilaCell.tsx).
 */

/**
 * La ventana en blanco que se abre con el clic. `opener = null` para que Talks, que es otro sitio, no pueda tocar esta ventana del Hub. El texto de espera es
 * solo cortesía: si el navegador no deja escribirlo, no pasa nada.
 */
function abrirVentanaEnBlanco(): VentanaTalks | null {
  const v = window.open('', '_blank');
  if (!v) return null;
  try { v.opener = null; } catch { /* algunos navegadores no lo permiten */ }
  try {
    v.document.title = 'Talks';
    v.document.body.style.cssText = 'font-family:system-ui,sans-serif;color:#555;padding:24px';
    v.document.body.textContent = 'Abriendo Talks...';
  } catch { /* sin texto de espera */ }
  return { navegar: (url) => { v.location.href = url; }, cerrar: () => v.close() };
}

/**
 * Llamarlo directo desde el clic, sin ningún `await` antes: el navegador solo deja abrir la ventana en el instante del clic.
 * Cada llamada pide su propio pase (sirve una sola vez); no se guarda nada.
 */
export function abrirEnTalksDesdeHub(calendarEventId: string, linkEquipo: string): Promise<ResultadoAbrir> {
  return abrirEnTalks({
    linkEquipo,
    abrirVentana: abrirVentanaEnBlanco,
    pedirAcceso: () => getTalksAccessLink({ calendarEventId }),
    avisar: (texto) => toast.warning(texto, { duration: 8000 }),
  });
}
