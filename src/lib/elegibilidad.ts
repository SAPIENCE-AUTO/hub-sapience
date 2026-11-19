// Reglas puras de la columna «Elegibilidad» del tablero de Reclutamiento (src/pages/RecruitmentPage.tsx): qué íconos muestra cada persona y cómo se filtra por ellos.
// Sin React ni llamadas al servidor, para poder probarlas (server/scripts/test-elegibilidad-filtro.ts).

/** Triángulo rojo: ya participó en otro proyecto del mismo cliente, sin importar cuándo. */
export const ELEG_TRIANGULO = 'Triángulo';
/** Calendario ámbar: participó en otro proyecto, de cualquier cliente, en los 6 meses anteriores. */
export const ELEG_CALENDARIO = 'Calendario';
export const ELEG_SIN_ICONO = 'Sin ícono';
/** Las opciones del filtro, en el orden en que se listan. Se guardan tal cual en las vistas guardadas: no se renombran. */
export const OPCIONES_ELEGIBILIDAD: string[] = [ELEG_TRIANGULO, ELEG_CALENDARIO, ELEG_SIN_ICONO];

/** Lo que la columna necesita saber de una persona (es lo que devuelve getBoardDuplicateBadges). */
export interface InsigniaElegibilidad {
  hasHighRisk: boolean;
  signals: readonly string[];
  participatedSameClient?: boolean;
  participatedLast6Months?: boolean;
}

/**
 * Los íconos que muestra la celda de una persona. Los dos pueden aparecer a la vez. Si la respuesta viene de un servidor sin las
 * banderas nuevas, se deducen de las señales de siempre. La celda y el filtro usan esta misma regla, para que nunca digan cosas distintas.
 */
export function iconosElegibilidad(b: InsigniaElegibilidad | undefined): { mismoCliente: boolean; ultimos6Meses: boolean } {
  if (!b?.hasHighRisk) return { mismoCliente: false, ultimos6Meses: false };
  return {
    mismoCliente: b.participatedSameClient ?? b.signals.includes('same_client'),
    ultimos6Meses: b.participatedLast6Months ?? b.signals.includes('recent'),
  };
}

/**
 * Con qué opciones del filtro coincide una persona: una por cada ícono que muestra, o «Sin ícono» si no muestra ninguno.
 * Con los dos íconos coincide con «Triángulo» y con «Calendario» (el filtro por un ícono incluye a quien también tiene el otro).
 */
export function valoresElegibilidad(b: InsigniaElegibilidad | undefined): string[] {
  const { mismoCliente, ultimos6Meses } = iconosElegibilidad(b);
  const valores: string[] = [];
  if (mismoCliente) valores.push(ELEG_TRIANGULO);
  if (ultimos6Meses) valores.push(ELEG_CALENDARIO);
  return valores.length > 0 ? valores : [ELEG_SIN_ICONO];
}

// ── Vistas guardadas con el filtro de antes (Sí / No) ────────────────────────────────────────────────────────────────────────────────

/** «Sí» (había alguna alerta) y «No» (no había) de antes, en las opciones nuevas. Cualquier otro valor se deja igual. */
function valorNuevo(v: string): string[] {
  if (v === 'Sí') return [ELEG_TRIANGULO, ELEG_CALENDARIO];
  if (v === 'No') return [ELEG_SIN_ICONO];
  return [v];
}
const unicos = (xs: string[]) => [...new Set(xs)];
const esViejo = (v: unknown) => v === 'Sí' || v === 'No';

type Regla = { column?: string; operator?: string; value?: string; value2?: string; selectedValues?: string[]; [k: string]: unknown };

/** Una regla del filtro avanzado sobre «Elegibilidad» escrita con Sí / No, dicha con las opciones nuevas y con el mismo significado. */
function reglaNueva(r: Regla): Regla | null {
  const seleccion = Array.isArray(r.selectedValues) ? r.selectedValues : [];
  if (!esViejo(r.value) && !seleccion.some(esViejo)) return null; // no usa Sí / No: no se toca
  switch (r.operator) {
    case 'es':
    case 'no_es': {
      const nuevos = valorNuevo(String(r.value ?? ''));
      if (nuevos.length === 1) return { ...r, value: nuevos[0] }; // «No» → «Sin ícono», con el mismo operador
      // «Sí» eran los dos íconos juntos: «es Sí» → «es alguno de» los dos; «no es Sí» → «no es ninguno de» los dos.
      return { ...r, operator: r.operator === 'es' ? 'es_alguno' : 'no_es_ninguno', value: '', selectedValues: nuevos };
    }
    case 'es_alguno':
    case 'no_es_ninguno':
      return { ...r, selectedValues: unicos(seleccion.flatMap(valorNuevo)) };
    default:
      return null;
  }
}

/**
 * Las vistas guardadas cuando el filtro de «Elegibilidad» era Sí / No siguen mostrando lo mismo: «No» (sin alerta) pasa a «Sin ícono» y «Sí» a
 * «Triángulo» y «Calendario». Si la vista no filtra por esa columna (casi todas solo la muestran u ocultan) devuelve el mismo texto, sin tocarlo.
 * Aplicarla dos veces da lo mismo que una.
 */
export function migrarFiltroElegibilidad(filtersJson: string): string {
  // En la base el filtro de una vista puede venir vacío (null): se devuelve tal cual y la vista se abre como siempre.
  if (typeof filtersJson !== 'string' || !filtersJson.includes('_dupRisk')) return filtersJson;
  try {
    const j = JSON.parse(filtersJson);
    if (!j || typeof j !== 'object') return filtersJson;
    let cambio = false;

    const deColumna = j.columnFilters?._dupRisk;
    if (Array.isArray(deColumna) && deColumna.some(esViejo)) {
      j.columnFilters._dupRisk = unicos(deColumna.flatMap((v: string) => valorNuevo(v)));
      cambio = true;
    }

    if (Array.isArray(j.filterRules)) {
      j.filterRules = j.filterRules.map((r: Regla) => {
        if (!r || r.column !== '_dupRisk') return r;
        const nueva = reglaNueva(r);
        if (!nueva) return r;
        cambio = true;
        return nueva;
      });
    }

    return cambio ? JSON.stringify(j) : filtersJson;
  } catch {
    return filtersJson; // un texto que no se entiende se deja como estaba
  }
}
