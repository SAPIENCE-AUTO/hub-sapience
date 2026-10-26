import { duracionEstimada, duracionPorSeccion, type Duracion } from './duracion';
import { idNuevo } from './editar';
import { SECCION_INICIO, inicioPrimero, seccionInicio } from './inicio';
import { preguntasNse, reglaNse } from './nse';
import { preguntasDeCondicion } from './flujo';
import { condicionEnPalabras, frenteEnPalabras, logicaDeOpcion, logicaDePregunta } from './palabras';
import { esDeOpciones, esMatriz, forma, type Definicion, type Opcion, type Pregunta, type Seccion, type TipoPregunta } from './tipos';

/**
 * El generador con IA de Filtros (fase 3), en lo que es lógica pura: lo que
 * guarda (`formularios.generador`), la estructura de la etapa 1 y cómo se
 * compara con lo ya escrito para conservar lo que no cambió.
 *
 * La IA trabaja en dos etapas, como la guía de tópicos: primero la estructura
 * (país, perfil, frentes, secciones en orden de embudo y supuestos), que se
 * revisa rápido, y después las preguntas, sección por sección. La estructura
 * ya trae las preguntas en una línea y las opciones que usa la lógica, con
 * sus ids, para que cada sección se pueda escribir aparte sin romper lo que
 * otras usan de ella.
 */

// ── lo que se guarda ─────────────────────────────────────────────────────────
export type OrigenGenerador = 'insumos' | 'word' | 'filtro';

export interface ArchivoInsumo {
  id: string;
  nombre: string;
  /** Imagen y Excel: los de la muestra del proyecto (Reclutamiento → Muestra). */
  tipo: 'pdf' | 'docx' | 'pptx' | 'xlsx' | 'imagen';
  /** PDF e imagen: ruta en la carpeta privada `formularios`. La IA lo lee completo, con tablas e imágenes. */
  ruta?: string;
  /** Imagen: su tipo (image/jpeg, image/png…). */
  mime?: string;
  /** Word, PowerPoint y Excel: su texto (las tablas, un renglón por fila con « | »). */
  texto?: string;
  caracteres?: number;
}

export interface ReunionInsumo { id: string; titulo: string; fecha?: string }

export interface Insumos {
  notas?: string;
  archivos: ArchivoInsumo[];
  /** Reuniones de Notetaker: su transcripción se lee de `meeting_recordings` en cada llamada. */
  reuniones: ReunionInsumo[];
  /** Origen «filtro»: de dónde se copió. */
  filtroBase?: { id: string; titulo: string };
}

export interface PreguntaPlan {
  id: string;
  tipo: TipoPregunta;
  texto: string;
  /** Nombre corto: el de su columna en el tablero («Edad»). No entra en la firma: cambiarlo no reescribe la sección. */
  nombre?: string;
  /** De opciones, matriz u ordenar. Sus ids se conservan al escribir la sección: la lógica de otras secciones los usa. */
  opciones?: { id: string; label: string; corto?: string }[];
  filas?: { id: string; label: string }[];
  /** Sus opciones salen de las marcadas en esta pregunta. */
  opcionesDe?: string;
  /** En palabras, si solo aparece en ciertos casos («solo si compra aromatizantes»). */
  soloSi?: string;
  /** Lo que hace además de preguntar, en palabras («termina si marca publicidad»). */
  logica?: string;
}

export interface SeccionPlan {
  id: string;
  titulo: string;
  /** Para qué está en el screener, en una frase. */
  para: string;
  /** En palabras, si solo aparece en ciertos casos. */
  aparece?: string;
  /** Ids de las preguntas de las que depende `aparece` (para dibujar la rama en el flujo). */
  segun?: string[];
  /** Se repite por cada opción marcada en esta pregunta, de una sección anterior. */
  repetirPor?: string;
  repetirSolo?: string[];
  /** Aquí van las preguntas oficiales del NSE del país: no las escribe la IA. */
  nse?: boolean;
  preguntas: PreguntaPlan[];
  /** Solo al ajustar una estructura: la IA dice si esta sección cambia. Si no cambia, se queda la de antes tal cual. */
  cambia?: boolean;
}

export interface FrentePlan {
  id: string; nombre: string; grupo: string; meta: number; quien: string;
  /** El perfil de la muestra del proyecto del que sale (nombre y cuota se cambian en Muestra). */
  perfilMuestra?: string;
}

