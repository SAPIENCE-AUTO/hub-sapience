import { z } from 'zod';
import { pool, ZiteError } from '../../../server/compat';
import { leerDefinicion } from '../../lib/formularios/tipos';
import { leerMuestra, muestraDeLaIA, muestraParaIA, nombreDeGrupo, nombreExterno, ORDEN_TECNICAS, type DefinicionMuestra, type Tecnica } from '../../lib/reclutamiento/muestra';
import { contenidoDeInsumos, hayInsumos } from '../formularios/insumos';
import { insumosDeLaMuestra } from './insumos';
import { llamarJSON, MODELOS } from '../formularios/claude';
import { conRegistro } from '../formularios/uso';

// La muestra del proyecto en la base (tablas `muestras` y `muestra_versiones`,
// en add-formularios-tables.ts). Los grupos y eventos los crea la pantalla con
// los mismos endpoints que usa el tablero (saveBoardColumn, saveCalendarEvent,
// linkGroupToEvent): aquí se guarda la muestra, se lee el avance y se ponen al
// día los nombres de los grupos que ya existen.

export interface MuestraGuardada {
  id: string;
  version: number;
  definicion: DefinicionMuestra;
  tableroId?: string;
  calendarioId?: string;
  updatedAt: string;
}

export async function muestraDeProyecto(proyectoId: string): Promise<MuestraGuardada | null> {
  const { rows: [m] } = await pool.query(
    `select id, version, definicion, tablero_id, calendario_id, updated_at from muestras where proyecto_id = $1`,
    [proyectoId],
  );
  if (!m) return null;
  return {
    id: m.id, version: m.version, definicion: leerMuestra(m.definicion),
    tableroId: m.tablero_id ?? undefined, calendarioId: m.calendario_id ?? undefined,
    updatedAt: new Date(m.updated_at).toISOString(),
  };
}

export async function versionesDe(muestraId: string) {
  const { rows } = await pool.query(
    `select version, cambios, motivo, created_by, created_at from muestra_versiones where muestra_id = $1 order by version desc limit 50`,
    [muestraId],
  );
  return rows.map((v) => ({
    version: v.version as number, cambios: (v.cambios ?? []) as string[], motivo: v.motivo ?? undefined,
    por: v.created_by ?? undefined, fecha: new Date(v.created_at).toISOString(),
  }));
}

const CONFIRMADO = /confirm|asisti|^ok\b|principal/i;

/**
 * Cuántas personas hay en cada grupo del tablero y con qué estatus. Se busca
 * por tablero y grupo (lo que tiene índice en `cell_values`).
 */
export async function avanceDeGrupos(tableroId: string | undefined, grupoIds: string[]) {
  const avance: Record<string, { total: number; confirmados: number; porEstatus: Record<string, number> }> = {};
  if (!tableroId || !grupoIds.length) return avance;
  const { rows } = await pool.query(
    `select cv.column_id as grupo, coalesce(nullif(r.status, ''), 'Pendiente') as estatus, count(*)::int as n
     from cell_values cv join recruitment_rows r on r.id::text = cv.row_id
     where cv.board_id = $1 and cv.column_id = any($2::text[]) and cv.text_value = '1' and cv.deleted_at is null
       and coalesce(r.deleted_at, '') = ''
     group by 1, 2`,
    [`${tableroId}::groups`, grupoIds],
  );
  for (const r of rows) {
    const a = (avance[r.grupo] ??= { total: 0, confirmados: 0, porEstatus: {} });
    a.total += r.n;
    a.porEstatus[r.estatus] = (a.porEstatus[r.estatus] ?? 0) + r.n;
    if (CONFIRMADO.test(r.estatus)) a.confirmados += r.n;
  }
  return avance;
}

