import { esDelNse, idNuevo, type TextosGenerales } from './editar';
import { alertaEnPalabras, citar, frenteEnPalabras, logicaDeOpcion, logicaDePregunta, logicaDeSeccion, sinMarcador, ubicar, unirY } from './palabras';
import { opcionesDe } from './tabla';
import { TIPOS, forma, type Alerta, type Condicion, type Definicion, type Frente, type Opcion, type Pregunta, type Seccion } from './tipos';

/**
 * Lo que propone la IA, antes de aplicarlo (fase 3 de Filtros): ids
 * definitivos, el cambio como parche, qué cambia en palabras y qué lógica
 * se rompe. Funciones puras; las usan el servidor (para validar) y el
 * editor (para mostrar la propuesta y aplicarla con deshacer).
 *
 * Regla de oro: el id de una pregunta, opción o fila que ya existe nunca
 * cambia (es la clave de su columna en el tablero). Lo que la IA agrega
 * recibe un id de `idNuevo`, aunque ella le haya puesto otro, y todas las
 * referencias a ese id dentro de la propuesta se cambian con él.
 */

export interface Parche {
  /** Reemplazan a la pregunta con el mismo id, en su lugar. */
  preguntas?: Pregunta[];
  /** Reemplazan a la sección con el mismo id; las que no existen se agregan (según `orden`, o al final). */
  secciones?: Seccion[];
  /** Ids de todas las secciones en el orden nuevo. Si no las nombra todas, no se usa. */
  orden?: string[];
  quitarSecciones?: string[];
  frentes?: Frente[];
  alertas?: Alerta[];
  claves?: Definicion['claves'];
  textos?: Partial<TextosGenerales>;
}

// ── ids ──────────────────────────────────────────────────────────────────────
/** Lo que ya existe y la IA puede usar con su id. Todo lo demás es nuevo. */
export interface Conocidos {
  secciones: Set<string>;
  preguntas: Set<string>;
  /** Opciones (y «Ninguno» de las que salen de otra) por pregunta. */
  opciones: Map<string, Set<string>>;
  filas: Map<string, Set<string>>;
  frentes: Set<string>;
}

const opcionesPropias = (p: Pregunta) => [...(p.opciones ?? []), ...(p.opcionesExtra ?? [])];

/** Todo lo que existe en un screener (para un comentario, que puede tocar cualquier parte). */
export function conocidosDe(def: Definicion, soloPreguntas?: string[]): Conocidos {
  const preguntas = def.secciones.flatMap((s) => s.preguntas).filter((p) => !soloPreguntas || soloPreguntas.includes(p.id));
  return {
    secciones: new Set(soloPreguntas ? [] : def.secciones.map((s) => s.id)),
    preguntas: new Set(preguntas.map((p) => p.id)),
    opciones: new Map(preguntas.map((p) => [p.id, new Set(opcionesPropias(p).map((o) => o.id))])),
    filas: new Map(preguntas.map((p) => [p.id, new Set((p.filas ?? []).map((f) => f.id))])),
    frentes: new Set(soloPreguntas ? [] : (def.frentes ?? []).map((f) => f.id)),
  };
}

/** Todos los ids de un screener, para que uno nuevo no repita ninguno. */
function idsUsados(def: Definicion): Set<string> {
  const ids = new Set<string>();
  for (const s of def.secciones) {
    ids.add(s.id);
    for (const p of s.preguntas) ids.add(p.id);
  }
  for (const f of def.frentes ?? []) ids.add(f.id);
  return ids;
}

type Mapa = Map<string, string>;
const de = (m: Mapa | undefined, id: string) => m?.get(id) ?? id;

/**
 * Pone ids definitivos a una propuesta. `contexto` es el screener contra el
 * que se propone (para no repetir ids y resolver referencias a lo que no
 * viene en la propuesta). Devuelve la propuesta con sus ids y cuántas cosas
 * nuevas trae.
 */
