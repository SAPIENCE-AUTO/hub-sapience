/**
 * La muestra del proyecto (pedido de Sergio, 2026-10-26): qué actividades
 * lleva el estudio (sesiones, tríadas, entrevistas…), cuándo y dónde, de qué
 * perfil y para cuántas personas. Arranca de la propuesta y el kick-off (la
 * propone la IA con los insumos del filtro) y cambia a lo largo del proyecto:
 * cada cambio guarda una versión. Cada actividad se vuelve un grupo del tablero
 * de Reclutamiento y un evento del calendario, ya ligados; asignar a alguien es
 * moverlo a ese grupo. Puro: lo usan la pantalla, el servidor y las pruebas.
 */

export const TECNICAS = {
  sesion: { nombre: 'Sesión de grupo', plural: 'Sesiones de grupo', letra: 'S', personas: 8, reserva: 2, duracionMin: 120, color: 'blue' },
  minigrupo: { nombre: 'Minigrupo', plural: 'Minigrupos', letra: 'M', personas: 5, reserva: 1, duracionMin: 90, color: 'blue' },
  triada: { nombre: 'Tríada', plural: 'Tríadas', letra: 'T', personas: 3, reserva: 1, duracionMin: 90, color: 'purple' },
  diada: { nombre: 'Díada', plural: 'Díadas', letra: 'D', personas: 2, reserva: 1, duracionMin: 60, color: 'purple' },
  entrevista: { nombre: 'Entrevista', plural: 'Entrevistas', letra: 'E', personas: 1, reserva: 0, duracionMin: 60, color: 'green' },
  visita: { nombre: 'Visita en casa', plural: 'Visitas en casa', letra: 'V', personas: 1, reserva: 0, duracionMin: 120, color: 'orange' },
  compra: { nombre: 'Compra acompañada', plural: 'Compras acompañadas', letra: 'C', personas: 1, reserva: 0, duracionMin: 90, color: 'orange' },
  taller: { nombre: 'Taller', plural: 'Talleres', letra: 'W', personas: 10, reserva: 2, duracionMin: 180, color: 'yellow' },
  otra: { nombre: 'Otra actividad', plural: 'Otras actividades', letra: 'A', personas: 1, reserva: 0, duracionMin: 60, color: 'red' },
} as const;
export type Tecnica = keyof typeof TECNICAS;
export const ORDEN_TECNICAS = Object.keys(TECNICAS) as Tecnica[];

export interface Actividad {
  id: string;
  /** «S1», «T2», «E3»: lo que se lee en el tablero. */
  codigo: string;
  tecnica: Tecnica;
  perfil?: string;
  /** Fecha y hora (ISO). Sin fecha, el grupo se crea y el evento espera. */
  fecha?: string;
  duracionMin?: number;
  lugar?: string;
  /** Titulares y de reserva. */
  personas: number;
  reserva: number;
  notas?: string;
  /** El grupo del tablero y el evento del calendario, cuando ya se crearon. */
  grupoId?: string;
  eventoId?: string;
}

export interface DefinicionMuestra {
  actividades: Actividad[];
  /** Lo que la IA supuso al proponerla (para revisarlo). */
  supuestos?: string[];
  origen?: 'ia' | 'manual';
}

const esTecnica = (t: unknown): t is Tecnica => typeof t === 'string' && t in TECNICAS;
const entero = (n: unknown, def: number) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.round(n) : def);
const texto = (s: unknown) => (typeof s === 'string' && s.trim() ? s.trim() : undefined);

