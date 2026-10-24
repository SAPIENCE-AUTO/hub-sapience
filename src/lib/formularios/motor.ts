import { calcularNse } from './nse';
import { esDelInicio } from './inicio';
import { sinFormato } from './formato';
import { PAISES, nombreCampoDireccion, telefonoDe } from './paises';
import {
  CAMPOS_DIRECCION, esDeOpciones, forma,
  type Condicion, type Definicion, type FotoSubida, type Opcion, type Pregunta, type Respuestas,
  type Resultado, type Seccion, type TipoPregunta, type Valor,
} from './tipos';

/**
 * Motor de Tools → Formularios. Funciones puras: las usa la página pública
 * (qué pantallas mostrar, validar, detectar un descarte a tiempo) y el
 * servidor (calificar con la definición completa, sin confiar en el navegador).
 */

export interface PreguntaVisible {
  pregunta: Pregunta;
  clave: string;
  texto: string;
  ayuda?: string;
  opciones: Opcion[];
}

export interface Pantalla {
  id: string;
  seccion: Seccion;
  instancia?: Opcion;
  titulo?: string;
  intro?: string;
  preguntas: PreguntaVisible[];
}

interface Ubicacion { pregunta: Pregunta; seccion: Seccion }

function indice(def: Definicion): Map<string, Ubicacion> {
  const mapa = new Map<string, Ubicacion>();
  for (const seccion of def.secciones) for (const pregunta of seccion.preguntas) mapa.set(pregunta.id, { pregunta, seccion });
  return mapa;
}

const reemplazar = (texto: string | undefined, instancia?: Opcion) =>
  texto && instancia ? texto.split('{opcion}').join(instancia.corto ?? instancia.label) : texto;

export function seleccion(valor: Valor | undefined): string[] {
  if (Array.isArray(valor)) return valor.filter((v): v is string => typeof v === 'string');
  return typeof valor === 'string' && valor ? [valor] : [];
}

function claveDe(ubic: Ubicacion | undefined, id: string, instancia?: string) {
  return ubic?.seccion.repetirPor && instancia ? `${id}@${instancia}` : id;
}

const RANGOS: Partial<Record<TipoPregunta, [number, number]>> = { escala: [0, 10], estrellas: [1, 5], deslizador: [0, 100] };

/** Rango de una escala, estrellas o deslizador, con lo que se usa si el screener no lo dice. */
export function rango(p: Pregunta): { min: number; max: number; paso: number } {
  const [min, max] = RANGOS[p.tipo] ?? [0, 10];
  return { min: p.tipo === 'estrellas' ? 1 : p.min ?? min, max: p.max ?? max, paso: p.paso ?? 1 };
}

