// Qué pasos del proceso de cobranza aplican a una razón social, y si sus datos alcanzan para cobrar y para facturar.
// Las fases son las mismas que ya usa Cobranza (CollectionProcessTab / CobranzaPage); 'Atrasada' no entra: es un aviso aparte, no un paso.

export const FASES_DE_FLUJO = [
  'Por iniciar', 'Proforma creada', 'Proforma enviada', 'Factura creada', 'Factura enviada',
  'Subida al portal', 'GR / Migo', 'Cobranza programada', 'Pagada',
] as const;

export interface BanderasDeProceso {
  requiresProforma?: boolean | null;
  requiresPortal?: boolean | null;
  requiresGr?: boolean | null;
}

/** Los pasos del proceso de ese cliente, en orden: sin las banderas queda factura creada → enviada → cobranza programada → pagada. */
export function fasesQueAplican(c: BanderasDeProceso): string[] {
  return FASES_DE_FLUJO.filter(f => {
    if (f === 'Proforma creada' || f === 'Proforma enviada') return !!c.requiresProforma;
    if (f === 'Subida al portal') return !!c.requiresPortal;
    if (f === 'GR / Migo') return !!c.requiresGr;
    return true;
  });
}

/** `collection_processes.applicable_phases` guarda la lista como JSON; vacío, ilegible o sin pasos → undefined (el proceso muestra todos, como antes). */
export function leerFasesGuardadas(v?: string | null): string[] | undefined {
  if (!v) return undefined;
  try {
    const a = JSON.parse(v);
    return Array.isArray(a) && a.length > 0 && a.every(x => typeof x === 'string') ? a : undefined;
  } catch {
    return undefined;
  }
}

export interface DatosDeRazonSocial extends BanderasDeProceso {
  legalName?: string | null;
  rfc?: string | null;
  taxRegime?: string | null;
  postalCode?: string | null;
  cfdiUse?: string | null;
  creditDays?: number | null;
}

const lleno = (v?: string | null) => !!(v ?? '').trim();

/** Para cobrar solo hacen falta los días de crédito: con ellos la fecha de pago se calcula sola. */
export function faltanParaCobrar(e: DatosDeRazonSocial): string[] {
  return e.creditDays == null ? ['días de crédito'] : [];
}

/** Para facturar (CFDI 4.0) el receptor debe coincidir con lo que el SAT tiene registrado. */
export function faltanParaFacturar(e: DatosDeRazonSocial): string[] {
  const faltan: string[] = [];
  if (!lleno(e.legalName)) faltan.push('razón social');
  if (!lleno(e.rfc)) faltan.push('RFC');
  if (!lleno(e.taxRegime)) faltan.push('régimen fiscal');
  if (!lleno(e.postalCode)) faltan.push('código postal fiscal');
  if (!lleno(e.cfdiUse)) faltan.push('uso del CFDI');
  return faltan;
}