/** Los tableros de Reclutamiento y los calendarios del proyecto (para elegir dónde se crean grupos y eventos). */
export async function tablerosDelProyecto(proyectoId: string) {
  const { rows } = await pool.query(
    `select b.id, b.board_name, b.board_type from boards b join projects p on p.project_code = b.project_code
     where p.id = $1 and b.deleted_at is null and b.board_type in ('recruitment', 'calendar')
     order by b.board_order nulls last, b.created_at`,
    [proyectoId],
  );
  const de = (tipo: string) => rows.filter((b) => b.board_type === tipo).map((b) => ({ id: b.id as string, nombre: (b.board_name ?? '') as string }));
  return { tableros: de('recruitment'), calendarios: de('calendar') };
}

/** Los perfiles de los filtros del proyecto (el que está en vivo primero), para elegirlos en cada actividad. */
export async function perfilesDelProyecto(proyectoId: string): Promise<{ nombre: string; meta: number }[]> {
  const { rows } = await pool.query(
    `select definicion from formularios where proyecto_id = $1
     order by (estado = 'en_vivo') desc, updated_at desc nulls last limit 5`,
    [proyectoId],
  );
  const vistos = new Map<string, number>();
  for (const r of rows) for (const f of leerDefinicion(r.definicion).frentes ?? []) if (!vistos.has(f.nombre)) vistos.set(f.nombre, f.meta);
  return [...vistos.entries()].map(([nombre, meta]) => ({ nombre, meta }));
}

// ── propuesta y cambios con IA ───────────────────────────────────────────────
const ActividadZ = z.object({
  tecnica: z.enum(ORDEN_TECNICAS as [Tecnica, ...Tecnica[]]),
  perfil: z.string().nullish(),
  // Sin mínimo estricto: lo que no sirva (0 personas, 0 minutos) toma el valor de la técnica.
  personas: z.number().min(0).max(200).nullish(),
  reserva: z.number().min(0).max(100).nullish(),
  duracionMin: z.number().min(0).max(1440).nullish(),
  lugar: z.string().nullish(),
  fecha: z.string().nullish(),
  notas: z.string().nullish(),
  // Lo que no sea una opción válida se ignora al leerlo (deLaIA), no truena la respuesta.
  modalidad: z.string().nullish(),
  genero: z.string().nullish(),
  edad: z.string().nullish(),
  nse: z.string().nullish(),
});
const PerfilZ = z.object({
  nombre: z.string().min(1),
  descripcion: z.string().nullish(),
  reparto: z.string().nullish(),
  cuota: z.number().min(0).max(1000).nullish(),
  genero: z.string().nullish(),
  edad: z.string().nullish(),
  nse: z.string().nullish(),
});
const PropuestaZ = z.object({
  perfiles: z.array(PerfilZ).max(30).default([]),
  actividades: z.array(ActividadZ).max(120),
  supuestos: z.array(z.string()).default([]),
});
const CambioZ = z.object({
  perfiles: z.array(PerfilZ.extend({ id: z.string().nullish() })).max(30).nullish(),
  actividades: z.array(ActividadZ.extend({ id: z.string().nullish() })).max(200),
  supuestos: z.array(z.string()).default([]),
  nota: z.string().nullish(),
});

/** Perfiles que ya están decididos (los del filtro, cuando el filtro se armó primero): la IA no los cambia. */
export type PerfilesFijos = { nombre: string; descripcion?: string; cuota: number }[];

const SISTEMA = `Eres analista de investigación cualitativa en una agencia de investigación de mercados en México. Lees los insumos de un estudio (propuesta, notas, transcripción del kick-off, tablas e imágenes) y armas su muestra: cada actividad de campo por separado. Escribes en español de México, sin tecnicismos. Respondes solo con un objeto JSON, sin texto antes ni después.`;