/** Lo guardado, con lo que falte puesto (nunca truena con datos viejos o a medias). */
export function leerMuestra(json: unknown): DefinicionMuestra {
  const d = (json && typeof json === 'object' ? json : {}) as Partial<DefinicionMuestra>;
  const actividades = (Array.isArray(d.actividades) ? d.actividades : []).flatMap((a): Actividad[] => {
    if (!a || typeof a !== 'object') return [];
    const tecnica = esTecnica(a.tecnica) ? a.tecnica : 'otra';
    const t = TECNICAS[tecnica];
    return [{
      id: texto(a.id) ?? idActividad(),
      codigo: texto(a.codigo) ?? t.letra,
      tecnica,
      perfil: texto(a.perfil),
      fecha: texto(a.fecha),
      duracionMin: entero(a.duracionMin, t.duracionMin),
      lugar: texto(a.lugar),
      personas: entero(a.personas, t.personas),
      reserva: entero(a.reserva, t.reserva),
      notas: texto(a.notas),
      grupoId: texto(a.grupoId),
      eventoId: texto(a.eventoId),
    }];
  });
  return {
    actividades,
    ...(Array.isArray(d.supuestos) && d.supuestos.length ? { supuestos: d.supuestos.filter((x): x is string => typeof x === 'string') } : {}),
    ...(d.origen === 'ia' || d.origen === 'manual' ? { origen: d.origen } : {}),
  };
}

export const idActividad = () => `a_${Math.random().toString(36).slice(2, 10)}`;

/** El siguiente código libre de una técnica: «S5» si ya hay S1 a S4. */
export function siguienteCodigo(actividades: Actividad[], tecnica: Tecnica): string {
  const letra = TECNICAS[tecnica].letra;
  const usados = new Set(actividades.map((a) => a.codigo.toUpperCase()));
  let n = 1;
  while (usados.has(`${letra}${n}`)) n++;
  return `${letra}${n}`;
}

export function nuevaActividad(actividades: Actividad[], tecnica: Tecnica, base: Partial<Actividad> = {}): Actividad {
  const t = TECNICAS[tecnica];
  return { id: idActividad(), codigo: siguienteCodigo(actividades, tecnica), tecnica, personas: t.personas, reserva: t.reserva, duracionMin: t.duracionMin, ...base };
}