export interface Estructura {
  pais: string;
  tituloPublico: string;
  perfil: string;
  frentes: FrentePlan[];
  secciones: SeccionPlan[];
  supuestos: string[];
}

export interface SeccionEscrita {
  seccion: Seccion;
  /** Firma del plan de la sección con el que se escribió (ver `firmaSeccion`). */
  firma: string;
}

export interface Generador {
  origen: OrigenGenerador;
  insumos: Insumos;
  etapa: 'insumos' | 'estructura' | 'preguntas' | 'listo';
  estructura?: Estructura;
  /**
   * La estructura de lo que ya estaba escrito cuando se pidió la última (al
   * ajustar un filtro escrito o al partir de uno anterior). Contra ella se
   * decide qué secciones no cambian.
   */
  base?: Estructura;
  /** Lo que la IA ya escribió, por sección: si se cierra la ventana, no se pierde. */
  escritas: Record<string, SeccionEscrita>;
  /** Secciones ya puestas en el screener guardado, con la firma del plan con que se escribieron. */
  aplicadas: Record<string, string>;
  supuestosSecciones: Record<string, string[]>;
  supuestosLogica: string[];
  /** La lógica de frentes, alertas y textos ya se armó con esta estructura. */
  logicaLista?: boolean;
  supuestosRevisados: boolean;
}

export function generadorNuevo(origen: OrigenGenerador, filtroBase?: Insumos['filtroBase']): Generador {
  return {
    origen,
    insumos: { archivos: [], reuniones: [], ...(filtroBase ? { filtroBase } : {}) },
    etapa: 'insumos',
    escritas: {},
    aplicadas: {},
    supuestosSecciones: {},
    supuestosLogica: [],
    supuestosRevisados: false,
  };
}

/** Lee lo guardado aunque le falten campos (se fueron agregando). */
export function leerGenerador(guardado: unknown): Generador | undefined {
  if (!guardado || typeof guardado !== 'object') return undefined;
  const g = guardado as Partial<Generador>;
  return {
    ...generadorNuevo(g.origen ?? 'insumos'),
    ...g,
    insumos: { archivos: [], reuniones: [], ...g.insumos },
  } as Generador;
}

/** Un screener vacío para empezar con la IA: textos neutros que la IA ajusta al final. */
export function definicionVacia(pais = 'MX'): Definicion {
  return {
    version: 2,
    pais,
    tituloPublico: 'Estudio de opinión',
    bienvenida: '¡Hola! Te invitamos a contestar unas preguntas para un estudio de opinión. Tus respuestas son confidenciales y solo se usan para investigación.',
    despedida: '¡Gracias! Revisaremos tus respuestas y, si tu perfil coincide con lo que buscamos, te contactaremos.',
    noCalifica: '¡Gracias por tu tiempo! Por ahora tu perfil no coincide con lo que buscamos para este estudio.',
    secciones: [],
  };
}

/** Todos los supuestos, en el orden del screener, con la sección de la que salen. */
export function supuestosDe(g: Generador): { texto: string; seccion?: string }[] {
  const out: { texto: string; seccion?: string }[] = (g.estructura?.supuestos ?? []).map((texto) => ({ texto }));
  for (const s of g.estructura?.secciones ?? []) for (const texto of g.supuestosSecciones[s.id] ?? []) out.push({ texto, seccion: s.id });
  for (const texto of g.supuestosLogica) out.push({ texto, seccion: 'frentes' });
  return out;
}