/** Cómo se escriben los perfiles y cada actividad (igual al proponer y al cambiar). */
function reglas(o: { delFiltro: { nombre: string; meta: number }[]; fijos?: PerfilesFijos }): string[] {
  return [
    '- perfiles: los grupos de personas que se reclutan con los mismos criterios. Nunca un perfil por persona ni por actividad: si 5 entrevistas son de usuarios de aerosoles de distintas marcas, es un perfil «Aerosoles» con cuota 5 y en "reparto" «2 Glade · 1 Air Wick · 2 Febreze». Lo que solo reparte dentro de un perfil (marcas, ciudades, mitad hombres y mitad mujeres, edades) va en "reparto", no en otro perfil.',
    '- descripcion: quién es, en una línea («Mamás de 25 a 35, NSE C, compran aromatizantes cada mes»). cuota: cuántas personas titulares se necesitan de ese perfil; tiene que cuadrar con lo que suman sus actividades.',
    '- genero ("mujeres", "hombres" o "mixto"), edad («25–35») y nse («C+», «C/D+») de cada perfil: lo que digan los insumos; si no lo dicen, null (nunca lo inventes).',
    o.fijos?.length
      ? `- Los perfiles ya están decididos (los del filtro): usa exactamente estos, con su nombre y su cuota, sin agregar ni quitar: ${o.fijos.map((p) => `«${p.nombre}» (cuota ${p.cuota})`).join(', ')}.`
      : o.delFiltro.length
        ? `- Si sirven, usa de base los perfiles del filtro del proyecto (mismo nombre): ${o.delFiltro.map((p) => `«${p.nombre}» (cuota ${p.meta})`).join(', ')}.`
        : '',
    '- Una actividad por cada actividad de campo: si son 4 sesiones, son 4 entradas; si son 16 entrevistas, son 16 entradas de 1 persona cada una (lo mismo en visitas y compras acompañadas).',
    '- tecnica: sesion = sesión de grupo o focus group; visita = visita en casa o etnografía; compra = compra acompañada o shop-along; taller = taller o co-creación; otra = lo que no encaje (prework, comunidad en línea).',
    '- personas: los titulares; reserva: los de respaldo (si no se dice, el estándar: 2 en sesiones, 1 en minigrupos y tríadas, 0 en entrevistas).',
    '- perfil (de cada actividad): exactamente el nombre de uno de los perfiles.',
    '- modalidad (de cada actividad): "presencial" u "online". Visitas y compras acompañadas siempre son presenciales.',
    '- genero, edad y nse de una actividad: solo si esa actividad es distinta de su perfil (S1 de mujeres y S2 de hombres dentro de un perfil mixto; una tríada de 25–35 y otra de 36–45); si es igual, null.',
    '- lugar: la ciudad o «En línea». fecha: solo si los insumos o el equipo dicen día y hora (formato AAAA-MM-DDTHH:MM, hora de la ciudad); nunca la inventes, déjala vacía.',
  ].filter(Boolean);
}

function instrucciones(delFiltro: { nombre: string; meta: number }[], fijos?: PerfilesFijos): string {
  return [
    'Arma la muestra del estudio con los insumos de arriba: primero sus perfiles con su cuota y después sus actividades. Responde solo con este JSON:',
    '{"perfiles": [{"nombre": "…", "descripcion": "…", "reparto": "…", "cuota": 5, "genero": "mixto", "edad": "25–55", "nse": "C+"}], "actividades": [{"tecnica": "sesion" | "minigrupo" | "triada" | "diada" | "entrevista" | "visita" | "compra" | "taller" | "otra", "perfil": "…", "modalidad": "presencial" | "online", "genero": null, "edad": null, "nse": null, "personas": 8, "reserva": 2, "duracionMin": 120, "lugar": "CDMX", "fecha": "2026-11-04T18:00", "notas": "…"}], "supuestos": ["…"]}',
    ...reglas({ delFiltro, fijos }),
    '- supuestos: en frases cortas, lo que tuviste que suponer porque los insumos no lo dicen («Supuse 2 de reserva por sesión»). Ninguno si no supusiste nada.',
    '- Si los insumos no dicen qué actividades de campo lleva el estudio, responde {"actividades": [], "supuestos": []}: nunca inventes una muestra.',
  ].join('\n');
}

