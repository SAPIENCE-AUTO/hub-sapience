import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { trackActivity } from 'zite-endpoints-sdk';
import { BEAT_MS, crearRastreadorDeUso } from '../lib/activityBeat';

// El último latido se comparte entre las ventanas de este navegador para que dos ventanas abiertas no cuenten el mismo tiempo dos veces.
const CLAVE_RELOJ = 'hub-activity-last-beat';
const leerReloj = (): number | null => {
  try { const v = Number(localStorage.getItem(CLAVE_RELOJ)); return Number.isFinite(v) && v > 0 ? v : null; } catch { return null; }
};
const guardarReloj = (t: number) => {
  try { localStorage.setItem(CLAVE_RELOJ, String(t)); } catch { /* sin localStorage cada ventana cuenta por su cuenta */ }
};

// Etiqueta legible de la sección según la ruta — coarse a propósito (una fila
// por sección, no por URL) para que el panel de Actividad de Configuración
// (solo Sergio) se lea de un vistazo. Un proyecto se distingue por código.
export function sectionFromPath(path: string): string {
  const p = path.replace(/\/+$/, '') || '/';
  const proj = p.match(/^\/operacion\/proyectos\/([^/]+)/);
  if (proj) return `Proyecto · ${decodeURIComponent(proj[1])}`;
  const map: [string, string][] = [
    ['/dashboard', 'Dashboard'], ['/chat', 'Chat'], ['/notetaker', 'Notetaker'], ['/sharpli', 'Sharpli'],
    ['/operacion/proyectos', 'Proyectos (lista)'], ['/comercial/crm', 'CRM / Deals'],
    ['/comercial/dashboard', 'Dashboard comercial'], ['/comercial/cotizaciones', 'Cotizaciones'],
    ['/comercial', 'Comercial'], ['/admin/ordenes', 'Órdenes de compra'], ['/admin/proveedores', 'Proveedores'],
    ['/admin/pagos', 'Pagos a proveedores'], ['/admin/facturas-proveedores', 'Facturas de proveedores'],
    ['/admin/cobranza', 'Cobranza'], ['/admin/gastos', 'Comprobación de gastos'],
    ['/finanzas', 'Finanzas'], ['/configuracion', 'Configuración'], ['/tableros', 'Tableros flexibles'],
  ];
  for (const [prefix, label] of map) if (p === prefix || p.startsWith(prefix + '/')) return label;
  return 'Otros';
}

// Latido de uso (oct 2026): mientras la pestaña está visible y la persona hizo algo (mouse/teclado/scroll) en los últimos 2 min, cada ~60s se suman
// los segundos corridos a la sección donde está; una pestaña abierta y olvidada no cuenta como tiempo de uso. Además se avisa de inmediato (0 s, sin
// sumar tiempo) al abrir el Hub, al volver a su pestaña y al volver a tocar algo tras un rato, para que «En línea» salga al instante; y al salir de la
// pestaña se cobra el pedazo de minuto que llevaba. Las reglas viven en lib/activityBeat.ts (con pruebas); aquí solo se conectan a la pantalla.
// Va en Layout para cubrir TODO el Hub, no solo Chat/proyectos como el latido de presencia anterior.
export function useActivityTracker(enabled: boolean) {
  const location = useLocation();
  const sectionRef = useRef(sectionFromPath(location.pathname));

  useEffect(() => { sectionRef.current = sectionFromPath(location.pathname); }, [location.pathname]);

  useEffect(() => {
    if (!enabled) return;
    const rastreador = crearRastreadorDeUso({
      ahora: () => Date.now(),
      visible: () => document.visibilityState === 'visible',
      leerReloj,
      guardarReloj,
      enviar: (segundos) => { trackActivity({ section: sectionRef.current, seconds: segundos }).catch(() => {}); },
    });
    const mark = () => rastreador.interaccion();
    const onVisibility = () => rastreador.visibilidad(document.visibilityState === 'visible');
    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'] as const;
    events.forEach(e => window.addEventListener(e, mark, { passive: true }));
    document.addEventListener('visibilitychange', onVisibility);
    rastreador.abrir();
    const id = setInterval(() => rastreador.latido(), BEAT_MS);
    return () => {
      clearInterval(id);
      events.forEach(e => window.removeEventListener(e, mark));
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled]);
}