// ── orden aleatorio estable (misma persona, mismo orden al recargar) ─────────
function hash(texto: string) {
  let h = 2166136261;
  for (let i = 0; i < texto.length; i++) { h ^= texto.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function barajar<T>(lista: T[], semilla: string): T[] {
  let s = hash(semilla) || 1;
  const azar = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i--) { const j = Math.floor(azar() * (i + 1)); [copia[i], copia[j]] = [copia[j], copia[i]]; }
  return copia;
}

function mezclar(opciones: Opcion[], aleatorio: boolean | undefined, semilla: string): Opcion[] {
  if (!aleatorio) return opciones;
  const moviles = opciones.filter((o) => !o.fija);
  const fijas = opciones.filter((o) => o.fija);
  return [...barajar(moviles, semilla), ...fijas];
}

// ── opciones y condiciones ───────────────────────────────────────────────────
interface Contexto {
  def: Definicion;
  idx: Map<string, Ubicacion>;
  resp: Respuestas;
  instancia?: string;
  descartes?: Set<string>;
  nseNivel?: string;
}

function opcionesBase(ctx: Contexto, pregunta: Pregunta): Opcion[] {
  if (!pregunta.opcionesDe) return pregunta.opciones ?? [];
  const origen = ctx.idx.get(pregunta.opcionesDe);
  if (!origen) return pregunta.opcionesExtra ?? [];
  const marcadas = new Set(seleccion(ctx.resp[claveDe(origen, origen.pregunta.id, ctx.instancia)]));
  const deOrigen = opcionesBase(ctx, origen.pregunta).filter((o) => marcadas.has(o.id) && !o.exclusiva);
  return [...deOrigen, ...(pregunta.opcionesExtra ?? [])];
}

function instanciasDe(ctx: Contexto, seccion: Seccion): Opcion[] {
  const origen = seccion.repetirPor ? ctx.idx.get(seccion.repetirPor) : undefined;
  if (!origen) return [];
  const marcadas = new Set(seleccion(ctx.resp[origen.pregunta.id]));
  return opcionesBase({ ...ctx, instancia: undefined }, origen.pregunta)
    .filter((o) => marcadas.has(o.id) && !o.exclusiva && (!seccion.repetirSolo || seccion.repetirSolo.includes(o.id)));
}

export function cumple(c: Condicion, ctx: Contexto): boolean {
  if ('todas' in c) return c.todas.every((x) => cumple(x, ctx));
  if ('alguna' in c) return c.alguna.some((x) => cumple(x, ctx));
  if ('no' in c) return !cumple(c.no, ctx);
  if ('instanciaEs' in c) return !!ctx.instancia && c.instanciaEs.includes(ctx.instancia);
  if ('nse' in c) return !!ctx.nseNivel && c.nse.includes(ctx.nseNivel);
  if ('numero' in c) {
    const v = ctx.resp[claveDe(ctx.idx.get(c.numero), c.numero, c.instancia ?? ctx.instancia)];
    return typeof v === 'number' && v >= c.entre[0] && v <= c.entre[1];
  }
  if ('bloque' in c) {
    const seccion = ctx.def.secciones.find((s) => s.id === c.bloque);
    if (!seccion || (seccion.mostrarSi && !cumple(seccion.mostrarSi, { ...ctx, instancia: undefined }))) return false;
    const existe = instanciasDe(ctx, seccion).some((o) => o.id === c.opcion);
    return existe && !ctx.descartes?.has(`${c.bloque}@${c.opcion}`);
  }
  const ubic = ctx.idx.get(c.pregunta);
  const marcadas = seleccion(ctx.resp[claveDe(ubic, c.pregunta, c.instancia ?? ctx.instancia)]);
  if ('incluye' in c) return c.incluye.some((x) => marcadas.includes(x));
  if ('noIncluye' in c) return !c.noIncluye.some((x) => marcadas.includes(x));
  return c.incluyeTodas.every((x) => marcadas.includes(x));
}

// ── NSE en los frentes: alerta, nunca descarte ───────────────────────────────
/** La condición sin lo que pide de NSE. `undefined` = no pide nada más. */
function sinNse(c: Condicion): Condicion | undefined {
  if ('nse' in c) return undefined;
  if ('todas' in c) {
    const resto = c.todas.map(sinNse).filter((x): x is Condicion => !!x);
    return resto.length ? { todas: resto } : undefined;
  }
  if ('alguna' in c) {
    const resto = c.alguna.map(sinNse);
    return resto.some((x) => !x) ? undefined : { alguna: resto as Condicion[] };
  }
  if ('no' in c) {
    const resto = sinNse(c.no);
    return resto ? { no: resto } : undefined;
  }
  return c;
}

const cumpleSinNse = (c: Condicion, ctx: Contexto) => { const resto = sinNse(c); return !resto || cumple(resto, ctx); };

/**
 * Los niveles de NSE que pide el camino por el que la persona entró al frente.
 * `undefined` si ese camino no pide NSE (en una «alguna», basta una rama que
 * no lo pida).
 */
function nivelesPedidos(c: Condicion, ctx: Contexto): string[] | undefined {
  if ('nse' in c) return c.nse;
  if ('todas' in c) {
    const pedidos = c.todas.map((x) => nivelesPedidos(x, ctx)).filter((x): x is string[] => !!x);
    return pedidos.length ? pedidos.reduce((a, b) => a.filter((n) => b.includes(n))) : undefined;
  }
  if ('alguna' in c) {
    const pedidos = c.alguna.filter((x) => cumpleSinNse(x, ctx)).map((x) => nivelesPedidos(x, ctx));
    if (pedidos.length === 0 || pedidos.some((x) => !x)) return undefined;
    return [...new Set(pedidos.flat() as string[])];
  }
  return undefined;
}

const unirO = (lista: string[]) => (lista.length < 2 ? lista.join('') : `${lista.slice(0, -1).join(', ')} o ${lista[lista.length - 1]}`);

// ── pantallas ────────────────────────────────────────────────────────────────
/** Pantallas visibles con las respuestas actuales. Una pantalla = una sección (o una repetición de ella). */
export function pantallas(def: Definicion, resp: Respuestas, semilla = ''): Pantalla[] {
  const idx = indice(def);
  const base: Contexto = { def, idx, resp };
  const out: Pantalla[] = [];
  for (const seccion of def.secciones) {
    if (seccion.mostrarSi && !cumple(seccion.mostrarSi, base)) continue;
    const instancias: (Opcion | undefined)[] = seccion.repetirPor ? instanciasDe(base, seccion) : [undefined];
    for (const instancia of instancias) {
      const ctx = { ...base, instancia: instancia?.id };
      const preguntas = seccion.preguntas
        .filter((p) => !p.mostrarSi || cumple(p.mostrarSi, ctx))
        .map((p) => visible(seccion, p, instancia, opcionesBase(ctx, p), semilla));
      if (preguntas.length === 0) continue;
      out.push(pantalla(seccion, instancia, preguntas));
    }
  }
  return out;
}

function visible(seccion: Seccion, p: Pregunta, instancia: Opcion | undefined, opciones: Opcion[], semilla: string): PreguntaVisible {
  const clave = claveDe({ pregunta: p, seccion }, p.id, instancia?.id);
  return {
    pregunta: p, clave,
    texto: reemplazar(p.texto, instancia)!,
    ayuda: reemplazar(p.ayuda, instancia),
    opciones: mezclar(opciones.map((o) => ({ ...o, label: reemplazar(o.label, instancia)! })), p.aleatorio, `${semilla}:${clave}`),
  };
}

const pantalla = (seccion: Seccion, instancia: Opcion | undefined, preguntas: PreguntaVisible[]): Pantalla => ({
  id: instancia ? `${seccion.id}@${instancia.id}` : seccion.id,
  seccion, instancia,
  titulo: reemplazar(seccion.titulo, instancia),
  intro: reemplazar(seccion.intro, instancia),
  preguntas,
});

/** Todas las opciones que puede llegar a tener: si salen de lo marcado en otra pregunta, todas las de esa. */
function opcionesPosibles(idx: Map<string, Ubicacion>, p: Pregunta, vistas = new Set<string>()): Opcion[] {
  if (!p.opcionesDe) return p.opciones ?? [];
  const origen = idx.get(p.opcionesDe);
  if (!origen || vistas.has(p.id)) return p.opcionesExtra ?? [];
  vistas.add(p.id);
  return [...opcionesPosibles(idx, origen.pregunta, vistas).filter((o) => !o.exclusiva), ...(p.opcionesExtra ?? [])];
}

/**
 * Una sección como la ve el participante sin haber contestado lo de antes,
 * para la vista previa junto al documento: salen todas sus preguntas (aunque
 * algunas solo aparezcan si aplica), las opciones que salen de otra pregunta
 * salen todas y, si la sección se repite, se ve la primera repetición.
 */
export function pantallaDeMuestra(def: Definicion, seccionId: string, semilla = ''): Pantalla | undefined {
  const seccion = def.secciones.find((s) => s.id === seccionId);
  if (!seccion) return undefined;
  const idx = indice(def);
  const origen = seccion.repetirPor ? idx.get(seccion.repetirPor) : undefined;
  const instancia = origen
    ? opcionesPosibles(idx, origen.pregunta).find((o) => !o.exclusiva && (!seccion.repetirSolo || seccion.repetirSolo.includes(o.id)))
    : undefined;
  return pantalla(seccion, instancia, seccion.preguntas.map((p) => visible(seccion, p, instancia, opcionesPosibles(idx, p), semilla)));
}

// ── validación ───────────────────────────────────────────────────────────────
function vacio(v: Valor | undefined): boolean {
  if (v === undefined || v === null || v === '') return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.values(v).every((x) => vacio(x as Valor));
  return false;
}

const SIN_CONTESTAR: Partial<Record<TipoPregunta, string>> = {
  foto: 'Sube la foto',
  casilla: 'Marca la casilla para continuar',
  ordenar: 'Ordena las opciones',
  estrellas: 'Elige cuántas estrellas',
  deslizador: 'Mueve el deslizador',
  direccion: 'Escribe tu dirección',
};

const entreTexto = (min?: number, max?: number) =>
  min !== undefined && max !== undefined ? `entre ${min} y ${max}` : min !== undefined ? `de ${min} o más` : `de ${max} o menos`;

/** Cuántas hay que ordenar: todas, o las primeras `maxOpciones`. */
export const porOrdenar = (pv: PreguntaVisible) => Math.min(pv.pregunta.maxOpciones ?? pv.opciones.length, pv.opciones.length);

export function validar(pv: PreguntaVisible, resp: Respuestas, pais?: string): string | undefined {
  const p = pv.pregunta;
  const v = resp[pv.clave];
  const f = forma(p.tipo);
  if (f === 'ninguna') return undefined;
  if (f === 'matriz_una' || f === 'matriz_varias') {
    const filas = (v as Record<string, string | string[]> | undefined) ?? {};
    const falta = (p.filas ?? []).some((fila) => seleccion(filas[fila.id]).length === 0);
    return falta && !p.opcional ? 'Contesta todas las filas' : undefined;
  }
  if (p.tipo === 'casilla' && !p.opcional && v !== 'si') return SIN_CONTESTAR.casilla;
  if (vacio(v)) return p.opcional ? undefined : SIN_CONTESTAR[p.tipo] ?? 'Contesta esta pregunta';

  if (f === 'direccion') {
    const d = v as Record<string, string>;
    const falta = CAMPOS_DIRECCION.find((c) => !String(d[c] ?? '').trim());
    if (falta) return `Falta: ${nombreCampoDireccion(pais, falta)}`;
    const cp = pais ? PAISES[pais]?.cp : undefined;
    if (cp && !new RegExp(cp.patron).test(d.cp.trim())) return cp.mensaje;
    return undefined;
  }
  if (p.tipo === 'numero') {
    if (typeof v !== 'number' || Number.isNaN(v)) return 'Escribe un número';
    if ((p.min !== undefined && v < p.min) || (p.max !== undefined && v > p.max)) return `Escribe un número ${entreTexto(p.min, p.max)}`;
  }
  if (f === 'numero' && p.tipo !== 'numero') {
    const { min, max } = rango(p);
    if (typeof v !== 'number' || v < min || v > max) return SIN_CONTESTAR[p.tipo] ?? 'Contesta esta pregunta';
  }
  if (p.tipo === 'telefono') {
    const { digitos } = telefonoDe(pais);
    if (String(v).replace(/\D/g, '').length !== digitos) return `Escribe un celular de ${digitos} dígitos`;
  }
  if (p.tipo === 'correo' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v))) return 'Escribe un correo válido';
  if (p.patron && f === 'texto' && !new RegExp(p.patron).test(String(v))) return p.patronMensaje ?? 'Revisa lo que escribiste';
  const marcadas = seleccion(v);
  if (f === 'orden') {
    const faltan = porOrdenar(pv);
    if (marcadas.length < faltan) return faltan === pv.opciones.length ? 'Ordena todas las opciones' : `Elige tus ${faltan} primeras, en orden`;
    return undefined;
  }
  if (f === 'varias' && p.maxOpciones && marcadas.length > p.maxOpciones) return `Marca máximo ${p.maxOpciones}`;
  const otra = pv.opciones.find((o) => o.otra && marcadas.includes(o.id));
  if (otra && !String(resp[`${pv.clave}#otra`] ?? '').trim()) return 'Escribe cuál';
  return undefined;
}

