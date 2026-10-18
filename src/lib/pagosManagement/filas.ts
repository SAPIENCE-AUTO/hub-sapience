// Los renglones del reparto tal como se editan en pantalla: cada persona con su porcentaje y su monto escritos como texto, y los dos campos
// ligados (al cambiar uno, el otro se calcula con el presupuesto). El porcentaje es lo que se guarda; el monto siempre sale del presupuesto de hoy,
// repartido de modo que los montos sumen exacto (ver repartirMonto).
import {
  leerMonto, leerPorcentaje, montosDe, partesIguales, porcentajeDeMonto, presupuestoDe, textoNumero, type Moneda, type PersonaReparto, type ProyectoManagement,
} from './reparto';

export interface FilaReparto {
  /** Solo para que la pantalla distinga los renglones; no se guarda. */
  clave: string;
  /** `sin`: todavía no se elige a la persona. */
  tipo: 'interno' | 'externo' | 'sin';
  userId: string | null;
  nombre: string;
  /** Una persona externa que se escribe a mano (no una ya usada en otro reparto). */
  nuevoExterno: boolean;
  pct: string;
  monto: string;
}

let contador = 0;
const nuevaClave = () => `fila-${++contador}`;

export const filaVacia = (pct = ''): FilaReparto => ({ clave: nuevaClave(), tipo: 'sin', userId: null, nombre: '', nuevoExterno: false, pct, monto: '' });

const textoMonto = (n: number): string => String(Math.round((n + Number.EPSILON) * 100) / 100);

/**
 * Vuelve a calcular el monto de cada renglón a partir de su porcentaje y del presupuesto. Un renglón sin porcentaje se queda sin monto; uno con un
 * porcentaje a medio escribir («3.») conserva el que tenía; sin presupuesto ninguno tiene monto.
 */
export function recalcular(filas: FilaReparto[], base: number | undefined): FilaReparto[] {
  const porcentajes = filas.map((f) => leerPorcentaje(f.pct));
  const validos = filas.map((_, i) => i).filter((i) => typeof porcentajes[i] === 'number');
  const montos = base !== undefined && base > 0 ? montosDe(base, validos.map((i) => ({ porcentaje: porcentajes[i] as number }))) : null;
  return filas.map((f, i) => {
    const p = porcentajes[i];
    if (p === null) return { ...f, monto: '' };
    if (p === undefined || base === undefined) return f;
    const k = validos.indexOf(i);
    return { ...f, monto: montos ? textoMonto(montos[k]) : '' };
  });
}

/** Los renglones con los que abre el reparto de un proyecto: sus personas o, si no tiene, un renglón vacío. */
export function filasDe(proyecto: ProyectoManagement): FilaReparto[] {
  if (proyecto.personas.length === 0) return [filaVacia()];
  return recalcular(
    proyecto.personas.map((p) => ({
      clave: nuevaClave(), tipo: p.externo ? 'externo' : 'interno', userId: p.userId, nombre: p.nombre, nuevoExterno: false, pct: textoNumero(p.porcentaje), monto: '',
    })),
    presupuestoDe(proyecto),
  );
}

/** El presupuesto con el que se calculan los montos: el escrito o, si se deja vacío, el del deal. undefined si lo escrito no es un monto. */
export function baseDe(presupuestoTexto: string, montoDeal: number): number | undefined {
  const v = leerMonto(presupuestoTexto);
  return v === undefined ? undefined : v ?? montoDeal;
}

/** Cambió el porcentaje de un renglón: los montos se vuelven a calcular. */
export const conPorcentaje = (filas: FilaReparto[], i: number, texto: string, base: number | undefined): FilaReparto[] =>
  recalcular(filas.map((f, j) => (j === i ? { ...f, pct: texto } : f)), base);

/**
 * Cambió el monto de un renglón: su porcentaje se calcula (sin presupuesto no hay con qué calcularlo) y el monto queda como se escribió. Los
 * otros renglones no se tocan.
 */
export function conMonto(filas: FilaReparto[], i: number, texto: string, base: number | undefined): FilaReparto[] {
  const m = leerMonto(texto);
  return filas.map((f, j) => {
    if (j !== i) return f;
    if (m === null) return { ...f, monto: texto, pct: '' };
    if (typeof m === 'number' && base !== undefined && base > 0) return { ...f, monto: texto, pct: textoNumero(porcentajeDeMonto(base, m)) };
    return { ...f, monto: texto };
  });
}

/** Cambió el presupuesto: los porcentajes se quedan y los montos se vuelven a calcular. */
export const conBase = (filas: FilaReparto[], base: number | undefined): FilaReparto[] => recalcular(filas, base);

/** Todos los renglones con el mismo porcentaje, sumando exactamente 100. */
export function conPartesIguales(filas: FilaReparto[], base: number | undefined): FilaReparto[] {
  const partes = partesIguales(filas.length);
  return recalcular(filas.map((f, i) => ({ ...f, pct: textoNumero(partes[i]) })), base);
}

const vacia = (f: FilaReparto) => f.tipo === 'sin' && f.pct.trim() === '' && f.monto.trim() === '';

/**
 * Las personas del reparto tal como se van a guardar. Los renglones totalmente vacíos se ignoran; un porcentaje sin sentido sale como NaN (para
 * que la validación lo reclame) y uno que pasa de 100 se deja pasar tal cual (para que se diga que pasa de 100, no que «no es un número»).
 */
export function personasDe(filas: FilaReparto[]): PersonaReparto[] {
  return filas.filter((f) => !vacia(f)).map((f) => {
    const crudo = f.pct.trim().replace(/%$/, '').trim().replace(',', '.');
    return {
      userId: f.tipo === 'interno' ? f.userId : null,
      nombre: f.nombre,
      externo: f.tipo === 'externo',
      porcentaje: /^\d+(\.\d+)?$/.test(crudo) ? Number(crudo) : Number.NaN,
    };
  });
}

/**
 * Lo que se guarda como presupuesto: null si vale el del deal (campo vacío o igual al del deal, en su misma moneda), o el monto escrito con su moneda.
 * `error` si lo escrito no es un monto.
 */
export function presupuestoAGuardar(
  texto: string, moneda: Moneda, proyecto: Pick<ProyectoManagement, 'montoDeal' | 'monedaDeal'>,
): { presupuesto: number | null; moneda: Moneda | null } | { error: string } {
  const v = leerMonto(texto);
  if (v === undefined) return { error: 'Escribe el presupuesto como un monto, por ejemplo 25000.' };
  if (v === null || (v === proyecto.montoDeal && moneda === proyecto.monedaDeal)) return { presupuesto: null, moneda: null };
  return { presupuesto: v, moneda };
}