export function asentarIds(prop: Parche, conocidos: Conocidos, contexto: Definicion, azar: () => number = Math.random): Parche {
  const usados = idsUsados(contexto);
  const enPropuesta = [...(prop.secciones ?? []).flatMap((s) => s.preguntas), ...(prop.preguntas ?? [])];
  const preguntaDe = new Map<string, Pregunta>();
  for (const p of enPropuesta) if (!preguntaDe.has(p.id)) preguntaDe.set(p.id, p);
  const buscar = (id: string) => preguntaDe.get(id) ?? ubicar(contexto, id)?.pregunta;

  // Preguntas, sus opciones y filas. Cada opción recibe su id por posición (`idsDe`); el mapa (`mo`, `mf`)
  // sirve para las referencias de la lógica, que apuntan a la primera opción con ese id.
  const mp: Mapa = new Map();
  const mo = new Map<string, Mapa>();
  const mf = new Map<string, Mapa>();
  const idsDe = new Map<string, { opciones: string[]; filas: string[] }>();
  for (const p of preguntaDe.values()) {
    const conocida = conocidos.preguntas.has(p.id);
    if (!conocida) {
      const nuevo = idNuevo('p', usados, azar);
      usados.add(nuevo);
      mp.set(p.id, nuevo);
    }
    const asignar = (lista: { id: string }[], ya: Set<string> | undefined, prefijo: 'o' | 'f', mapas: Map<string, Mapa>): string[] => {
      const mapa: Mapa = new Map();
      // Tampoco se reusa el id de una opción que se quitó: sus respuestas caerían en la nueva.
      const dentro = new Set(conocida ? ya ?? [] : []);
      const vistos = new Set<string>();
      const ids = lista.map((x) => {
        // La primera con un id que ya existía lo conserva; si la IA lo repite, la otra es nueva.
        if (conocida && ya?.has(x.id) && !vistos.has(x.id)) { vistos.add(x.id); return x.id; }
        const nuevo = idNuevo(prefijo, dentro, azar);
        dentro.add(nuevo);
        if (!mapa.has(x.id) && !vistos.has(x.id)) mapa.set(x.id, nuevo);
        return nuevo;
      });
      if (mapa.size) mapas.set(p.id, mapa);
      return ids;
    };
    idsDe.set(p.id, {
      opciones: asignar(opcionesPropias(p), conocidos.opciones.get(p.id), 'o', mo),
      filas: asignar(p.filas ?? [], conocidos.filas.get(p.id), 'f', mf),
    });
  }

  // Secciones y frentes.
  const ms: Mapa = new Map();
  for (const s of prop.secciones ?? []) {
    if (conocidos.secciones.has(s.id) || ms.has(s.id)) continue;
    const nuevo = idNuevo('s', usados, azar);
    usados.add(nuevo);
    ms.set(s.id, nuevo);
  }
  const mfr: Mapa = new Map();
  for (const f of prop.frentes ?? []) {
    if (conocidos.frentes.has(f.id) || mfr.has(f.id)) continue;
    const nuevo = idNuevo('fr', usados, azar);
    usados.add(nuevo);
    mfr.set(f.id, nuevo);
  }

  /** Mapa de las opciones de una pregunta (con las que salen de otra, por `opcionesDe`). */
  const opcionesMapa = (preguntaId: string, vistas = new Set<string>()): Mapa => {
    const propio = mo.get(preguntaId) ?? new Map();
    const p = buscar(preguntaId);
    if (!p?.opcionesDe || vistas.has(preguntaId)) return propio;
    vistas.add(preguntaId);
    return new Map([...opcionesMapa(p.opcionesDe, vistas), ...propio]);
  };
  const seccionDe = (preguntaId: string): Seccion | undefined =>
    (prop.secciones ?? []).find((s) => s.preguntas.some((p) => p.id === preguntaId)) ?? ubicar(contexto, preguntaId)?.seccion;
  const seccionPorId = (id: string): Seccion | undefined => (prop.secciones ?? []).find((s) => s.id === id) ?? contexto.secciones.find((s) => s.id === id);
  const instanciasDe = (s?: Seccion): Mapa => (s?.repetirPor ? opcionesMapa(s.repetirPor) : new Map());
  const todasLasInstancias = (): Mapa => new Map([...(prop.secciones ?? []), ...contexto.secciones].flatMap((s) => [...instanciasDe(s)]));

  const cond = (c: Condicion, enSeccion?: Seccion): Condicion => {
    if ('todas' in c) return { todas: c.todas.map((x) => cond(x, enSeccion)) };
    if ('alguna' in c) return { alguna: c.alguna.map((x) => cond(x, enSeccion)) };
    if ('no' in c) return { no: cond(c.no, enSeccion) };
    if ('nse' in c) return c;
    if ('instanciaEs' in c) {
      const m = enSeccion?.repetirPor ? instanciasDe(enSeccion) : todasLasInstancias();
      return { instanciaEs: c.instanciaEs.map((id) => de(m, id)) };
    }
    if ('bloque' in c) return { bloque: de(ms, c.bloque), opcion: de(instanciasDe(seccionPorId(c.bloque)), c.opcion) };
    const instancia = (preguntaId: string, inst?: string) => (inst === undefined ? {} : { instancia: de(instanciasDe(seccionDe(preguntaId)), inst) });
    if ('numero' in c) return { numero: de(mp, c.numero), entre: c.entre, ...instancia(c.numero, c.instancia) };
    const m = opcionesMapa(c.pregunta);
    const ids = (lista: string[]) => lista.map((id) => de(m, id));
    if ('incluye' in c) return { pregunta: de(mp, c.pregunta), incluye: ids(c.incluye), ...instancia(c.pregunta, c.instancia) };
    if ('noIncluye' in c) return { pregunta: de(mp, c.pregunta), noIncluye: ids(c.noIncluye), ...instancia(c.pregunta, c.instancia) };
    return { pregunta: de(mp, c.pregunta), incluyeTodas: ids(c.incluyeTodas), ...instancia(c.pregunta, c.instancia) };
  };

  const pregunta = (p: Pregunta, enSeccion?: Seccion): Pregunta => {
    const m = mo.get(p.id);
    const f = mf.get(p.id);
    const ids = preguntaDe.get(p.id) === p ? idsDe.get(p.id) : undefined;
    const opcion = (o: Opcion, i: number): Opcion => ({ ...o, id: ids?.opciones[i] ?? de(m, o.id) });
    const q: Pregunta = { ...p, id: de(mp, p.id) };
    if (p.opciones) q.opciones = p.opciones.map((o, i) => opcion(o, i));
    if (p.opcionesExtra) q.opcionesExtra = p.opcionesExtra.map((o, i) => opcion(o, (p.opciones?.length ?? 0) + i));
    if (p.filas) q.filas = p.filas.map((x, i) => ({ ...x, id: ids?.filas[i] ?? de(f, x.id) }));
    if (p.reglasMatriz) q.reglasMatriz = p.reglasMatriz.map((r) => ({ ...r, fila: de(f, r.fila), columnas: r.columnas.map((id) => de(m, id)) }));
    if (p.opcionesDe) q.opcionesDe = de(mp, p.opcionesDe);
    if (p.mostrarSi) q.mostrarSi = cond(p.mostrarSi, enSeccion);
    if (p.terminaSi) q.terminaSi = { ...p.terminaSi, si: cond(p.terminaSi.si, enSeccion) };
    return q;
  };

  const out: Parche = { ...prop };
  if (prop.preguntas) out.preguntas = prop.preguntas.map((p) => pregunta(p, seccionDe(p.id)));
  if (prop.secciones) {
    out.secciones = prop.secciones.map((s) => {
      const r: Seccion = { ...s, id: de(ms, s.id), preguntas: s.preguntas.map((p) => pregunta(p, s)) };
      if (s.repetirPor) r.repetirPor = de(mp, s.repetirPor);
      if (s.repetirSolo && s.repetirPor) r.repetirSolo = s.repetirSolo.map((id) => de(opcionesMapa(s.repetirPor!), id));
      if (s.mostrarSi) r.mostrarSi = cond(s.mostrarSi);
      return r;
    });
  }
  if (prop.orden) out.orden = prop.orden.map((id) => de(ms, id));
  if (prop.frentes) out.frentes = prop.frentes.map((f) => ({ ...f, id: de(mfr, f.id), califica: cond(f.califica) }));
  if (prop.alertas) {
    out.alertas = prop.alertas.map((a) => ({
      ...a,
      ...(a.si ? { si: cond(a.si) } : {}),
      ...(a.contar ? { contar: { ...a.contar, pregunta: de(mp, a.contar.pregunta) } } : {}),
    }));
  }
  if (prop.claves) out.claves = Object.fromEntries(Object.entries(prop.claves).map(([k, v]) => [k, v && de(mp, v)]));
  return out;
}