export function validarPantalla(pantalla: Pantalla, resp: Respuestas, pais?: string): Record<string, string> {
  const errores: Record<string, string> = {};
  for (const pv of pantalla.preguntas) {
    const e = validar(pv, resp, pais);
    if (e) errores[pv.clave] = e;
  }
  return errores;
}

// ── calificación ─────────────────────────────────────────────────────────────
/** Opciones marcadas en una pregunta de opciones (una o varias). Las demás no descartan por opción. */
function opcionesMarcadas(pv: PreguntaVisible, resp: Respuestas): Opcion[] {
  if (!esDeOpciones(pv.pregunta.tipo)) return [];
  const marcadas = seleccion(resp[pv.clave]);
  return pv.opciones.filter((o) => marcadas.includes(o.id));
}

const marcoEnFila = (resp: Valor | undefined, fila: string, columnas: string[]) =>
  seleccion((resp as Record<string, string | string[]> | undefined)?.[fila]).some((x) => columnas.includes(x));

/** Primer motivo que termina el formulario, en el orden en que se contestó. */
interface Criterio { motivo: string; clave: string; cortar: boolean }

/**
 * Los criterios de «no califica» que cumple, en orden. Por defecto no cortan
 * el filtro (contesta todo y se registra); cortan solo los marcados `cortar`
 * por el analista, y siempre el aviso y la identificación de «Antes de empezar».
 */