// ── firma: ¿cambió el plan de una sección? ───────────────────────────────────
/** FNV-1a de 32 bits en base 36: corto, igual en el navegador y en el servidor. */
function hash(texto: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Lo que define una sección del plan (sin «para», que solo explica). Dos firmas iguales = misma sección. */
export function firmaSeccion(s: SeccionPlan): string {
  return hash(JSON.stringify({
    t: s.titulo, a: s.aparece ?? '', r: s.repetirPor ?? '', rs: s.repetirSolo ?? [], n: !!s.nse,
    p: s.preguntas.map((p) => [p.id, p.tipo, p.texto, (p.opciones ?? []).map((o) => [o.id, o.label, o.corto ?? '']), (p.filas ?? []).map((f) => [f.id, f.label]), p.opcionesDe ?? '', p.soloSi ?? '', p.logica ?? '']),
  }));
}

// ── la estructura de lo que ya está escrito ──────────────────────────────────
const usaOpciones = (tipo: TipoPregunta) => esDeOpciones(tipo) || esMatriz(tipo) || forma(tipo) === 'orden';

/** Lo que hace una pregunta y sus opciones, en una línea. */
function logicaEnUnaLinea(def: Definicion, p: Pregunta): string | undefined {
  const lineas = [
    ...logicaDePregunta(def, p).filter((l) => l.tipo !== 'aparece' && l.tipo !== 'nse').map((l) => l.texto),
    ...[...(p.opciones ?? []), ...(p.opcionesExtra ?? [])].flatMap((o) => logicaDeOpcion(def, p, o).filter((l) => l.tipo !== 'otro').map((l) => `«${o.label}»: ${l.texto}`)),
  ];
  return lineas.length ? lineas.join(' ') : undefined;
}

const planOpcion = (o: Opcion) => ({ id: o.id, label: o.label, ...(o.corto ? { corto: o.corto } : {}) });

export function planDePregunta(def: Definicion, p: Pregunta): PreguntaPlan {
  const plan: PreguntaPlan = { id: p.id, tipo: p.tipo, texto: p.texto };
  if (p.nombre) plan.nombre = p.nombre;
  if (usaOpciones(p.tipo)) {
    const propias = p.opcionesDe ? p.opcionesExtra ?? [] : p.opciones ?? [];
    if (propias.length) plan.opciones = propias.map(planOpcion);
  }
  if (p.filas?.length) plan.filas = p.filas.map((f) => ({ id: f.id, label: f.label }));
  if (p.opcionesDe) plan.opcionesDe = p.opcionesDe;
  if (p.mostrarSi) plan.soloSi = condicionEnPalabras(p.mostrarSi, def);
  const logica = logicaEnUnaLinea(def, p);
  if (logica) plan.logica = logica;
  return plan;
}

/**
 * La estructura de un screener ya escrito: la base para ajustarla con un
 * comentario o para partir de un filtro anterior. Lo que solo explica (para
 * qué es cada sección, el perfil, quién entra a cada frente) se toma de la
 * estructura anterior si la hay.
 */
export function estructuraDeDefinicion(def: Definicion, anterior?: Estructura): Estructura {
  const nse = new Set(Object.keys(def.nse?.puntos ?? {}));
  return {
    pais: def.pais,
    tituloPublico: def.tituloPublico,
    perfil: anterior?.perfil ?? '',
    frentes: (def.frentes ?? []).map((f) => ({ id: f.id, nombre: f.nombre, grupo: f.grupo, meta: f.meta, quien: frenteEnPalabras(def, f), ...(f.perfilMuestra ? { perfilMuestra: f.perfilMuestra } : {}) })),
    // «Antes de empezar» la pone el Hub: no es parte de lo que se planea con la IA.
    secciones: def.secciones.filter((s) => s.id !== SECCION_INICIO).map((s) => {
      const plan: SeccionPlan = {
        id: s.id,
        titulo: s.titulo ?? '',
        para: anterior?.secciones.find((x) => x.id === s.id)?.para ?? '',
        preguntas: s.preguntas.map((p) => planDePregunta(def, p)),
      };
      if (s.mostrarSi) {
        plan.aparece = condicionEnPalabras(s.mostrarSi, def);
        const usa = preguntasDeCondicion(s.mostrarSi);
        if (usa.length) plan.segun = usa;
      }
      if (s.repetirPor) plan.repetirPor = s.repetirPor;
      if (s.repetirSolo) plan.repetirSolo = s.repetirSolo;
      if (s.preguntas.length && s.preguntas.every((p) => nse.has(p.id))) plan.nse = true;
      return plan;
    }),
    supuestos: [],
  };
}

// ── comparar ─────────────────────────────────────────────────────────────────
export type CambioSeccion = 'igual' | 'cambia' | 'nueva';

/** Qué pasa con cada sección de la estructura nueva respecto a la base, y cuáles salen. */
export function compararEstructuras(base: Estructura | undefined, nueva: Estructura): { secciones: Record<string, CambioSeccion>; salen: string[] } {
  const antes = new Map((base?.secciones ?? []).map((s) => [s.id, firmaSeccion(s)]));
  const secciones: Record<string, CambioSeccion> = {};
  for (const s of nueva.secciones) {
    const f = antes.get(s.id);
    secciones[s.id] = f === undefined ? 'nueva' : f === firmaSeccion(s) ? 'igual' : 'cambia';
  }
  const ids = new Set(nueva.secciones.map((s) => s.id));
  return { secciones, salen: (base?.secciones ?? []).filter((s) => !ids.has(s.id)).map((s) => s.id) };
}

/**
 * Al ajustar, la IA marca con `cambia: false` las secciones que no tocó: se
 * quedan tal cual estaban en la base (así un cambio de redacción sin querer
 * no obliga a reescribirlas).
 */
export function conservarSinCambio(base: Estructura | undefined, nueva: Estructura): Estructura {
  const antes = new Map((base?.secciones ?? []).map((s) => [s.id, s]));
  return {
    ...nueva,
    secciones: nueva.secciones.map((s) => {
      const b = antes.get(s.id);
      const { cambia, ...resto } = s;
      return cambia === false && b ? b : resto;
    }),
  };
}

// ── ids de la estructura ─────────────────────────────────────────────────────
/**
 * Ids definitivos para la estructura que propuso la IA: lo que ya estaba en
 * la base conserva su id y lo nuevo recibe uno de `idNuevo` (aunque la IA le
 * haya puesto otro), con las referencias de la estructura (se repite por,
 * opciones que salen de otra) cambiadas con él. Así ninguna pregunta nueva
 * cae en la columna de una que se quitó.
 */
export function asentarEstructura(nueva: Estructura, base: Estructura | undefined, azar: () => number = Math.random): Estructura {
  const preguntasBase = new Map((base?.secciones ?? []).flatMap((s) => s.preguntas.map((p) => [p.id, p] as const)));
  const usados = new Set<string>([
    ...(base?.secciones ?? []).flatMap((s) => [s.id, ...s.preguntas.map((p) => p.id)]),
    ...(base?.frentes ?? []).map((f) => f.id),
    ...preguntasNse(nueva.pais).map((p) => p.id),
  ]);
  const seccionesBase = new Set((base?.secciones ?? []).map((s) => s.id));
  const frentesBase = new Set((base?.frentes ?? []).map((f) => f.id));
  const nuevo = (prefijo: 'p' | 's' | 'fr') => { const id = idNuevo(prefijo, usados, azar); usados.add(id); return id; };

  const mp = new Map<string, string>();
  const mo = new Map<string, Map<string, string>>();
  const idsDe = new Map<PreguntaPlan, { opciones: string[]; filas: string[] }>();
  for (const s of nueva.secciones) {
    for (const p of s.preguntas) {
      const anterior = preguntasBase.get(p.id);
      if (!anterior && !mp.has(p.id)) mp.set(p.id, nuevo('p'));
      const asignar = (lista: { id: string }[], ya: { id: string }[] | undefined, prefijo: 'o' | 'f') => {
        const conocidos = new Set((ya ?? []).map((x) => x.id));
        const dentro = new Set(conocidos);
        const vistos = new Set<string>();
        const mapa = new Map<string, string>();
        const ids = lista.map((x) => {
          if (conocidos.has(x.id) && !vistos.has(x.id)) { vistos.add(x.id); return x.id; }
          const id = idNuevo(prefijo, dentro, azar);
          dentro.add(id);
          if (!mapa.has(x.id) && !vistos.has(x.id)) mapa.set(x.id, id);
          return id;
        });
        return { ids, mapa };
      };
      const o = asignar(p.opciones ?? [], anterior?.opciones, 'o');
      const f = asignar(p.filas ?? [], anterior?.filas, 'f');
      if (o.mapa.size) mo.set(p.id, o.mapa);
      idsDe.set(p, { opciones: o.ids, filas: f.ids });
    }
  }
  const ms = new Map<string, string>();
  for (const s of nueva.secciones) if (!seccionesBase.has(s.id) && !ms.has(s.id)) ms.set(s.id, nuevo('s'));
  const de = (m: Map<string, string> | undefined, id: string) => m?.get(id) ?? id;

  return {
    ...nueva,
    frentes: nueva.frentes.map((f) => (frentesBase.has(f.id) ? f : { ...f, id: nuevo('fr') })),
    secciones: nueva.secciones.map((s) => {
      const r: SeccionPlan = {
        ...s,
        id: de(ms, s.id),
        preguntas: s.preguntas.map((p) => {
          const ids = idsDe.get(p)!;
          const q: PreguntaPlan = { ...p, id: de(mp, p.id) };
          if (p.opciones) q.opciones = p.opciones.map((o, i) => ({ ...o, id: ids.opciones[i] }));
          if (p.filas) q.filas = p.filas.map((x, i) => ({ ...x, id: ids.filas[i] }));
          if (p.opcionesDe) q.opcionesDe = de(mp, p.opcionesDe);
          return q;
        }),
      };
      if (s.repetirPor) r.repetirPor = de(mp, s.repetirPor);
      if (s.repetirSolo && s.repetirPor) r.repetirSolo = s.repetirSolo.map((id) => de(mo.get(s.repetirPor!), id));
      return r;
    }),
  };
}

/** Lo que la estructura tiene mal armado, en palabras (la IA lo corrige una vez). */
export function revisarEstructura(e: Estructura): string[] {
  const out: string[] = [];
  const preguntas = new Map<string, { p: PreguntaPlan; i: number }>();
  e.secciones.forEach((s, i) => s.preguntas.forEach((p) => {
    if (preguntas.has(p.id)) out.push(`El id «${p.id}» se usa en dos preguntas.`);
    preguntas.set(p.id, { p, i });
  }));
  const ids = new Set<string>();
  e.secciones.forEach((s, i) => {
    if (ids.has(s.id)) out.push(`El id de sección «${s.id}» se repite.`);
    ids.add(s.id);
    if (!s.nse && !s.preguntas.length) out.push(`La sección «${s.titulo}» no tiene preguntas.`);
    if (s.repetirPor) {
      const origen = preguntas.get(s.repetirPor);
      if (!origen) out.push(`La sección «${s.titulo}» se repite por «${s.repetirPor}», que no existe.`);
      else if (origen.i >= i) out.push(`La sección «${s.titulo}» se repite por una pregunta que no va antes.`);
      else if (forma(origen.p.tipo) !== 'varias') out.push(`La sección «${s.titulo}» se repite por una pregunta que no es de varias respuestas.`);
    }
    for (const p of s.preguntas) {
      if (/[@#.]/.test(p.id)) out.push(`El id «${p.id}» no puede llevar @, # ni punto.`);
      if (usaOpciones(p.tipo) && !p.opcionesDe && !p.opciones?.length) out.push(`«${p.texto}» es de opciones y no trae sus opciones.`);
      if (esMatriz(p.tipo) && !p.filas?.length) out.push(`«${p.texto}» es una matriz y no trae sus filas.`);
      if (p.opcionesDe && !preguntas.has(p.opcionesDe)) out.push(`Las opciones de «${p.texto}» salen de «${p.opcionesDe}», que no existe.`);
    }
  });
  if (!e.frentes.length) out.push('No hay perfiles: sin al menos uno, nadie califica. Si el estudio busca un solo tipo de persona, es un perfil con la cuota total.');
  return out;
}

// ── minutos ──────────────────────────────────────────────────────────────────
function opcionesDeRelleno(n: number): Opcion[] {
  return Array.from({ length: n }, (_, i) => ({ id: `r${i}`, label: 'Opción de ejemplo' }));
}

/**
 * Un screener de mentira con lo que dice la estructura, para estimar los
 * minutos con el mismo cálculo de la barra del editor. Lo que aparece solo
 * en ciertos casos cuenta como tal.
 */
export function bocetoDeEstructura(e: Estructura): Definicion {
  const algo = { instanciaEs: [] as string[] }; // solo para que cuente como «aparece si aplica»
  return {
    ...definicionVacia(e.pais),
    tituloPublico: e.tituloPublico,
    secciones: e.secciones.map((s): Seccion => {
      const preguntas: Pregunta[] = s.nse && preguntasNse(e.pais).length ? preguntasNse(e.pais) : s.preguntas.map((p) => {
        const q: Pregunta = { id: p.id, tipo: p.tipo, texto: p.texto, ...(p.nombre ? { nombre: p.nombre } : {}) };
        if (usaOpciones(p.tipo)) {
          if (p.opcionesDe) { q.opcionesDe = p.opcionesDe; q.opcionesExtra = p.opciones; } else q.opciones = p.opciones?.length ? p.opciones : opcionesDeRelleno(4);
        }
        if (esMatriz(p.tipo)) q.filas = p.filas?.length ? p.filas : [{ id: 'r', label: 'Fila' }];
        if (p.soloSi) q.mostrarSi = algo;
        return q;
      });
      return {
        id: s.id, titulo: s.titulo, preguntas,
        ...(s.aparece ? { mostrarSi: algo } : {}),
        ...(s.repetirPor ? { repetirPor: s.repetirPor } : {}),
        ...(s.repetirSolo ? { repetirSolo: s.repetirSolo } : {}),
      };
    }),
  };
}

export function minutosDeEstructura(e: Estructura): { total: Duracion; porSeccion: Record<string, Duracion> } {
  const boceto = bocetoDeEstructura(e);
  // «Antes de empezar» no va en la estructura (la pone el Hub), pero sí cuenta en los minutos.
  const conInicio = { ...boceto, secciones: [seccionInicio(), ...boceto.secciones] };
  return { total: duracionEstimada(conInicio), porSeccion: duracionPorSeccion(boceto) };
}

// ── NSE ──────────────────────────────────────────────────────────────────────
/** La sección del NSE la pone el Hub con el cuestionario oficial del país. `undefined` si el país no tiene regla cargada. */
export function seccionNse(plan: SeccionPlan, pais: string): Seccion | undefined {
  const preguntas = preguntasNse(pais);
  if (!preguntas.length || !reglaNse(pais)) return undefined;
  return { id: plan.id, titulo: plan.titulo, preguntas };
}

// ── ponerlo en el screener ───────────────────────────────────────────────────
/** Pone (o reemplaza) una sección escrita en su lugar según el orden de la estructura. */
export function ponerSeccion(def: Definicion, seccion: Seccion, e: Estructura): Definicion {
  const orden = new Map(e.secciones.map((s, i) => [s.id, i]));
  const otras = def.secciones.filter((s) => s.id !== seccion.id);
  const i = orden.get(seccion.id) ?? Infinity;
  // Va antes de la primera sección que en la estructura va después de ella. «Antes de empezar» no está en la
  // estructura y va siempre primero: no cuenta (si contara como «al final», cada sección caería justo después de
  // ella y el filtro quedaría al revés, con preguntas que usan otras que van después: así no se puede guardar).
  const antesDe = otras.findIndex((s) => s.id !== SECCION_INICIO && (orden.get(s.id) ?? Infinity) > i);
  const secciones = inicioPrimero(antesDe < 0 ? [...otras, seccion] : [...otras.slice(0, antesDe), seccion, ...otras.slice(antesDe)]);
  let nueva: Definicion = { ...def, secciones };
  // La sección del NSE trae su regla.
  if (seccion.preguntas.some((p) => preguntasNse(def.pais).some((q) => q.id === p.id)) && !def.nse) nueva = { ...nueva, nse: reglaNse(def.pais) };
  return nueva;
}

/**
 * Al aprobar una estructura: país y título, fuera las secciones que salen y
 * las demás en el orden nuevo. Lo que cambia se reemplaza cuando llega.
 */
export function prepararParaEscribir(def: Definicion, e: Estructura, salen: string[]): Definicion {
  const orden = new Map(e.secciones.map((s, i) => [s.id, i]));
  const secciones = inicioPrimero(def.secciones
    .filter((s) => !salen.includes(s.id))
    .sort((a, b) => (orden.get(a.id) ?? Infinity) - (orden.get(b.id) ?? Infinity)));
  const frentesQueSiguen = new Set(e.frentes.map((f) => f.id));
  const frentes = def.frentes?.filter((f) => frentesQueSiguen.has(f.id)).map((f) => {
    const p = e.frentes.find((x) => x.id === f.id)!;
    return { ...f, nombre: p.nombre, meta: p.meta, grupo: p.grupo, ...(p.perfilMuestra ? { perfilMuestra: p.perfilMuestra } : {}) };
  });
  return { ...def, pais: e.pais, tituloPublico: e.tituloPublico, secciones, ...(frentes ? { frentes } : {}) };
}

/** Lo que falta para terminar la etapa 2: secciones por escribir, por poner y si falta la lógica. */
export function avanceEscritura(g: Generador): { porEscribir: string[]; porPoner: string[]; listas: number; total: number } {
  const e = g.estructura;
  if (!e) return { porEscribir: [], porPoner: [], listas: 0, total: 0 };
  const porEscribir: string[] = [];
  const porPoner: string[] = [];
  let listas = 0;
  for (const s of e.secciones) {
    const firma = firmaSeccion(s);
    if (g.aplicadas[s.id] === firma) { listas++; continue; }
    if (s.nse || g.escritas[s.id]?.firma === firma) porPoner.push(s.id);
    else porEscribir.push(s.id);
  }
  return { porEscribir, porPoner, listas, total: e.secciones.length };
}
