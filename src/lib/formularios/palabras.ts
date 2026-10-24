import { opcionesDe } from './tabla';
import { sinFormato } from './formato';
import {
  forma,
  type Alerta, type Condicion, type Definicion, type Frente, type Opcion, type Pregunta, type Seccion,
} from './tipos';

/**
 * La lógica de un screener en palabras, como la escribiría una persona: lo
 * que se lee bajo cada pregunta y cada opción en el Documento del editor, y
 * en el mapa del flujo. Funciones puras; no deciden nada (eso es motor.ts),
 * solo lo cuentan.
 */

export interface Ubicada { pregunta: Pregunta; seccion: Seccion }

export function ubicar(def: Definicion, id: string): Ubicada | undefined {
  for (const seccion of def.secciones) for (const pregunta of seccion.preguntas) if (pregunta.id === id) return { pregunta, seccion };
  return undefined;
}

/** «{opcion}» se lee como «…» fuera de la repetición. */
export const sinMarcador = (texto: string) => sinFormato(texto).split('{opcion}').join('…');

/** La pregunta entre comillas, cortada en una palabra si es larga. */
export function citar(def: Definicion, id: string, largo = 60): string {
  const texto = sinMarcador(ubicar(def, id)?.pregunta.texto ?? id).trim();
  if (texto.length <= largo) return `«${texto}»`;
  const corte = texto.slice(0, largo).replace(/\s+\S*$/, '');
  return `«${corte}…»`;
}

export const unirY = (lista: string[]) => (lista.length < 2 ? lista.join('') : `${lista.slice(0, -1).join(', ')} y ${lista[lista.length - 1]}`);
export const unirO = (lista: string[]) => (lista.length < 2 ? lista.join('') : `${lista.slice(0, -1).join(', ')} o ${lista[lista.length - 1]}`);
const unirNi = (lista: string[]) => (lista.length < 2 ? lista.join('') : `${lista.slice(0, -1).join(', ')} ni ${lista[lista.length - 1]}`);

const nombreOpcion = (o: Opcion) => o.corto ?? o.label;

/** Nombre de una repetición: el nombre corto de la opción que la abre («aerosol»). */
function nombreInstancia(def: Definicion, preguntaId: string | undefined, instancia: string): string {
  const s = preguntaId ? ubicar(def, preguntaId)?.seccion : undefined;
  const origen = s?.repetirPor ? ubicar(def, s.repetirPor)?.pregunta : undefined;
  const o = origen ? opcionesDe(def, origen).find((x) => x.id === instancia) : undefined;
  return o ? nombreOpcion(o) : instancia;
}

