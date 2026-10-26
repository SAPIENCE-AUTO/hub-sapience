import { pool } from '../../../server/compat';
import { getGlobalIdentityData, type GlobalIdentityData } from '../../lib/globalIdentityCache';
import { isPlaceholderName, normalizeEmail, normalizeName, normalizePhone, participoEnProyecto, type IdentityRow } from '../../lib/duplicateIdentity';
import { leerDefinicion, type HistorialPersona, type Respuestas } from '../../lib/formularios/tipos';

// Historial de quien contesta un filtro: la misma búsqueda de duplicados de los
// tableros de Reclutamiento (2 de 3 datos iguales entre nombre, correo y
// celular, contra todos los tableros), más los filtros que ya contestó (por
// celular). Se mide contra el proyecto del filtro: su cliente y su fecha de
// inicio. Las etiquetas son las mismas que pone Fillout al llegar a un tablero.

export type Historial = HistorialPersona;
export type NivelHistorial = NonNullable<Historial['nivel']>;
type EntradaHistorial = Historial['entradas'][number];

export const NOMBRE_NIVEL: Record<NivelHistorial, string> = {
  ya_participo: 'Ya participó', duplicado: 'Duplicado externo', mismo_proyecto: 'Mismo proyecto', repetido: 'Repetido en este filtro',
};

const ultimos10 = (t?: string) => { const d = normalizePhone(t); return d.length > 10 ? d.slice(-10) : d; };
const normCliente = (c?: string) => normalizeName(c).replace(/[^a-z0-9 ]/g, '').trim();
const SEIS_MESES = 182 * 24 * 3600 * 1000;

interface Indices { telefono: Map<string, IdentityRow[]>; correo: Map<string, IdentityRow[]>; nombre: Map<string, IdentityRow[]> }
const indices = new WeakMap<GlobalIdentityData, Indices>();

function indicesDe(datos: GlobalIdentityData): Indices {
  let ix = indices.get(datos);
  if (ix) return ix;
  ix = { telefono: new Map(), correo: new Map(), nombre: new Map() };
  const poner = (m: Map<string, IdentityRow[]>, k: string, r: IdentityRow) => { if (k) m.set(k, [...(m.get(k) ?? []), r]); };
  for (const r of datos.activeRows) {
    poner(ix.telefono, ultimos10(r.phone), r);
    poner(ix.correo, normalizeEmail(r.email), r);
    const n = normalizeName(r.participantName);
    if (n && !isPlaceholderName(n)) poner(ix.nombre, n, r);
  }
  indices.set(datos, ix);
  return ix;
}

export interface Persona { nombre?: string; telefono?: string; correo?: string }

/** Nombre, celular y correo de una respuesta (los de «claves» y la primera pregunta de correo). */
export function personaDe(definicion: unknown, resp: Respuestas, fila: { nombre?: string | null; telefono?: string | null }): Persona {
  const def = leerDefinicion(definicion);
  const correo = def.secciones.flatMap((s) => s.preguntas).find((p) => p.tipo === 'correo');
  const v = correo ? resp[correo.id] : undefined;
  return { nombre: fila.nombre ?? undefined, telefono: fila.telefono ?? undefined, correo: typeof v === 'string' ? v : undefined };
}

/**
 * El historial de una persona medido contra un proyecto (su cliente y su
 * fecha de inicio). `excluir`: la respuesta misma (para no contarse).
 */
