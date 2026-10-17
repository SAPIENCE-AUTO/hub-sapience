// Formato de las cifras de Indicadores: porcentajes con un decimal y conteos con separador de miles, al estilo de México.
export const fmtPct = (v: number | null): string =>
  v === null ? '—' : `${v.toLocaleString('es-MX', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

export const fmtNum = (v: number): string => v.toLocaleString('es-MX');

/** AAAA-MM-DD → DD/MM/AAAA. */
export const fmtFecha = (iso: string): string => iso.slice(0, 10).split('-').reverse().join('/');

/** Fecha y hora de un instante ISO, en la zona de quien mira: «17 oct 2026, 10:32». */
export const fmtInstante = (iso: string): string =>
  new Date(iso).toLocaleString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).replace('.', '');