function instruccionesDeCambio(delFiltro: { nombre: string; meta: number }[], actual: DefinicionMuestra, comentario: string): string {
  return [
    'Esta es la muestra actual del estudio (JSON):',
    JSON.stringify(muestraParaIA(actual)),
    '',
    `El equipo pide este cambio: «${comentario}»`,
    '',
    'Devuelve la muestra completa ya con el cambio. Responde solo con este JSON:',
    '{"perfiles": [{"id": "…", "nombre": "…", "descripcion": "…", "reparto": "…", "cuota": 5, "genero": "mixto", "edad": "25–55", "nse": "C+"}], "actividades": [{"id": "…", "tecnica": "sesion" | "minigrupo" | "triada" | "diada" | "entrevista" | "visita" | "compra" | "taller" | "otra", "perfil": "…", "modalidad": "presencial" | "online", "genero": null, "edad": null, "nse": null, "personas": 8, "reserva": 2, "duracionMin": 120, "lugar": "CDMX", "fecha": "2026-11-04T18:00", "notas": "…"}], "supuestos": ["…"], "nota": "…"}',
    '- Cada perfil y cada actividad que se queda lleva su "id" tal cual, aunque cambie; los nuevos van sin id; los que se quitan, no los incluyas.',
    '- Cambia solo lo que pide el equipo: todo lo demás va idéntico (mismos valores, misma fecha, mismo orden).',
    ...reglas({ delFiltro }),
    '- Si el pedido necesita algo de los insumos (la propuesta, el kick-off, un archivo nuevo), búscalo ahí.',
    '- supuestos: los que siguen valiendo y los nuevos que tuviste que hacer; quita los que el pedido ya resolvió.',
    '- nota: en una frase, qué cambiaste. Nombra las que ya existían por su código (S1, E2); las nuevas, solo por su técnica y perfil. Si el pedido no se puede hacer o no es claro, devuelve la muestra sin cambios y di por qué.',
  ].join('\n');
}

const SIN_ACTIVIDADES = 'Los insumos no dicen qué actividades lleva el estudio (sesiones, entrevistas…). Agrega la propuesta, el kick-off o una nota en los insumos de la muestra, o ármala a mano.';

/**
 * Propone la muestra con los insumos de la muestra (o los del filtro, si nadie
 * los ha tocado). No la guarda. `fijos`: los perfiles ya decididos (cuando el
 * filtro se armó primero), que la IA no cambia.
 */
export async function proponerMuestra(proyectoId: string, email: string, fijos?: PerfilesFijos): Promise<DefinicionMuestra> {
  const fuente = await insumosDeLaMuestra(proyectoId);
  if (!hayInsumos(fuente.insumos)) throw new ZiteError({ code: 'BAD_REQUEST', message: 'La muestra todavía no tiene insumos. Agrega la propuesta, el kick-off o una nota, o ármala a mano.' });
  const delFiltro = await perfilesDelProyecto(proyectoId);
  const contenido = await contenidoDeInsumos(fuente.insumos);
  const leido = await conRegistro(email, fuente.filtro?.id ?? null, 'muestra', (onGasto) => llamarJSON({
    sistema: SISTEMA,
    usuario: [...contenido, { type: 'text', text: instrucciones(delFiltro, fijos) }],
    esquema: PropuestaZ,
    modelo: MODELOS.cambios,
    esfuerzo: 'medium',
    maxTokens: 16000,
    onGasto,
  }));
  if (!leido.actividades.length) throw new ZiteError({ code: 'BAD_REQUEST', message: SIN_ACTIVIDADES });
  // Con perfiles fijos, son esos tal cual (nombre y cuota), aunque la IA los haya escrito distinto; género, edad y NSE, los que leyó.
  const leidoDe = (nombre: string) => leido.perfiles.find((x) => x.nombre.trim().toLowerCase() === nombre.trim().toLowerCase());
  const perfiles = fijos?.length
    ? fijos.map((p) => ({ nombre: p.nombre, descripcion: p.descripcion, cuota: p.cuota, genero: leidoDe(p.nombre)?.genero, edad: leidoDe(p.nombre)?.edad, nse: leidoDe(p.nombre)?.nse }))
    : leido.perfiles;
  return { ...muestraDeLaIA({ actividades: [] }, { perfiles, actividades: leido.actividades }), supuestos: leido.supuestos.slice(0, 8), origen: 'ia' };
}