function criteriosCumplidos(def: Definicion, resp: Respuestas, lista: Pantalla[]): Criterio[] {
  const idx = indice(def);
  const out: Criterio[] = [];
  for (const pantalla of lista) {
    for (const pv of pantalla.preguntas) {
      const v = resp[pv.clave];
      if (vacio(v)) continue;
      const p = pv.pregunta;
      const siempre = esDelInicio(p.id);
      for (const o of opcionesMarcadas(pv, resp)) if (o.termina) out.push({ motivo: o.termina, clave: pv.clave, cortar: siempre || !!o.cortar });
      if (p.terminaFuera && typeof v === 'number' && (v < p.terminaFuera.min || v > p.terminaFuera.max)) {
        out.push({ motivo: p.terminaFuera.motivo, clave: pv.clave, cortar: !!p.terminaFuera.cortar });
      }
      for (const r of p.reglasMatriz ?? []) if (r.termina && marcoEnFila(v, r.fila, r.columnas)) out.push({ motivo: r.termina, clave: pv.clave, cortar: !!r.cortar });
      if (p.terminaSi && cumple(p.terminaSi.si, { def, idx, resp, instancia: pantalla.instancia?.id })) {
        out.push({ motivo: p.terminaSi.motivo, clave: pv.clave, cortar: !!p.terminaSi.cortar });
      }
    }
  }
  return out;
}