// ── aplicar ──────────────────────────────────────────────────────────────────
export function aplicarParche(def: Definicion, parche: Parche): Definicion {
  const preguntas = new Map((parche.preguntas ?? []).map((p) => [p.id, p]));
  const nuevas = new Map((parche.secciones ?? []).map((s) => [s.id, s]));
  const quitar = new Set(parche.quitarSecciones ?? []);
  let secciones = def.secciones
    .filter((s) => !quitar.has(s.id))
    .map((s) => nuevas.get(s.id) ?? s)
    .map((s) => (s.preguntas.some((p) => preguntas.has(p.id)) ? { ...s, preguntas: s.preguntas.map((p) => preguntas.get(p.id) ?? p) } : s));
  const agregadas = (parche.secciones ?? []).filter((s) => !def.secciones.some((x) => x.id === s.id));
  secciones = [...secciones, ...agregadas];
  if (parche.orden) {
    const orden = parche.orden;
    if (secciones.every((s) => orden.includes(s.id))) {
      secciones = orden.map((id) => secciones.find((s) => s.id === id)).filter((s): s is Seccion => !!s);
    }
  }
  return {
    ...def,
    ...parche.textos,
    secciones,
    ...(parche.frentes ? { frentes: parche.frentes } : {}),
    ...(parche.alertas ? { alertas: parche.alertas } : {}),
    ...(parche.claves ? { claves: parche.claves } : {}),
  };
}

