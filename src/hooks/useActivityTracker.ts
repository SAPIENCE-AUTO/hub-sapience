import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { trackActivity } from 'zite-endpoints-sdk';

const BEAT_MS = 60_000;
const IDLE_MS = 120_000;

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

// Latido de uso (oct 2026): cada ~60s, solo si la pestaña está visible y la
// persona hizo algo (mouse/teclado/scroll) en los últimos 2 min — una pestaña
// abierta y olvidada no cuenta como tiempo de uso. Va en Layout para cubrir
// TODO el Hub, no solo Chat/proyectos como el latido de presencia anterior.
export function useActivityTracker(enabled: boolean) {
  const location = useLocation();
  const sectionRef = useRef(sectionFromPath(location.pathname));
  const lastInteraction = useRef(Date.now());

  useEffect(() => { sectionRef.current = sectionFromPath(location.pathname); }, [location.pathname]);

  useEffect(() => {
    if (!enabled) return;
    const mark = () => { lastInteraction.current = Date.now(); };
    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'] as const;
    events.forEach(e => window.addEventListener(e, mark, { passive: true }));
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastInteraction.current > IDLE_MS) return;
      trackActivity({ section: sectionRef.current, seconds: BEAT_MS / 1000 }).catch(() => {});
    }, BEAT_MS);
    return () => {
      clearInterval(id);
      events.forEach(e => window.removeEventListener(e, mark));
    };
  }, [enabled]);
}
