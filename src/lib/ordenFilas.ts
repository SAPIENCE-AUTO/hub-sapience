// Orden manual de las filas de la lista de eventos (oct 2026): cómo se ordenan las filas de un grupo y qué número le toca a cada una cuando se arrastra una.
// Vive aparte del componente (EventsTable) para poder probarlo sin navegador. Mismo esquema que Tasks.order y RecruitmentRows.rowOrder: números de 1000 en 1000, así
// que cada arrastre renumera solo el grupo donde cae la fila.

/** Separación entre una fila y la siguiente. */
export const PASO_ORDEN = 1000;

export interface FilaOrdenable {
  id: string;
  /** Lugar acomodado a mano; sin valor = nadie la ha arrastrado (un evento nuevo, o todos si en ese grupo no se ha arrastrado nada). */
  rowOrder?: number | null;
}

/**
 * Las filas acomodadas a mano van primero, por su número; las que no (eventos nuevos) van al final, en el orden en que llegaron (por fecha de creación).
 * Así un grupo que nadie ha arrastrado se ve igual que siempre, y un evento recién creado cae al final de su grupo en lugar de saltar hasta arriba.
 */
export function ordenarFilas<T extends FilaOrdenable>(filas: T[]): T[] {
  const tiene = (f: T) => typeof f.rowOrder === 'number';
  return [...filas].sort((a, b) => {
    if (!tiene(a)) return tiene(b) ? 1 : 0;
    if (!tiene(b)) return -1;
    return (a.rowOrder as number) - (b.rowOrder as number);
  });
}

export type DondeSoltar = { filaId: string; posicion: 'before' | 'after' } | 'final';

/**
 * El orden de un grupo después de soltar `arrastrada` en él: antes o después de otra fila (`filaId`), o al final (`'final'`, cuando se suelta sobre el
 * encabezado del grupo). `grupo` es el grupo de destino tal como se ve; si la fila ya estaba ahí se mueve, si venía de otro grupo se mete.
 * Devuelve TODO el grupo renumerado, en el orden nuevo, listo para guardar.
 */
export function ordenTrasSoltar<T extends FilaOrdenable>(grupo: T[], arrastrada: T, donde: DondeSoltar): { id: string; rowOrder: number }[] {
  const resto = ordenarFilas(grupo).filter((f) => f.id !== arrastrada.id);
  let lugar = resto.length;
  if (donde !== 'final') {
    const i = resto.findIndex((f) => f.id === donde.filaId);
    if (i !== -1) lugar = donde.posicion === 'before' ? i : i + 1;
  }
  resto.splice(lugar, 0, arrastrada);
  return resto.map((f, i) => ({ id: f.id, rowOrder: (i + 1) * PASO_ORDEN }));
}

/** ¿Soltar la fila ahí la deja donde ya estaba? Entonces no hay nada que guardar. */
export function quedaDondeEstaba<T extends FilaOrdenable>(grupo: T[], arrastrada: T, donde: DondeSoltar): boolean {
  const actual = ordenarFilas(grupo).map((f) => f.id);
  if (!actual.includes(arrastrada.id)) return false;
  const nuevo = ordenTrasSoltar(grupo, arrastrada, donde).map((f) => f.id);
  return actual.length === nuevo.length && actual.every((id, i) => id === nuevo[i]);
}
