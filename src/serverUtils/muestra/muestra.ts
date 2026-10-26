import { z } from 'zod';
import { pool, ZiteError } from '../../../server/compat';
import { leerDefinicion } from '../../lib/formularios/tipos';
import { deLaIA, leerMuestra, muestraParaIA, ORDEN_TECNICAS, type DefinicionMuestra, type Tecnica } from '../../lib/reclutamiento/muestra';
import { contenidoDeInsumos, hayInsumos } from '../formularios/insumos';
import { insumosDeLaMuestra } from './insumos';
import { llamarJSON, MODELOS } from '../formularios/claude';
import { conRegistro } from '../formularios/uso';

// La muestra del proyecto en la base (tablas `muestras` y `muestra_versiones`,
// en add-formularios-tables.ts). Los grupos y eventos los crea la pantalla con
// los mismos endpoints que usa el tablero (saveBoardColumn, saveCalendarEvent,
// linkGroupToEvent): aquí solo se guarda la muestra y se lee el avance.

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
});
const PropuestaZ = z.object({ actividades: z.array(ActividadZ).max(120), supuestos: z.array(z.string()).default([]) });
const CambioZ = z.object({
  actividades: z.array(ActividadZ.extend({ id: z.string().nullish() })).max(200),
  supuestos: z.array(z.string()).default([]),
  nota: z.string().nullish(),
});

const SISTEMA = `Eres analista de investigación cualitativa en una agencia de investigación de mercados en México. Lees los insumos de un estudio (propuesta, notas, transcripción del kick-off, tablas e imágenes) y armas su muestra: cada actividad de campo por separado. Escribes en español de México, sin tecnicismos. Respondes solo con un objeto JSON, sin texto antes ni después.`;

/** Cómo se escribe cada actividad (igual al proponer y al cambiar). */
function reglasDeActividad(perfiles: { nombre: string; meta: number }[]): string[] {
  return [
    '- Una entrada por cada actividad de campo: si son 4 sesiones, son 4 entradas; si son 16 entrevistas, son 16 entradas de 1 persona cada una (lo mismo en visitas y compras acompañadas).',
    '- tecnica: sesion = sesión de grupo o focus group; visita = visita en casa o etnografía; compra = compra acompañada o shop-along; taller = taller o co-creación; otra = lo que no encaje (prework, comunidad en línea).',
    '- personas: los titulares; reserva: los de respaldo (si no se dice, el estándar: 2 en sesiones, 1 en minigrupos y tríadas, 0 en entrevistas).',
    perfiles.length
      ? `- perfil: usa exactamente uno de estos nombres de perfil del filtro: ${perfiles.map((p) => `«${p.nombre}»`).join(', ')}.`
      : '- perfil: un nombre corto del perfil de esa actividad («Mamás 25-35 NSE C»).',
    '- lugar: la ciudad o «En línea». fecha: solo si los insumos o el equipo dicen día y hora (formato AAAA-MM-DDTHH:MM, hora de la ciudad); nunca la inventes, déjala vacía.',
  ];
}

function instrucciones(perfiles: { nombre: string; meta: number }[]): string {
  return [
    'Arma la muestra del estudio con los insumos de arriba. Responde solo con este JSON:',
    '{"actividades": [{"tecnica": "sesion" | "minigrupo" | "triada" | "diada" | "entrevista" | "visita" | "compra" | "taller" | "otra", "perfil": "…", "personas": 8, "reserva": 2, "duracionMin": 120, "lugar": "CDMX", "fecha": "2026-11-04T18:00", "notas": "…"}], "supuestos": ["…"]}',
    ...reglasDeActividad(perfiles),
    '- supuestos: en frases cortas, lo que tuviste que suponer porque los insumos no lo dicen («Supuse 2 de reserva por sesión»). Ninguno si no supusiste nada.',
    '- Si los insumos no dicen qué actividades de campo lleva el estudio, responde {"actividades": [], "supuestos": []}: nunca inventes una muestra.',
  ].join('\n');
}