/**
 * Un cambio pedido con palabras («las sesiones de Monterrey van en línea»,
 * «agrega 2 tríadas de mamás»), sobre la muestra que se está editando (aunque
 * no esté guardada). Lee los mismos insumos. No guarda: la pantalla muestra
 * qué cambió y se puede deshacer.
 */
export async function comentarMuestra(proyectoId: string, actual: DefinicionMuestra, comentario: string, email: string): Promise<{ definicion: DefinicionMuestra; nota?: string }> {
  const fuente = await insumosDeLaMuestra(proyectoId);
  const delFiltro = await perfilesDelProyecto(proyectoId);
  const contenido = hayInsumos(fuente.insumos) ? await contenidoDeInsumos(fuente.insumos) : [];
  const leido = await conRegistro(email, fuente.filtro?.id ?? null, 'muestra', (onGasto) => llamarJSON({
    sistema: SISTEMA,
    usuario: [...contenido, { type: 'text', text: instruccionesDeCambio(delFiltro, actual, comentario) }],
    esquema: CambioZ,
    modelo: MODELOS.cambios,
    esfuerzo: 'medium',
    maxTokens: 24000,
    onGasto,
  }));
  const nota = leido.nota?.trim() || undefined;
  // Una respuesta vacía no borra la muestra: casi siempre es que la IA no entendió.
  if (!leido.actividades.length && actual.actividades.length) {
    return { definicion: actual, nota: nota ?? 'La IA no devolvió actividades: no se cambió nada.' };
  }
  return {
    definicion: { ...actual, ...muestraDeLaIA(actual, { perfiles: leido.perfiles ?? undefined, actividades: leido.actividades }), supuestos: leido.supuestos.slice(0, 8) },
    ...(nota ? { nota } : {}),
  };
}

// ── guardar ──────────────────────────────────────────────────────────────────
/** El nombre de quien cambia la muestra (el de su usuario del Hub; si no tiene, su correo). */
export async function nombreDeUsuario(email: string): Promise<string> {
  const { rows: [u] } = await pool.query(`select first_name, last_name from users where lower(email) = lower($1) limit 1`, [email]);
  const nombre = [u?.first_name, u?.last_name].filter((x) => typeof x === 'string' && x.trim()).join(' ').trim();
  return nombre || email;
}

/**
 * Guarda una versión nueva (con sus cambios en palabras y el motivo). Si otra
 * persona la cambió mientras tanto, no pisa: avisa. `soloLigas`: solo anota
 * los grupos y eventos recién creados, sin versión nueva.
 */
export async function guardarMuestra(o: {
  proyectoId: string; definicion: DefinicionMuestra; cambios: string[]; motivo?: string; por: string;
  versionBase: number; tableroId?: string; calendarioId?: string; soloLigas?: boolean;
}): Promise<number> {
  const def = JSON.stringify(leerMuestra(o.definicion));
  const actual = await muestraDeProyecto(o.proyectoId);
  if (!actual) {
    if (o.versionBase !== 0) throw new ZiteError({ code: 'BAD_REQUEST', message: 'La muestra cambió mientras tanto. Recarga y vuelve a intentarlo.' });
    const { rows: [m] } = await pool.query(
      `insert into muestras (proyecto_id, definicion, version, tablero_id, calendario_id, created_by)
       values ($1, $2, 1, $3, $4, $5) on conflict (proyecto_id) do nothing returning id`,
      [o.proyectoId, def, o.tableroId ?? null, o.calendarioId ?? null, o.por],
    );
    if (!m) throw new ZiteError({ code: 'BAD_REQUEST', message: 'Otra persona creó la muestra al mismo tiempo. Recarga y vuelve a intentarlo.' });
    await pool.query(
      `insert into muestra_versiones (muestra_id, version, definicion, cambios, motivo, created_by) values ($1, 1, $2, $3, $4, $5)`,
      [m.id, def, JSON.stringify(o.cambios), o.motivo ?? null, o.por],
    );
    return 1;
  }
  if (o.soloLigas) {
    const { rowCount } = await pool.query(
      `update muestras set definicion = $3, tablero_id = coalesce($4, tablero_id), calendario_id = coalesce($5, calendario_id), updated_at = now()
       where proyecto_id = $1 and version = $2`,
      [o.proyectoId, o.versionBase, def, o.tableroId ?? null, o.calendarioId ?? null],
    );
    if (!rowCount) throw new ZiteError({ code: 'BAD_REQUEST', message: 'La muestra cambió mientras tanto. Recarga y vuelve a intentarlo.' });
    return o.versionBase;
  }
  const { rows: [m] } = await pool.query(
    `update muestras set definicion = $3, version = version + 1, tablero_id = coalesce($4, tablero_id), calendario_id = coalesce($5, calendario_id), updated_at = now()
     where proyecto_id = $1 and version = $2 returning id, version`,
    [o.proyectoId, o.versionBase, def, o.tableroId ?? null, o.calendarioId ?? null],
  );
  if (!m) throw new ZiteError({ code: 'BAD_REQUEST', message: 'Otra persona cambió la muestra mientras tanto. Recarga para ver su versión y vuelve a hacer tu cambio.' });
  await pool.query(
    `insert into muestra_versiones (muestra_id, version, definicion, cambios, motivo, created_by) values ($1, $2, $3, $4, $5, $6)`,
    [m.id, m.version, def, JSON.stringify(o.cambios), o.motivo ?? null, o.por],
  );
  return m.version as number;
}

