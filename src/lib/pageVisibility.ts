export interface PageDef {
  key: string;  // matches the exact label stored in the DB multiple_select field
  label: string;
  route: string;
}

export interface PageSectionDef {
  id: string;
  label: string;
  pages: PageDef[];
}

export const PAGE_SECTIONS_DEF: PageSectionDef[] = [
  {
    id: 'general',
    label: 'General',
    pages: [
      { key: 'Dashboard',  label: 'Dashboard', route: '/dashboard' },
      { key: 'Chat',       label: 'Chat',      route: '/chat' },
    ],
  },
  {
    id: 'comercial',
    label: 'Comercial',
    pages: [
      { key: 'CRM / Deals',          label: 'CRM / Deals',          route: '/comercial/crm' },
      { key: 'Dashboard comercial',  label: 'Dashboard comercial',  route: '/comercial/dashboard' },
      { key: 'Cotizaciones',         label: 'Cotizaciones',         route: '/comercial/cotizaciones' },
    ],
  },
  {
    id: 'operacion',
    label: 'Operación',
    pages: [
      { key: 'Proyectos', label: 'Proyectos', route: '/operacion/proyectos' },
    ],
  },
  {
    id: 'admin',
    label: 'Administración',
    pages: [
      { key: 'Órdenes de compra',       label: 'Órdenes de compra',       route: '/admin/ordenes' },
      { key: 'Proveedores',             label: 'Proveedores',             route: '/admin/proveedores' },
      { key: 'Pagos a proveedores',     label: 'Pagos a proveedores',     route: '/admin/pagos' },
      { key: 'Facturas de proveedores', label: 'Facturas de proveedores', route: '/admin/facturas-proveedores' },
      { key: 'Cobranza',                  label: 'Cobranza',                  route: '/admin/cobranza' },
      { key: 'Comprobación de gastos',   label: 'Comprobación de gastos',    route: '/admin/gastos' },
    ],
  },
  {
    id: 'finanzas',
    label: 'Finanzas',
    pages: [
      { key: 'Costos por proyecto',       label: 'Costos por proyecto',       route: '/finanzas/costos' },
      { key: 'Dashboard financiero',      label: 'Dashboard financiero',      route: '/finanzas/dashboard' },
    ],
  },
  {
    id: 'otros',
    label: 'Otros',
    pages: [
      { key: 'Tableros flexibles', label: 'Tableros flexibles', route: '/tableros' },
    ],
  },
];

// Maps route → DB label key (e.g. '/dashboard' → 'Dashboard')
export const ROUTE_TO_PAGE_KEY: Record<string, string> = Object.fromEntries(
  PAGE_SECTIONS_DEF.flatMap(s => s.pages.map(p => [p.route, p.key]))
);

// All valid DB label keys
export const ALL_PAGE_KEYS: string[] = PAGE_SECTIONS_DEF.flatMap(s => s.pages.map(p => p.key));

/**
 * Returns true if the given route should be visible.
 * Compares against DB-stored label values (e.g. "Dashboard", "CRM / Deals").
 * - userPages non-empty → use user's personal override
 * - userPages empty → use globalDefaultPages
 * - both empty → show everything (no restriction configured)
 */
export function isPageVisible(route: string, userPages: string[], defaultPages: string[]): boolean {
  const effective = (userPages?.length ?? 0) > 0 ? userPages : defaultPages;
  if (effective.length === 0) return true;
  const key = ROUTE_TO_PAGE_KEY[route];
  if (!key) return true;
  return effective.includes(key);
}