/**
 * Las preguntas del NSE (cuestionario oficial) no las toca la IA: si una
 * propuesta las trae cambiadas, se quedan como estaban.
 */
export function protegerNse(parche: Parche, def: Definicion): Parche {
  const original = (id: string) => ubicar(def, id)?.pregunta;
  const fija = (p: Pregunta) => (esDelNse(def, p.id) ? original(p.id) ?? p : p);
  // La sección que tiene las preguntas del NSE se queda como está y no se quita.
  const delNse = new Set(def.secciones.filter((s) => s.preguntas.some((p) => esDelNse(def, p.id))).map((s) => s.id));
  return {
    ...parche,
    ...(parche.preguntas ? { preguntas: parche.preguntas.map(fija) } : {}),
    ...(parche.secciones ? {
      secciones: parche.secciones.map((s) => (delNse.has(s.id) ? def.secciones.find((x) => x.id === s.id)! : { ...s, preguntas: s.preguntas.map(fija) })),
    } : {}),
    ...(parche.quitarSecciones ? { quitarSecciones: parche.quitarSecciones.filter((id) => !delNse.has(id)) } : {}),
  };
}

// ── lógica que se rompe ──────────────────────────────────────────────────────
interface Referencia { donde: string; condicion: Condicion; seccion?: Seccion }

function referencias(def: Definicion): Referencia[] {
  const out: Referencia[] = [];
  for (const s of def.secciones) {
    if (s.mostrarSi) out.push({ donde: `cuándo aparece la sección «${sinMarcador(s.titulo ?? s.id)}»`, condicion: s.mostrarSi });
    for (const p of s.preguntas) {
      if (p.mostrarSi) out.push({ donde: `cuándo aparece ${citar(def, p.id, 40)}`, condicion: p.mostrarSi, seccion: s });
      if (p.terminaSi) out.push({ donde: `cuándo termina el filtro en ${citar(def, p.id, 40)}`, condicion: p.terminaSi.si, seccion: s });
    }
  }
  for (const f of def.frentes ?? []) out.push({ donde: `el frente ${f.nombre}`, condicion: f.califica });
  for (const a of def.alertas ?? []) if (a.si) out.push({ donde: `la alerta «${a.texto}»`, condicion: a.si });
  return out;
}