/** Si el filtro se corta aquí: el primer criterio que corta. Los demás solo se registran (ver evaluar). */
export function terminacion(def: Definicion, resp: Respuestas, lista = pantallas(def, resp)): Resultado['terminado'] {
  const c = criteriosCumplidos(def, resp, lista).find((x) => x.cortar);
  return c && { motivo: c.motivo, clave: c.clave };
}

export function evaluar(def: Definicion, resp: Respuestas): Resultado {
  const idx = indice(def);
  const lista = pantallas(def, resp);
  const criterios = criteriosCumplidos(def, resp, lista);
  const corte = criterios.find((c) => c.cortar);
  const terminado = corte && { motivo: corte.motivo, clave: corte.clave };
  const noCalifica = [...new Set(criterios.map((c) => c.motivo))];

  const descartes: Resultado['descartes'] = [];
  const grupos = new Set<string>();
  for (const pantalla of lista) {
    for (const pv of pantalla.preguntas) {
      for (const o of opcionesMarcadas(pv, resp)) {
        o.excluyeGrupos?.forEach((g) => grupos.add(g));
        if (o.descarta && pantalla.instancia && !descartes.some((d) => d.seccion === pantalla.seccion.id && d.opcion === pantalla.instancia!.id)) {
          descartes.push({ seccion: pantalla.seccion.id, opcion: pantalla.instancia.id, motivo: o.descarta });
        }
      }
      (pv.pregunta.reglasMatriz ?? [])
        .filter((r) => marcoEnFila(resp[pv.clave], r.fila, r.columnas))
        .forEach((r) => r.excluyeGrupos?.forEach((g) => grupos.add(g)));
    }
  }

  const nse = def.nse ? calcularNse(def.nse, resp) : undefined;
  const ctx: Contexto = { def, idx, resp, descartes: new Set(descartes.map((d) => `${d.seccion}@${d.opcion}`)), nseNivel: nse?.nivel };

  // El NSE no saca a nadie de un frente: si no es el que pide, entra con alerta.
  const enFrentes = noCalifica.length ? [] : (def.frentes ?? []).filter((f) => !grupos.has(f.grupo) && cumpleSinNse(f.califica, ctx));
  const fueraDe: string[] = [];
  const alertasNse: string[] = [];
  if (nse) {
    for (const f of enFrentes) {
      const pide = nivelesPedidos(f.califica, ctx);
      if (pide?.length && !pide.includes(nse.nivel)) {
        fueraDe.push(f.id);
        alertasNse.push(`NSE ${nse.nivel}, el perfil ${f.nombre} pide ${unirO(pide)}`);
      }
    }
  }

  const alertas = [
    ...alertasNse,
    ...(def.alertas ?? []).filter((a) =>
      (a.contar && seleccion(resp[a.contar.pregunta]).length > a.contar.masDe) || (a.si && cumple(a.si, ctx)),
    ).map((a) => a.texto),
  ];

  const incompleto = !terminado && lista.some((p) => Object.keys(validarPantalla(p, resp, def.pais)).length > 0);
  const frentes = enFrentes.map((f) => f.id);

  return {
    califica: !noCalifica.length && !incompleto && frentes.length > 0,
    terminado, ...(noCalifica.length ? { noCalifica } : {}), descartes, gruposExcluidos: [...grupos],
    nse: nse && (fueraDe.length ? { ...nse, fueraDe } : nse),
    frentes, alertas, incompleto,
  };
}

