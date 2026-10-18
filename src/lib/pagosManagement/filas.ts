// Lo que se edita en pantalla, tal como se escribe: los rubros del presupuesto (cada uno con su monto) y las personas del reparto (cada una con su
// porcentaje y su monto), con los dos últimos campos ligados (al cambiar uno, el otro se calcula con el presupuesto). El porcentaje es lo que se
// guarda; el monto siempre sale del presupuesto de hoy, repartido de modo que los montos sumen exacto (ver repartirMonto).
import {
  RUBROS, costoDealDe, leerMonto, leerPorcentaje, montoDeRubro, montosDe, partesIguales, porcentajeDeMonto, presupuestoDe, redondear, textoNumero,
  type Moneda, type PersonaReparto, type ProyectoManagement, type Rubro, type RubroPresupuesto, type RubrosDeal,
} from './reparto';

let contador = 0;
const nuevaClave = () => `fila-${++contador}`;

const textoMonto = (n: number): string => String(redondear(n));

// ── Rubros del presupuesto ───────────────────────────────────────────────────
export interface FilaRubro {
  /** Solo para que la pantalla distinga los renglones; no se guarda. */
  clave: string;
  rubro: Rubro;
  /** El monto escrito; vacío = el que dice el deal. */
  texto: string;
}

/** Los rubros con los que abre el presupuesto de un proyecto, cada uno con lo que vale hoy (el monto puesto a mano o el del deal). */
export const rubrosDe = (proyecto: Pick<ProyectoManagement, 'rubros' | 'rubrosDeal'>): FilaRubro[] =>
  proyecto.rubros.map((r) => {
    const monto = montoDeRubro(proyecto.rubrosDeal, r);
    return { clave: nuevaClave(), rubro: r.rubro, texto: monto > 0 ? textoMonto(monto) : '' };
  });

/** Los rubros que todavía se pueden agregar, en el orden de la cotización. */
export const rubrosFaltantes = (filas: FilaRubro[]): Rubro[] => RUBROS.filter((r) => !filas.some((f) => f.rubro === r));

/** Agrega un rubro con lo que el deal dice de él (si dice algo); si ya estaba, no hace nada. */
export const agregarRubro = (filas: FilaRubro[], rubro: Rubro, rubrosDeal: RubrosDeal): FilaRubro[] => {
  if (filas.some((f) => f.rubro === rubro)) return filas;
  const costo = costoDealDe(rubrosDeal, rubro);
  return [...filas, { clave: nuevaClave(), rubro, texto: costo > 0 ? textoMonto(costo) : '' }];
};

/** Quita un rubro; siempre queda al menos uno. */
export const quitarRubro = (filas: FilaRubro[], rubro: Rubro): FilaRubro[] => (filas.length <= 1 ? filas : filas.filter((f) => f.rubro !== rubro));

export const conTextoDeRubro = (filas: FilaRubro[], rubro: Rubro, texto: string): FilaRubro[] => filas.map((f) => (f.rubro === rubro ? { ...f, texto } : f));

/** El presupuesto con el que se calculan los montos: la suma de los rubros (vacío = el del deal). undefined si algún monto escrito no es un monto. */
export function totalDe(filas: FilaRubro[], rubrosDeal: RubrosDeal): number | undefined {
  let total = 0;
  for (const f of filas) {
    const v = leerMonto(f.texto);
    if (v === undefined) return undefined;
    total += v ?? costoDealDe(rubrosDeal, f.rubro);
  }
  return redondear(total);
}

/** ¿Este rubro está cambiado respecto al deal? Solo cuenta donde el deal trae un monto, y en la moneda del deal. */
export function rubroEditado(fila: FilaRubro, rubrosDeal: RubrosDeal, moneda: Moneda, monedaDeal: Moneda): boolean {
  const costo = costoDealDe(rubrosDeal, fila.rubro);
  if (costo <= 0) return false;
  const v = leerMonto(fila.texto);
  if (v === undefined) return false;
  return moneda !== monedaDeal || (v !== null && v !== costo);
}

/**
 * Lo que se guarda del presupuesto: cada rubro con su monto, que es null (vale el del deal) si se dejó vacío o igual al del deal y la moneda es la
 * del deal; y la moneda, que solo se guarda si algún monto se puso a mano. Con una moneda distinta a la del deal todos los montos van a mano.
 * `error` si algo escrito no es un monto.
 */
export function rubrosAGuardar(
  filas: FilaRubro[], moneda: Moneda, proyecto: Pick<ProyectoManagement, 'rubrosDeal' | 'monedaDeal'>,
): { rubros: RubroPresupuesto[]; moneda: Moneda | null } | { error: string } {
  const mismaMoneda = moneda === proyecto.monedaDeal;
  const rubros: RubroPresupuesto[] = [];
  for (const f of filas) {
    const v = leerMonto(f.texto);
    if (v === undefined) return { error: `Escribe el monto de ${f.rubro} como un número, por ejemplo 25000.` };
    const delDeal = costoDealDe(proyecto.rubrosDeal, f.rubro);
    rubros.push({ rubro: f.rubro, monto: mismaMoneda && (v === null || v === delDeal) ? null : v ?? 0 });
  }
  return { rubros, moneda: rubros.some((r) => r.monto !== null) ? moneda : null };
}

// ── Personas del reparto ─────────────────────────────────────────────────────
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

export const filaVacia = (pct = ''): FilaReparto => ({ clave: nuevaClave(), tipo: 'sin', userId: null, nombre: '', nuevoExterno: false, pct, monto: '' });

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