/** La etiqueta sin su explicación: «Todo propósito: limpiador líquido…» → «Todo propósito», «Aerosol (lata que rocías)» → «Aerosol». */
export function etiquetaCorta(label: string): string {
  const corte = label.search(/:\s| \(/);
  return corte >= 3 ? label.slice(0, corte) : label;
}

function etiquetas(def: Definicion, preguntaId: string, ids: string[]): string[] {
  const p = ubicar(def, preguntaId)?.pregunta;
  if (p && forma(p.tipo) === 'si_no') return ids.map((id) => (id === 'si' ? 'Sí' : id === 'no' ? 'No' : id));
  const opciones = p ? opcionesDe(def, p) : [];
  return ids.map((id) => etiquetaCorta(opciones.find((o) => o.id === id)?.label ?? id));
}

/** ¿Pide todas las opciones de la pregunta? («Marca todo con lo que estás de acuerdo»). */
function sonTodas(def: Definicion, preguntaId: string, ids: string[]): boolean {
  const p = ubicar(def, preguntaId)?.pregunta;
  const todas = p ? opcionesDe(def, p).filter((o) => !o.exclusiva).map((o) => o.id) : [];
  return todas.length > 1 && todas.every((id) => ids.includes(id));
}

/** Título de una sección con «{opcion}» cambiado por el nombre de esa repetición. */
function tituloBloque(def: Definicion, seccionId: string, opcion?: string): string {
  const s = def.secciones.find((x) => x.id === seccionId);
  const titulo = s?.titulo ?? seccionId;
  if (!opcion || !s?.repetirPor) return sinMarcador(titulo);
  const origen = ubicar(def, s.repetirPor)?.pregunta;
  const o = origen ? opcionesDe(def, origen).find((x) => x.id === opcion) : undefined;
  return titulo.split('{opcion}').join(o ? nombreOpcion(o) : opcion);
}

type Rango = Extract<Condicion, { numero: string }>;
/** Si una «o» son solo rangos de la misma pregunta, esos rangos. */
function rangosDeUna(c: Condicion): Rango[] | undefined {
  if (!('alguna' in c) || c.alguna.length < 2) return undefined;
  const rangos = c.alguna.filter((x): x is Rango => 'numero' in x);
  const misma = rangos.length === c.alguna.length && rangos.every((x) => x.numero === rangos[0].numero && x.instancia === rangos[0].instancia);
  return misma ? rangos : undefined;
}

/** Una condición en palabras, sin mayúscula ni punto: «marcó Aromatizantes en «¿Cuáles…?»». */
export function condicionEnPalabras(c: Condicion, def: Definicion): string {
  const compuesta = (x: Condicion) => ('todas' in x && x.todas.length > 1) || ('alguna' in x && x.alguna.length > 1 && !rangosDeUna(x));
  const entre = (x: Condicion) => (compuesta(x) ? `(${condicionEnPalabras(x, def)})` : condicionEnPalabras(x, def));
  if ('todas' in c) {
    // Una «o» dentro de una «y» se anuncia («y alguna de estas: (…) o (…)») para que no se lea «A y B o C».
    return unirY(c.todas.map((x) => ('alguna' in x && x.alguna.length > 1 && !rangosDeUna(x)
      ? `alguna de estas: ${unirO(x.alguna.map(entre))}`
      : entre(x))));
  }
  if ('alguna' in c) {
    // «de 25 a 40 o de 45 a 65 en «¿Cuántos años tienes?»», en vez de repetir la pregunta.
    const rangos = rangosDeUna(c);
    if (rangos) return `contestó ${unirO(rangos.map((x) => `de ${x.entre[0]} a ${x.entre[1]}`))} en ${citar(def, rangos[0].numero)}`;
    return unirO(c.alguna.map(entre));
  }
  if ('no' in c) {
    const n = c.no;
    if ('pregunta' in n && 'incluyeTodas' in n) {
      return sonTodas(def, n.pregunta, n.incluyeTodas)
        ? `no marcó todas las opciones de ${citar(def, n.pregunta)}`
        : `no marcó ${unirY(etiquetas(def, n.pregunta, n.incluyeTodas))} en ${citar(def, n.pregunta)}`;
    }
    if ('pregunta' in n && 'incluye' in n) return condicionEnPalabras({ pregunta: n.pregunta, noIncluye: n.incluye, instancia: n.instancia }, def);
    return `no se cumple que ${condicionEnPalabras(n, def)}`;
  }
  if ('instanciaEs' in c) return `es el bloque de ${unirO(c.instanciaEs.map((i) => nombreInstanciaDeSeccion(def, i)))}`;
  if ('nse' in c) return `su NSE es ${unirO(c.nse)}`;
  if ('bloque' in c) return `tiene el bloque «${tituloBloque(def, c.bloque, c.opcion)}» sin descartarlo`;
  const enBloque = (instancia?: string, preguntaId?: string) => (instancia ? ` (en el bloque de ${nombreInstancia(def, preguntaId, instancia)})` : '');
  if ('numero' in c) {
    const [a, b] = c.entre;
    return `contestó de ${a} a ${b} en ${citar(def, c.numero)}${enBloque(c.instancia, c.numero)}`;
  }
  const p = ubicar(def, c.pregunta)?.pregunta;
  const una = p ? forma(p.tipo) === 'una' || forma(p.tipo) === 'si_no' : false;
  const donde = `en ${citar(def, c.pregunta)}${enBloque(c.instancia, c.pregunta)}`;
  // Una casilla solo se marca o no se marca («Acepto que me contacten»).
  if (p?.tipo === 'casilla' && 'incluye' in c && c.incluye.length === 1 && c.incluye[0] === 'si') return `marcó la casilla ${citar(def, c.pregunta)}`;
  if (p?.tipo === 'casilla' && 'noIncluye' in c && c.noIncluye.length === 1 && c.noIncluye[0] === 'si') return `no marcó la casilla ${citar(def, c.pregunta)}`;
  if ('incluye' in c) return `${una ? 'contestó' : 'marcó'} ${unirO(etiquetas(def, c.pregunta, c.incluye))} ${donde}`;
  if ('noIncluye' in c) return `no ${una ? 'contestó' : 'marcó'} ${unirNi(etiquetas(def, c.pregunta, c.noIncluye))} ${donde}`;
  if (sonTodas(def, c.pregunta, c.incluyeTodas)) return `marcó todas las opciones ${donde}`;
  return `marcó ${unirY(etiquetas(def, c.pregunta, c.incluyeTodas))} ${donde}`;
}

/** `instanciaEs` no dice de qué sección es: se busca la opción en cualquier pregunta que abra repeticiones. */
function nombreInstanciaDeSeccion(def: Definicion, instancia: string): string {
  for (const s of def.secciones) {
    if (!s.repetirPor) continue;
    const origen = ubicar(def, s.repetirPor)?.pregunta;
    const o = origen ? opcionesDe(def, origen).find((x) => x.id === instancia) : undefined;
    if (o) return nombreOpcion(o);
  }
  return instancia;
}

const frase = (texto: string) => `${texto.charAt(0).toUpperCase()}${texto.slice(1)}${/[.!?…]$/.test(texto) ? '' : '.'}`;

/** Perfiles de un grupo de cuota, por su nombre («Aerosoles / Pure y Reeds», o «los 6 perfiles de airwick»). */
function frentesDelGrupo(def: Definicion, grupo: string): string {
  const nombres = (def.frentes ?? []).filter((f) => f.grupo === grupo).map((f) => f.nombre);
  if (nombres.length === 0) return `del grupo ${grupo}`;
  if (nombres.length <= 3) return `de ${unirY(nombres)}`;
  return `de los ${nombres.length} perfiles de ${grupo}`;
}

/**
 * Una línea de lógica en palabras. `tipo` dice de qué color va en el editor;
 * si lleva `motivo`, el editor deja corregir ese pedazo («…no califica:
 * <motivo>») y `campo` dice dónde vive. `tipo: 'termina'` es un criterio de
 * «no califica»; `corta`, que además corta el filtro ahí.
 */
export interface LineaLogica {
  tipo: 'aparece' | 'termina' | 'descarta' | 'excluye' | 'opciones' | 'nse' | 'otro';
  texto: string;
  prefijo?: string;
  motivo?: string;
  campo?: 'termina' | 'descarta' | 'terminaFuera' | 'terminaSi';
  corta?: boolean;
}

/** «no califica: » o, si el analista pidió cortar ahí, «no califica y se corta el filtro: ». */
const noCalifica = (corta?: boolean) => (corta ? 'no califica y se corta el filtro: ' : 'no califica: ');

const conMotivo = (tipo: LineaLogica['tipo'], prefijo: string, motivo: string, campo: LineaLogica['campo']): LineaLogica =>
  ({ tipo, texto: frase(`${prefijo}${motivo}`), prefijo, motivo, campo });

/** Lo que hace marcar esta opción. Vacío si no hace nada especial. */
export function logicaDeOpcion(def: Definicion, p: Pregunta, o: Opcion): LineaLogica[] {
  const si = forma(p.tipo) === 'una' ? 'Si contesta esta' : 'Si la marca';
  const out: LineaLogica[] = [];
  if (o.termina) {
    const corta = !!o.cortar || p.id.startsWith('hub_');
    out.push({ ...conMotivo('termina', `${si}, ${noCalifica(corta)}`, o.termina, 'termina'), corta });
  }
  if (o.descarta) out.push(conMotivo('descarta', `${si}, no cuenta este bloque: `, o.descarta, 'descarta'));
  for (const g of o.excluyeGrupos ?? []) out.push({ tipo: 'excluye', texto: frase(`${si}, queda fuera ${frentesDelGrupo(def, g)}`) });
  if (o.exclusiva) out.push({ tipo: 'otro', texto: 'Al marcarla se quitan las demás.' });
  if (o.otra) out.push({ tipo: 'otro', texto: 'Pide escribir cuál.' });
  if (o.fija && p.aleatorio) out.push({ tipo: 'otro', texto: 'No se mueve con el orden aleatorio.' });
  return out;
}

/** Lo que hace una pregunta además de preguntar: cuándo aparece, de dónde salen sus opciones, qué la termina. */
export function logicaDePregunta(def: Definicion, p: Pregunta): LineaLogica[] {
  const out: LineaLogica[] = [];
  const otro = (texto: string) => out.push({ tipo: 'otro', texto });
  const f = forma(p.tipo);
  if (p.mostrarSi) out.push({ tipo: 'aparece', texto: frase(`Solo aparece si ${condicionEnPalabras(p.mostrarSi, def)}`) });
  if (p.opcionesDe) {
    const extra = (p.opcionesExtra ?? []).map((o) => `«${o.label}»`);
    out.push({ tipo: 'opciones', texto: frase(`Las opciones son las que marcó en ${citar(def, p.opcionesDe)}${extra.length ? `, más ${unirY(extra)}` : ''}`) });
  }
  if (p.aleatorio) otro('Las opciones salen en orden aleatorio.');
  if (p.maxOpciones !== undefined) otro(f === 'orden' ? `Ordena sus ${p.maxOpciones} primeras.` : `Marca hasta ${p.maxOpciones}.`);
  if (p.tipo === 'numero' && (p.min !== undefined || p.max !== undefined)) {
    otro(p.min !== undefined && p.max !== undefined ? `Acepta de ${p.min} a ${p.max}.` : p.min !== undefined ? `Acepta de ${p.min} en adelante.` : `Acepta hasta ${p.max}.`);
  }
  if (p.terminaFuera) {
    out.push({ ...conMotivo('termina', `Si contesta menos de ${p.terminaFuera.min} o más de ${p.terminaFuera.max}, ${noCalifica(p.terminaFuera.cortar)}`, p.terminaFuera.motivo, 'terminaFuera'), corta: !!p.terminaFuera.cortar });
  }
  if (p.terminaSi) {
    const prefijo = `${p.terminaSi.cortar ? 'No califica y se corta el filtro' : 'No califica'} si ${condicionEnPalabras(p.terminaSi.si, def)}: `;
    out.push({ ...conMotivo('termina', prefijo, p.terminaSi.motivo, 'terminaSi'), corta: !!p.terminaSi.cortar });
  }
  for (const r of p.reglasMatriz ?? []) {
    const fila = p.filas?.find((x) => x.id === r.fila)?.label ?? r.fila;
    const cols = unirO(r.columnas.map((id) => p.opciones?.find((o) => o.id === id)?.label ?? id));
    if (r.termina) out.push({ tipo: 'termina', texto: frase(`Si en «${fila}» marca ${cols}, ${noCalifica(r.cortar)}${r.termina}`), corta: !!r.cortar });
    for (const g of r.excluyeGrupos ?? []) out.push({ tipo: 'excluye', texto: frase(`Si en «${fila}» marca ${cols}, queda fuera ${frentesDelGrupo(def, g)}`) });
  }
  if (p.patron && f === 'texto') otro(frase(`Se revisa el formato: ${p.patronMensaje ?? p.patron}`));
  if (p.opcional && f !== 'ninguna') otro('Se puede dejar sin contestar.');
  if (def.nse?.puntos[p.id]) out.push({ tipo: 'nse', texto: `Cuenta para el NSE${def.nse.regla ? ` (${def.nse.regla})` : ''}: es del cuestionario oficial y no se corrige aquí.` });
  return out;
}

export function logicaDeSeccion(def: Definicion, s: Seccion): LineaLogica[] {
  const out: LineaLogica[] = [];
  if (s.mostrarSi) out.push({ tipo: 'aparece', texto: frase(`Solo aparece si ${condicionEnPalabras(s.mostrarSi, def)}`) });
  if (s.repetirPor) {
    const origen = ubicar(def, s.repetirPor)?.pregunta;
    const solo = s.repetirSolo && origen ? ` (solo ${unirO(s.repetirSolo.map((id) => etiquetaCorta(opcionesDe(def, origen).find((o) => o.id === id)?.label ?? id)))})` : '';
    out.push({ tipo: 'opciones', texto: frase(`Se repite por cada opción que marcó en ${citar(def, s.repetirPor)}${solo}`) });
  }
  return out;
}

const pideNse = (c: Condicion): boolean =>
  'nse' in c || ('todas' in c && c.todas.some(pideNse)) || ('alguna' in c && c.alguna.some(pideNse)) || ('no' in c && pideNse(c.no));

export function frenteEnPalabras(def: Definicion, fr: Frente): string {
  const texto = frase(`Entra si ${condicionEnPalabras(fr.califica, def)}`);
  return pideNse(fr.califica) ? `${texto} El NSE no saca a nadie: si no coincide, entra con alerta.` : texto;
}

export function alertaEnPalabras(def: Definicion, a: Alerta): string {
  if (a.contar) return frase(`Si marca más de ${a.contar.masDe} en ${citar(def, a.contar.pregunta)}: ${a.texto}`);
  if (a.si) return frase(`Si ${condicionEnPalabras(a.si, def)}: ${a.texto}`);
  return frase(a.texto);
}