/**
 * Los grupos que ya existen toman su nombre nuevo y su nombre público (el de
 * las vistas externas, sin el perfil) cuando cambia lo que los nombra: la
 * actividad o su perfil. Lo demás del grupo (color, evento ligado) se queda, y
 * un nombre que alguien cambió en el tablero solo se pisa si cambia la actividad.
 */
export async function nombresAlTablero(antes: DefinicionMuestra | undefined, despues: DefinicionMuestra, tableroId: string | undefined): Promise<number> {
  if (!tableroId) return 0;
  const previas = new Map((antes?.actividades ?? []).map((a) => [a.id, a]));
  const cambian = new Map(despues.actividades.flatMap((a) => {
    if (!a.grupoId) return [];
    const nombre = nombreDeGrupo(a, despues);
    const publico = nombreExterno(a, despues);
    const v = previas.get(a.id);
    if (v && antes && nombreDeGrupo(v, antes) === nombre && nombreExterno(v, antes) === publico) return [];
    return [[a.grupoId, { nombre, publico }] as const];
  }));
  if (!cambian.size) return 0;
  const { rows } = await pool.query(
    `select id::text as id, options_json from board_columns where board_id = $1 and id::text = any($2::text[]) and deleted_at is null`,
    [`${tableroId}::groups`, [...cambian.keys()]],
  );
  for (const r of rows) {
    const c = cambian.get(r.id)!;
    let opciones: Record<string, unknown> = {};
    try { opciones = JSON.parse(r.options_json || '{}') ?? {}; } catch { /* ilegible: se rehace */ }
    await pool.query(
      `update board_columns set column_name = $2, options_json = $3, updated_at = now() where id = $1`,
      [r.id, c.nombre, JSON.stringify({ ...opciones, publicName: c.publico })],
    );
  }
  return rows.length;
}

/**
 * Al proponer la estructura de un filtro con la IA: si el proyecto aún no
 * tiene muestra, la IA la propone con los mismos insumos y los perfiles y
 * cuotas de esa estructura (`fijos`), y queda guardada (versión 1). No crea
 * grupos ni eventos: eso se hace desde Muestra.
 */
export async function proponerMuestraSiNoHay(proyectoId: string | null, email: string, por: string, fijos?: PerfilesFijos): Promise<void> {
  if (!proyectoId || (await muestraDeProyecto(proyectoId))) return;
  const def = await proponerMuestra(proyectoId, email, fijos);
  const cambios = [`La propuso la IA con los insumos: ${def.actividades.length} actividades`];
  await guardarMuestra({ proyectoId, definicion: def, cambios, motivo: 'Propuesta de la IA al armar el filtro', por, versionBase: 0 })
    .catch((e) => { if (!(e instanceof ZiteError)) throw e; }); // si alguien la creó mientras tanto, se queda la suya
}