/** Por qué no califica, en palabras del panel y del Excel. */
export function explicarResultado(res: Resultado): string | undefined {
  if (res.noCalifica?.length) return res.noCalifica.join(' · ');
  if (res.terminado) return res.terminado.motivo;
  if (res.incompleto) return 'Incompleta';
  if (res.frentes.length > 0) return undefined;
  const motivos = [
    ...res.descartes.map((d) => d.motivo),
    ...res.gruposExcluidos.map((g) => `Fuera de ${g} (rechazo de marca o no se encarga)`),
  ];
  return motivos.join(' · ') || 'No entra a ningún perfil (edad, formato u otra condición del perfil)';
}

// ── lo que puede ver el navegador del participante ───────────────────────────
/**
 * Quita lo interno: perfiles, NSE, alertas, notas, nombres cortos y los motivos de descarte
 * (quedan como «1» para que la página sepa cortar a tiempo sin decir por qué).
 */
export function definicionPublica(def: Definicion): Definicion {
  const limpiarOpcion = (o: Opcion): Opcion => ({
    id: o.id, label: o.label, corto: o.corto, imagen: o.imagen, otra: o.otra, exclusiva: o.exclusiva, fija: o.fija,
    termina: o.termina ? '1' : undefined, descarta: o.descarta ? '1' : undefined,
  });
  return {
    version: def.version, pais: def.pais, tituloPublico: def.tituloPublico, bienvenida: def.bienvenida,
    despedida: def.despedida, noCalifica: def.noCalifica,
    secciones: def.secciones.map((s) => ({
      ...s,
      preguntas: s.preguntas.map((p) => ({
        ...p,
        nombre: undefined,
        nota: undefined,
        opciones: p.opciones?.map(limpiarOpcion),
        opcionesExtra: p.opcionesExtra?.map(limpiarOpcion),
        reglasMatriz: p.reglasMatriz?.filter((r) => r.termina).map((r) => ({ fila: r.fila, columnas: r.columnas, termina: '1' })),
        terminaFuera: p.terminaFuera ? { ...p.terminaFuera, motivo: '1' } : undefined,
        terminaSi: p.terminaSi ? { ...p.terminaSi, motivo: '1' } : undefined,
      })),
    })),
  };
}