export async function historialDe(persona: Persona, ctx: { proyecto?: string; formularioId: string; excluir?: string }): Promise<Historial> {
  const datos = await getGlobalIdentityData();
  const ix = indicesDe(datos);
  const tel = ultimos10(persona.telefono);
  const correo = normalizeEmail(persona.correo);
  const nombre = normalizeName(persona.nombre);
  const proyecto = ctx.proyecto ? datos.projectMap.get(ctx.proyecto) : undefined;
  const cliente = normCliente(proyecto?.client);
  const inicio = proyecto?.startDate ? new Date(proyecto.startDate) : new Date();

  // ── tableros: 2 de 3 datos iguales, como la búsqueda de duplicados de Reclutamiento ──
  const candidatas = new Set<IdentityRow>([...(ix.telefono.get(tel) ?? []), ...(ix.correo.get(correo) ?? []), ...(nombre ? ix.nombre.get(nombre) ?? [] : [])]);
  const entradas: EntradaHistorial[] = [];
  for (const r of candidatas) {
    const iguales = Number(!!tel && ultimos10(r.phone) === tel) + Number(!!correo && normalizeEmail(r.email) === correo) + Number(!!nombre && normalizeName(r.participantName) === nombre);
    if (iguales < 2 || !r.projectCode) continue;
    // Su propia fila (ahora todas las respuestas llegan al tablero) no es historial.
    if (ctx.excluir && typeof r.sourceForm === 'string' && r.sourceForm.endsWith(`|${ctx.excluir}`)) continue;
    const p = datos.projectMap.get(r.projectCode);
    const fecha = p?.startDate ? new Date(p.startDate) : undefined;
    if (fecha && fecha > inicio && r.projectCode !== ctx.proyecto) continue; // proyectos posteriores a este no cuentan
    entradas.push({
      tipo: 'tablero', proyecto: r.projectCode, cliente: p?.client, donde: r.boardName ?? undefined, estatus: r.status ?? undefined, grupo: r.group ?? undefined,
      fecha: p?.startDate, participo: participoEnProyecto({ status: r.status, group: r.group }),
      mismoCliente: r.projectCode !== ctx.proyecto && !!cliente && normCliente(p?.client) === cliente,
      reciente: !!fecha && inicio.getTime() - fecha.getTime() < SEIS_MESES,
    });
  }

  // ── filtros que ya contestó (por celular), menos esta respuesta ──
  if (tel) {
    const { rows } = await pool.query(
      `select r.id, r.created_at, r.califica, f.id as formulario_id, f.titulo, p.project_code, p.client
       from formulario_respuestas r join formularios f on f.id = r.formulario_id left join projects p on p.id = f.proyecto_id
       where not r.es_prueba and right(regexp_replace(coalesce(r.telefono, ''), '\\D', '', 'g'), 10) = $1 and r.id <> coalesce($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
         and not (r.resultado ? 'traida')
       order by r.created_at desc limit 50`,
      [tel, ctx.excluir ?? null],
    );
    for (const r of rows) {
      entradas.push({
        tipo: 'filtro', proyecto: r.formulario_id === ctx.formularioId ? (ctx.proyecto ?? '') : (r.project_code ?? ''), cliente: r.client ?? undefined, donde: r.titulo,
        fecha: new Date(r.created_at).toISOString(), estatus: r.califica ? 'Calificó' : 'No calificó', participo: false,
        mismoCliente: r.project_code !== ctx.proyecto && !!cliente && normCliente(r.client) === cliente, reciente: Date.now() - new Date(r.created_at).getTime() < SEIS_MESES,
      });
      if (r.formulario_id === ctx.formularioId) entradas[entradas.length - 1].donde = `${r.titulo} (este filtro)`;
    }
  }

  // ── la nota, con el vocabulario de Fillout ──
  const etiqueta = (e: EntradaHistorial) => (e.donde ? `${e.proyecto} (${e.donde})` : e.proyecto);
  const otros = entradas.filter((e) => e.proyecto && e.proyecto !== ctx.proyecto);
  const yaParticipo = [...new Set(otros.filter((e) => e.participo).map((e) => `${etiqueta(e)}${e.mismoCliente ? ', mismo cliente' : e.reciente ? ', hace menos de 6 meses' : ''}`))];
  const duplicado = [...new Set(otros.filter((e) => !e.participo).map(etiqueta))].filter((x) => !yaParticipo.some((y) => y.startsWith(x)));
  const mismoProyecto = [...new Set(entradas.filter((e) => e.proyecto === ctx.proyecto && !(e.tipo === 'filtro' && e.donde?.endsWith('(este filtro)'))).map((e) => e.donde ?? e.proyecto))];
  const repetido = entradas.filter((e) => e.donde?.endsWith('(este filtro)')).length;

  const partes: string[] = [];
  if (yaParticipo.length) partes.push(`🔴 YA PARTICIPÓ: ${yaParticipo.join('; ')}.`);
  if (duplicado.length) partes.push(`🟡 DUPLICADO EXTERNO: ${duplicado.join(', ')}.`);
  if (mismoProyecto.length) partes.push(`🟠 MISMO PROYECTO: ${mismoProyecto.join(', ')}.`);
  if (repetido) partes.push(`🔵 ×${repetido + 1} EN ESTE FILTRO`);
  const nivel: NivelHistorial | undefined = yaParticipo.length ? 'ya_participo' : duplicado.length ? 'duplicado' : mismoProyecto.length ? 'mismo_proyecto' : repetido ? 'repetido' : undefined;
  return { nivel, nota: partes.join(' '), entradas, calculado: new Date().toISOString() };
}

/** Calcula y guarda el historial de una respuesta (en `resultado.historial`). */
export async function guardarHistorial(respuestaId: string): Promise<Historial | undefined> {
  const { rows: [r] } = await pool.query(
    `select r.id, r.formulario_id, r.respuestas, r.nombre, r.telefono, f.definicion, p.project_code
     from formulario_respuestas r join formularios f on f.id = r.formulario_id left join projects p on p.id = f.proyecto_id where r.id = $1`,
    [respuestaId],
  );
  if (!r) return undefined;
  const h = await historialDe(personaDe(r.definicion, r.respuestas as Respuestas, r), { proyecto: r.project_code ?? undefined, formularioId: r.formulario_id, excluir: r.id });
  await pool.query(`update formulario_respuestas set resultado = resultado || jsonb_build_object('historial', $2::jsonb) where id = $1`, [respuestaId, JSON.stringify(h)]);
  return h;
}