/** Opciones que la lógica nombra y que ya no existen en su pregunta: esa regla nunca se cumpliría. */
function opcionesQueFaltan(def: Definicion): string[] {
  const out: string[] = [];
  const revisar = (c: Condicion, donde: string, enSeccion?: Seccion) => {
    if ('todas' in c) return c.todas.forEach((x) => revisar(x, donde, enSeccion));
    if ('alguna' in c) return c.alguna.forEach((x) => revisar(x, donde, enSeccion));
    if ('no' in c) return revisar(c.no, donde, enSeccion);
    const deRepeticion = (s?: Seccion) => {
      const origen = s?.repetirPor ? ubicar(def, s.repetirPor)?.pregunta : undefined;
      return origen ? new Set(opcionesDe(def, origen).map((o) => o.id)) : undefined;
    };
    if ('bloque' in c) {
      const ids = deRepeticion(def.secciones.find((s) => s.id === c.bloque));
      if (ids && !ids.has(c.opcion)) out.push(`${donde} usa un bloque que ya no existe`);
      return;
    }
    if ('instanciaEs' in c) {
      const ids = deRepeticion(enSeccion);
      if (ids && c.instanciaEs.some((id) => !ids.has(id))) out.push(`${donde} usa una opción que ya no abre bloque`);
      return;
    }
    if (!('pregunta' in c)) return;
    const p = ubicar(def, c.pregunta)?.pregunta;
    if (!p) return; // eso lo dice revisarDefinicion
    const ids = forma(p.tipo) === 'si_no' ? new Set(['si', 'no']) : new Set(opcionesDe(def, p).map((o) => o.id));
    const lista = 'incluye' in c ? c.incluye : 'noIncluye' in c ? c.noIncluye : c.incluyeTodas;
    if (lista.some((id) => !ids.has(id))) out.push(`${donde} usa una opción de ${citar(def, p.id, 40)} que ya no existe`);
  };
  for (const r of referencias(def)) revisar(r.condicion, r.donde, r.seccion);
  return [...new Set(out)];
}

/** Preguntas que ya existían y quedarían en una sección que se repite distinto: cambiaría su columna en el tablero. */
export function columnasQueCambian(antes: Definicion, despues: Definicion): string[] {
  const out: string[] = [];
  for (const s of despues.secciones) {
    for (const p of s.preguntas) {
      const era = ubicar(antes, p.id)?.seccion;
      if (era && (era.repetirPor ?? '') !== (s.repetirPor ?? '')) out.push(`${citar(antes, p.id, 40)} pasaría a una sección que se repite distinto y cambiaría su columna en el tablero`);
    }
  }
  return out;
}

/** Lo que una propuesta rompe y antes funcionaba. */
export function avisosDeLogica(antes: Definicion, despues: Definicion): string[] {
  const ya = new Set(opcionesQueFaltan(antes));
  return [
    ...opcionesQueFaltan(despues).filter((a) => !ya.has(a)).map((a) => `${a.charAt(0).toUpperCase()}${a.slice(1)}.`),
    ...columnasQueCambian(antes, despues).map((a) => `${a.charAt(0).toUpperCase()}${a.slice(1)}.`),
  ];
}

// ── qué cambia, en palabras ──────────────────────────────────────────────────
const comillas = (lista: string[]) => unirY(lista.map((x) => `«${x}»`));
const corto = (texto: string, largo = 70) => {
  const t = sinMarcador(texto).trim();
  return t.length <= largo ? t : `${t.slice(0, largo).replace(/\s+\S*$/, '')}…`;
};

/** Las reglas de una pregunta y de sus opciones; `clave` las compara por opción (aunque cambie su etiqueta). */
function lineasDeLogica(def: Definicion, p: Pregunta): { clave: string; texto: string }[] {
  return [
    ...logicaDePregunta(def, p).map((l) => ({ clave: `p:${l.texto}`, texto: l.texto })),
    ...opcionesPropias(p).flatMap((o) => logicaDeOpcion(def, p, o).map((l) => ({ clave: `${o.id}:${l.texto}`, texto: `«${o.label}»: ${l.texto}` }))),
  ];
}