function instruccionesDeCambio(perfiles: { nombre: string; meta: number }[], actual: DefinicionMuestra, comentario: string): string {
  return [
    'Esta es la muestra actual del estudio (JSON):',
    JSON.stringify(muestraParaIA(actual)),
    '',
    `El equipo pide este cambio: «${comentario}»`,
    '',
    'Devuelve la muestra completa ya con el cambio. Responde solo con este JSON:',
    '{"actividades": [{"id": "…", "tecnica": "sesion" | "minigrupo" | "triada" | "diada" | "entrevista" | "visita" | "compra" | "taller" | "otra", "perfil": "…", "personas": 8, "reserva": 2, "duracionMin": 120, "lugar": "CDMX", "fecha": "2026-11-04T18:00", "notas": "…"}], "supuestos": ["…"], "nota": "…"}',
    '- Cada actividad que se queda lleva su "id" tal cual, aunque cambie; las nuevas van sin id; las que se quitan, no las incluyas.',
    '- Cambia solo lo que pide el equipo: todo lo demás va idéntico (mismos valores, misma fecha, mismo orden).',
    ...reglasDeActividad(perfiles),
    '- Si el pedido necesita algo de los insumos (la propuesta, el kick-off, un archivo nuevo), búscalo ahí.',
    '- supuestos: los que siguen valiendo y los nuevos que tuviste que hacer; quita los que el pedido ya resolvió.',
    '- nota: en una frase, qué cambiaste. Nombra las que ya existían por su código (S1, E2); las nuevas, solo por su técnica y perfil. Si el pedido no se puede hacer o no es claro, devuelve la muestra sin cambios y di por qué.',
  ].join('\n');
}

const SIN_ACTIVIDADES = 'Los insumos no dicen qué actividades lleva el estudio (sesiones, entrevistas…). Agrega la propuesta, el kick-off o una nota en los insumos de la muestra, o ármala a mano.';

/** Propone la muestra con los insumos de la muestra (o los del filtro, si nadie los ha tocado). No la guarda. */
export async function proponerMuestra(proyectoId: string, email: string): Promise<DefinicionMuestra> {
  const fuente = await insumosDeLaMuestra(proyectoId);
  if (!hayInsumos(fuente.insumos)) throw new ZiteError({ code: 'BAD_REQUEST', message: 'La muestra todavía no tiene insumos. Agrega la propuesta, el kick-off o una nota, o ármala a mano.' });
  const perfiles = await perfilesDelProyecto(proyectoId);
  const contenido = await contenidoDeInsumos(fuente.insumos);
  const leido = await conRegistro(email, fuente.filtro?.id ?? null, 'muestra', (onGasto) => llamarJSON({
    sistema: SISTEMA,
    usuario: [...contenido, { type: 'text', text: instrucciones(perfiles) }],
    esquema: PropuestaZ,
    modelo: MODELOS.cambios,
    esfuerzo: 'medium',
    maxTokens: 16000,
    onGasto,
  }));
  if (!leido.actividades.length) throw new ZiteError({ code: 'BAD_REQUEST', message: SIN_ACTIVIDADES });
  return { actividades: deLaIA([], leido.actividades), supuestos: leido.supuestos.slice(0, 8), origen: 'ia' };
}

/**
 * Un cambio pedido con palabras («las sesiones de Monterrey van en línea»,
 * «agrega 2 tríadas de mamás»), sobre la muestra que se está editando (aunque
 * no esté guardada). Lee los mismos insumos. No guarda: la pantalla muestra
 * qué cambió y se puede deshacer.
 */
export async function comentarMuestra(proyectoId: string, actual: DefinicionMuestra, comentario: string, email: string): Promise<{ definicion: DefinicionMuestra; nota?: string }> {
  const fuente = await insumosDeLaMuestra(proyectoId);
  const perfiles = await perfilesDelProyecto(proyectoId);
  const contenido = hayInsumos(fuente.insumos) ? await contenidoDeInsumos(fuente.insumos) : [];
  const leido = await conRegistro(email, fuente.filtro?.id ?? null, 'muestra', (onGasto) => llamarJSON({
    sistema: SISTEMA,
    usuario: [...contenido, { type: 'text', text: instruccionesDeCambio(perfiles, actual, comentario) }],
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
    definicion: { ...actual, actividades: deLaIA(actual.actividades, leido.actividades), supuestos: leido.supuestos.slice(0, 8) },
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
 * Al proponer la estructura de un filtro con la IA: si el proyecto aún no
 * tiene muestra, la IA la propone con los mismos insumos y queda guardada
 * (versión 1). No crea grupos ni eventos: eso se hace desde Muestra.
 */
export async function proponerMuestraSiNoHay(proyectoId: string | null, email: string, por: string): Promise<void> {
  if (!proyectoId || (await muestraDeProyecto(proyectoId))) return;
  const def = await proponerMuestra(proyectoId, email);
  const cambios = [`La propuso la IA con los insumos: ${def.actividades.length} actividades`];
  await guardarMuestra({ proyectoId, definicion: def, cambios, motivo: 'Propuesta de la IA al armar el filtro', por, versionBase: 0 })
    .catch((e) => { if (!(e instanceof ZiteError)) throw e; }); // si alguien la creó mientras tanto, se queda la suya
}