// ── fechas en palabras ───────────────────────────────────────────────────────
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** «mar 4 nov · 6:00 pm» (con la hora local del navegador o del servidor). */
export function fechaCorta(iso?: string): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  const h = d.getHours();
  const hora = `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
  return `${DIAS[d.getDay()]} ${d.getDate()} ${MESES[d.getMonth()]} · ${hora}`;
}

/** El nombre del grupo del tablero: «S1 · mar 4 nov · 6:00 pm · CDMX». */
export function nombreDeGrupo(a: Actividad): string {
  return [a.codigo, fechaCorta(a.fecha), a.lugar].filter(Boolean).join(' · ');
}

/** El nombre del evento del calendario: «S1 · Sesión de grupo · Aerosoles». */
export function nombreDeEvento(a: Actividad): string {
  return [a.codigo, TECNICAS[a.tecnica].nombre, a.perfil].filter(Boolean).join(' · ');
}

/** El color del grupo en el tablero, por técnica (los mismos tonos que usa el tablero). */
export function colorDeGrupo(a: Actividad, i: number): string {
  return `${TECNICAS[a.tecnica].color}-${(i % 5) + 1}`;
}

// ── cuentas ──────────────────────────────────────────────────────────────────
export interface Totales { personas: number; reserva: number; actividades: number }
const vacio = (): Totales => ({ personas: 0, reserva: 0, actividades: 0 });

/** Cuántos lugares por técnica (en el orden de TECNICAS, solo las que hay). */
export function porTecnica(actividades: Actividad[]): { tecnica: Tecnica; totales: Totales; actividades: Actividad[] }[] {
  return ORDEN_TECNICAS.flatMap((tecnica) => {
    const de = actividades.filter((a) => a.tecnica === tecnica);
    if (!de.length) return [];
    const totales = de.reduce((t, a) => ({ personas: t.personas + a.personas, reserva: t.reserva + a.reserva, actividades: t.actividades + 1 }), vacio());
    return [{ tecnica, totales, actividades: de }];
  });
}

/** Cuántos lugares por perfil y por técnica (la tabla de «cuántos de cada perfil»). */
export function porPerfil(actividades: Actividad[]): { perfil: string; total: Totales; tecnicas: Partial<Record<Tecnica, Totales>> }[] {
  const mapa = new Map<string, { total: Totales; tecnicas: Partial<Record<Tecnica, Totales>> }>();
  for (const a of actividades) {
    const perfil = a.perfil ?? 'Sin perfil';
    const p = mapa.get(perfil) ?? { total: vacio(), tecnicas: {} };
    const t = p.tecnicas[a.tecnica] ?? vacio();
    for (const x of [p.total, t]) { x.personas += a.personas; x.reserva += a.reserva; x.actividades += 1; }
    p.tecnicas[a.tecnica] = t;
    mapa.set(perfil, p);
  }
  return [...mapa.entries()].map(([perfil, v]) => ({ perfil, ...v }));
}

export const lugares = (actividades: Actividad[]) => actividades.reduce((n, a) => n + a.personas, 0);

// ── qué cambió entre dos versiones ───────────────────────────────────────────
const CAMPOS: { campo: keyof Actividad; nombre: string; valor: (a: Actividad) => string | undefined }[] = [
  { campo: 'codigo', nombre: 'código', valor: (a) => a.codigo },
  { campo: 'tecnica', nombre: 'técnica', valor: (a) => TECNICAS[a.tecnica].nombre },
  { campo: 'perfil', nombre: 'perfil', valor: (a) => a.perfil },
  { campo: 'fecha', nombre: 'fecha', valor: (a) => fechaCorta(a.fecha) },
  { campo: 'duracionMin', nombre: 'duración', valor: (a) => (a.duracionMin ? `${a.duracionMin} min` : undefined) },
  { campo: 'lugar', nombre: 'lugar', valor: (a) => a.lugar },
  { campo: 'personas', nombre: 'personas', valor: (a) => String(a.personas) },
  { campo: 'reserva', nombre: 'reserva', valor: (a) => String(a.reserva) },
];

/** Los cambios en palabras: «Se agregó S5 (Sesión de grupo, Difusores)», «S1: fecha de … a …», «Se quitó S4». */
export function cambiosEntre(antes: DefinicionMuestra | undefined, despues: DefinicionMuestra): string[] {
  const viejas = new Map((antes?.actividades ?? []).map((a) => [a.id, a]));
  const nuevas = new Map(despues.actividades.map((a) => [a.id, a]));
  const out: string[] = [];
  for (const a of despues.actividades) {
    const v = viejas.get(a.id);
    if (!v) { out.push(`Se agregó ${a.codigo} (${[TECNICAS[a.tecnica].nombre, a.perfil].filter(Boolean).join(', ')})`); continue; }
    for (const c of CAMPOS) {
      const de = c.valor(v);
      const a2 = c.valor(a);
      if (de !== a2) out.push(`${v.codigo}: ${c.nombre} ${de ? `de ${de} ` : ''}${a2 ? `a ${a2}` : '(se quitó)'}`.trim());
    }
  }
  for (const v of antes?.actividades ?? []) if (!nuevas.has(v.id)) out.push(`Se quitó ${v.codigo}`);
  return out;
}

/** Lo que hay que crear o actualizar en el tablero y el calendario. */
export function pendientesDeCrear(actividades: Actividad[]): { grupos: Actividad[]; eventos: Actividad[] } {
  return {
    grupos: actividades.filter((a) => !a.grupoId),
    eventos: actividades.filter((a) => !a.eventoId && !!a.fecha),
  };
}

// ── lo que devuelve la IA ────────────────────────────────────────────────────
/**
 * Una actividad como la escribe la IA, al proponer la muestra o al pedirle un
 * cambio. En un cambio trae el `id` de las que se quedan; un campo que no
 * viene se queda como estaba y uno en `null` (o vacío) se borra.
 */
export interface ActividadIA {
  id?: string | null;
  tecnica: Tecnica;
  perfil?: string | null;
  personas?: number | null;
  reserva?: number | null;
  duracionMin?: number | null;
  lugar?: string | null;
  fecha?: string | null;
  notas?: string | null;
}

/** La fecha como la lee y escribe la IA: «2026-11-04T18:00», en hora de la Ciudad de México. */
export function fechaParaIA(iso?: string): string | undefined {
  if (!iso) return undefined;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** La muestra como se la da a leer a la IA (para pedirle un cambio): con su id, sin grupos ni eventos. */
export function muestraParaIA(def: DefinicionMuestra) {
  return {
    actividades: def.actividades.map((a) => ({
      id: a.id, codigo: a.codigo, tecnica: a.tecnica, perfil: a.perfil ?? null, personas: a.personas, reserva: a.reserva,
      duracionMin: a.duracionMin ?? null, lugar: a.lugar ?? null, fecha: fechaParaIA(a.fecha) ?? null, notas: a.notas ?? null,
    })),
    supuestos: def.supuestos ?? [],
  };
}

const UNA_PERSONA: Tecnica[] = ['entrevista', 'visita', 'compra'];
const textoIA = (v: string | null | undefined, antes?: string) => (v === undefined ? antes : v?.trim() || undefined);
const numeroIA = (v: number | null | undefined, antes: number | undefined, minimo: number) =>
  (v === undefined || v === null ? antes : v >= minimo ? Math.round(v) : antes);

/**
 * Lo que propuso la IA, sobre lo que ya había: las que se quedan conservan su
 * id, código, grupo y evento (cambia solo lo que la IA cambió); las nuevas
 * toman el siguiente código libre; las que no regresan se quitan. Entrevistas,
 * visitas y compras son de una persona: si la IA juntó varias en una, se separan.
 */
export function deLaIA(actual: Actividad[], leidas: ActividadIA[]): Actividad[] {
  const previas = new Map(actual.map((a) => [a.id, a]));
  const usados = new Set<string>();
  const quedan: Actividad[] = [];
  const nuevas: ActividadIA[] = [];
  for (const r of leidas) {
    const prev = r.id ? previas.get(r.id) : undefined;
    if (!prev || usados.has(prev.id)) { nuevas.push({ ...r, id: undefined }); continue; }
    usados.add(prev.id);
    const fecha = r.fecha === undefined || r.fecha === fechaParaIA(prev.fecha) ? prev.fecha : textoIA(r.fecha);
    quedan.push({
      ...prev,
      tecnica: r.tecnica,
      // Si cambió de técnica, su código ya no le queda («S2» que ahora es tríada): toma uno nuevo abajo.
      codigo: r.tecnica === prev.tecnica ? prev.codigo : '',
      perfil: textoIA(r.perfil, prev.perfil),
      personas: numeroIA(r.personas, prev.personas, 1)!,
      reserva: numeroIA(r.reserva, prev.reserva, 0)!,
      duracionMin: numeroIA(r.duracionMin, prev.duracionMin, 10),
      lugar: textoIA(r.lugar, prev.lugar),
      fecha: fecha && !Number.isNaN(new Date(fecha).getTime()) ? fecha : undefined,
      notas: textoIA(r.notas, prev.notas),
    });
  }
  const lista = [...quedan];
  for (const a of lista) if (!a.codigo) a.codigo = siguienteCodigo(lista.filter((x) => x.codigo), a.tecnica);
  const separadas = nuevas.flatMap((a) => (UNA_PERSONA.includes(a.tecnica) && (a.personas ?? 1) > 1
    ? Array.from({ length: Math.min(60, Math.round(a.personas!)) }, () => ({ ...a, personas: 1, reserva: 0 }))
    : [a]));
  for (const a of separadas) {
    lista.push(nuevaActividad(lista, a.tecnica, {
      ...(a.perfil?.trim() ? { perfil: a.perfil.trim() } : {}),
      ...(a.personas && a.personas >= 1 ? { personas: Math.round(a.personas) } : {}),
      ...(a.reserva != null && a.reserva >= 0 ? { reserva: Math.round(a.reserva) } : {}),
      ...(a.duracionMin && a.duracionMin >= 10 ? { duracionMin: Math.round(a.duracionMin) } : {}),
      ...(a.lugar?.trim() ? { lugar: a.lugar.trim() } : {}),
      ...(a.fecha && !Number.isNaN(new Date(a.fecha).getTime()) ? { fecha: a.fecha } : {}),
      ...(a.notas?.trim() ? { notas: a.notas.trim() } : {}),
    }));
  }
  return lista;
}