// ── para leer una respuesta en el panel, el Excel y el tablero ───────────────
const etiquetaDe = (opciones: Opcion[], id: string) => opciones.find((o) => o.id === id)?.label ?? id;
/** Lo marcado en el orden de las opciones (no en el que se tocó), para que todas las personas se lean igual. */
const enOrdenDeOpciones = (opciones: Opcion[], marcadas: string[]) =>
  [...opciones.filter((o) => marcadas.includes(o.id)).map((o) => o.id), ...marcadas.filter((id) => !opciones.some((o) => o.id === id))];

/** Dirección en una línea: «Calle 1 23, Colonia, Ciudad, Estado, CP 01000». */
export function direccionEnLinea(d: Record<string, string>): string {
  const calle = [d.calle, d.numero].filter(Boolean).join(' ');
  return [calle, d.colonia, d.ciudad, d.estado, d.cp && `CP ${d.cp}`].filter(Boolean).join(', ');
}

/**
 * Una respuesta en texto. `opciones` son las de la pregunta (con «{opcion}»
 * ya reemplazado o no, según quien lo pida). Las fotos y lo que no tiene
 * respuesta dan `undefined`.
 */
export function textoRespuesta(p: Pregunta, opciones: Opcion[], clave: string, resp: Respuestas): string | undefined {
  const v = resp[clave];
  if (vacio(v)) return undefined;
  switch (forma(p.tipo)) {
    case 'ninguna': case 'fotos': return undefined;
    case 'si_no': return v === 'si' ? 'Sí' : 'No';
    case 'numero': return p.tipo === 'numero' ? String(v) : `${v} de ${rango(p).max}`;
    case 'direccion': return direccionEnLinea(v as Record<string, string>);
    case 'orden': return seleccion(v).map((id, i) => `${i + 1}. ${etiquetaDe(opciones, id)}`).join(', ');
    case 'una': case 'varias': {
      const otra = resp[`${clave}#otra`];
      return enOrdenDeOpciones(opciones, seleccion(v)).map((id) => {
        const o = opciones.find((x) => x.id === id);
        if (!o) return id;
        return o.otra && otra ? `${o.label}: ${otra}` : o.label;
      }).join(', ');
    }
    case 'matriz_una': case 'matriz_varias': {
      const filas = v as Record<string, string | string[]>;
      return (p.filas ?? [])
        .map((f) => `${f.label}: ${enOrdenDeOpciones(opciones, seleccion(filas[f.id])).map((id) => etiquetaDe(opciones, id)).join(', ') || '—'}`)
        .join(' · ');
    }
    default: return String(v);
  }
}

export interface Linea { texto: string; valor: string; fotos?: FotoSubida[] }

export function describir(def: Definicion, resp: Respuestas): { titulo: string; lineas: Linea[] }[] {
  return pantallas(def, resp).map((pantalla) => ({
    titulo: pantalla.titulo ?? pantalla.seccion.id,
    lineas: pantalla.preguntas.filter((pv) => !vacio(resp[pv.clave]) && forma(pv.pregunta.tipo) !== 'ninguna').map((pv): Linea => {
      if (pv.pregunta.tipo === 'foto') return { texto: sinFormato(pv.texto), valor: '', fotos: resp[pv.clave] as FotoSubida[] };
      return { texto: sinFormato(pv.texto), valor: textoRespuesta(pv.pregunta, pv.opciones, pv.clave, resp) ?? '' };
    }),
  })).filter((s) => s.lineas.length > 0);
}

/** Texto de la opción elegida (para columnas del panel como género). */
export function etiqueta(def: Definicion, preguntaId: string | undefined, resp: Respuestas): string | undefined {
  if (!preguntaId) return undefined;
  const v = resp[preguntaId];
  const p = indice(def).get(preguntaId)?.pregunta;
  if (v === undefined || !p) return undefined;
  if (typeof v === 'string' && p.opciones) return p.opciones.find((o) => o.id === v)?.label ?? v;
  return String(v);
}