/**
 * Qué cambia de `antes` a `despues`, con nombres: preguntas y opciones que
 * entran y salen, textos, tipos y reglas. Para decidir si se aplica.
 */
export function cambiosEnPalabras(antes: Definicion, despues: Definicion): string[] {
  const out: string[] = [];
  const titulo = (s: Seccion) => sinMarcador(s.titulo ?? 'sin título');
  const seccionesA = new Map(antes.secciones.map((s) => [s.id, s]));
  const seccionesD = new Map(despues.secciones.map((s) => [s.id, s]));

  for (const s of despues.secciones) if (!seccionesA.has(s.id)) out.push(`Sección nueva: «${titulo(s)}», con ${s.preguntas.length} ${s.preguntas.length === 1 ? 'pregunta' : 'preguntas'}.`);
  for (const s of antes.secciones) if (!seccionesD.has(s.id)) out.push(`Quita la sección «${titulo(s)}» y sus ${s.preguntas.length} ${s.preguntas.length === 1 ? 'pregunta' : 'preguntas'}.`);
  const ordenA = antes.secciones.map((s) => s.id).filter((id) => seccionesD.has(id));
  const ordenD = despues.secciones.map((s) => s.id).filter((id) => seccionesA.has(id));
  if (ordenA.join() !== ordenD.join()) out.push('Cambia el orden de las secciones.');

  for (const s of despues.secciones) {
    const a = seccionesA.get(s.id);
    if (!a) continue;
    if ((a.titulo ?? '') !== (s.titulo ?? '')) out.push(`La sección «${titulo(a)}» se llama ahora «${titulo(s)}».`);
    if ((a.intro ?? '') !== (s.intro ?? '')) out.push(`Cambia el texto de entrada de «${titulo(s)}».`);
    const comunesA = a.preguntas.map((p) => p.id).filter((id) => s.preguntas.some((q) => q.id === id));
    const comunesD = s.preguntas.map((p) => p.id).filter((id) => a.preguntas.some((q) => q.id === id));
    if (comunesA.join() !== comunesD.join()) out.push(`Cambia el orden de las preguntas de «${titulo(s)}».`);
    const la = logicaDeSeccion(antes, a).map((l) => l.texto);
    const ld = logicaDeSeccion(despues, s).map((l) => l.texto);
    for (const l of ld) if (!la.includes(l)) out.push(`En la sección «${titulo(s)}»: ${l}`);
    for (const l of la) if (!ld.includes(l)) out.push(`En la sección «${titulo(s)}» deja de aplicar: ${l}`);
  }

  const preguntasA = new Map(antes.secciones.flatMap((s) => s.preguntas.map((p) => [p.id, { p, s }] as const)));
  const preguntasD = new Map(despues.secciones.flatMap((s) => s.preguntas.map((p) => [p.id, { p, s }] as const)));
  for (const [id, { p, s }] of preguntasD) {
    if (!preguntasA.has(id)) out.push(`Agrega la pregunta «${corto(p.texto)}» en «${titulo(s)}».`);
  }
  for (const [id, { p }] of preguntasA) {
    if (!preguntasD.has(id)) out.push(`Quita la pregunta «${corto(p.texto)}».`);
  }
  for (const [id, { p, s }] of preguntasD) {
    const a = preguntasA.get(id);
    if (!a) continue;
    const q = a.p;
    const nombre = `«${corto(p.texto, 50)}»`;
    if (a.s.id !== s.id && seccionesA.has(s.id)) out.push(`Mueve ${nombre} a «${titulo(s)}».`);
    if (q.texto !== p.texto) out.push(`Cambia el texto de «${corto(q.texto, 50)}»: ahora dice «${corto(p.texto)}».`);
    if ((q.ayuda ?? '') !== (p.ayuda ?? '')) out.push(p.ayuda ? `Ayuda de ${nombre}: «${corto(p.ayuda)}».` : `Quita la ayuda de ${nombre}.`);
    if (q.tipo !== p.tipo) out.push(`${nombre} pasa de «${TIPOS[q.tipo]?.nombre ?? q.tipo}» a «${TIPOS[p.tipo]?.nombre ?? p.tipo}».`);
    const opA = new Map(opcionesPropias(q).map((o) => [o.id, o]));
    const opD = new Map(opcionesPropias(p).map((o) => [o.id, o]));
    const agrega = [...opD.values()].filter((o) => !opA.has(o.id)).map((o) => o.label);
    const quita = [...opA.values()].filter((o) => !opD.has(o.id)).map((o) => o.label);
    if (agrega.length) out.push(`En ${nombre} agrega ${comillas(agrega)}.`);
    if (quita.length) out.push(`En ${nombre} quita ${comillas(quita)}.`);
    for (const [oid, o] of opD) {
      const v = opA.get(oid);
      if (v && v.label !== o.label) out.push(`En ${nombre} cambia «${v.label}» por «${o.label}».`);
    }
    const filasA = (q.filas ?? []).map((f) => f.label).join('|');
    const filasD = (p.filas ?? []).map((f) => f.label).join('|');
    if (filasA !== filasD) out.push(`Cambian las filas de ${nombre}.`);
    const mismas = [...opD.keys()].filter((oid) => opA.has(oid));
    if (mismas.length > 1 && mismas.join() !== [...opA.keys()].filter((oid) => opD.has(oid)).join()) out.push(`Cambia el orden de las opciones de ${nombre}.`);
    const la = lineasDeLogica(antes, q);
    const ld = lineasDeLogica(despues, p);
    for (const l of ld) if (!la.some((x) => x.clave === l.clave)) out.push(`En ${nombre}: ${l.texto}`);
    for (const l of la) if (!ld.some((x) => x.clave === l.clave)) out.push(`En ${nombre} deja de aplicar: ${l.texto}`);
    if (!!q.opcional !== !!p.opcional && forma(p.tipo) !== 'ninguna') out.push(`${nombre} pasa a ser ${p.opcional ? 'opcional' : 'obligatoria'}.`);
  }

  const frentesA = new Map((antes.frentes ?? []).map((f) => [f.id, f]));
  const frentesD = new Map((despues.frentes ?? []).map((f) => [f.id, f]));
  for (const f of despues.frentes ?? []) {
    const a = frentesA.get(f.id);
    if (!a) { out.push(`Frente nuevo: ${f.nombre}, cuota ${f.meta}. ${frenteEnPalabras(despues, f)}`); continue; }
    if (a.nombre !== f.nombre) out.push(`El frente ${a.nombre} se llama ahora ${f.nombre}.`);
    if (a.meta !== f.meta) out.push(`La cuota de ${f.nombre} pasa de ${a.meta} a ${f.meta}.`);
    const qa = frenteEnPalabras(antes, a);
    const qd = frenteEnPalabras(despues, f);
    if (qa !== qd) out.push(`Quién entra a ${f.nombre}: ${qd}`);
  }
  for (const f of antes.frentes ?? []) if (!frentesD.has(f.id)) out.push(`Quita el frente ${f.nombre}.`);
  const alertasA = (antes.alertas ?? []).map((a) => alertaEnPalabras(antes, a));
  const alertasD = (despues.alertas ?? []).map((a) => alertaEnPalabras(despues, a));
  for (const a of alertasD) if (!alertasA.includes(a)) out.push(`Alerta nueva: ${a}`);
  for (const a of alertasA) if (!alertasD.includes(a)) out.push(`Quita la alerta: ${a}`);
  for (const [k, nombre] of [['tituloPublico', 'el título'], ['bienvenida', 'la bienvenida'], ['despedida', 'la despedida'], ['noCalifica', 'el mensaje de no califica']] as const) {
    if (antes[k] !== despues[k]) out.push(`Cambia ${nombre}.`);
  }
  return out;
}

/** Cómo se ve una opción en una lista corta: su texto y lo que hace. */
export function opcionEnPalabras(def: Definicion, p: Pregunta, o: Opcion): string {
  const logica = logicaDeOpcion(def, p, o).map((l) => l.texto.replace(/\.$/, '').toLowerCase());
  return logica.length ? `${o.label} (${logica.join('; ')})` : o.label;
}
