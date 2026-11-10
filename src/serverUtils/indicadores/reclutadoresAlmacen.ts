// Dónde se guarda la estadística por reclutador: el último cálculo (en indicadores_calculos, área «reclutadores», para que la pantalla abra al
// instante) y a quién pertenece cada forma de escribir el nombre (tablas `reclutadores` y `reclutador_alias`, creadas por
// server/scripts/add-reclutadores-tables.ts, fuera del pipeline de generate.py como las de Indicadores).
import { z } from 'zod';
import { pool, ZiteError } from '../../../server/compat';
import { TAMANO_CONTEO, type DatosReclutadores } from '../../lib/indicadores/reclutadores';
import { faltaLaTabla, type Consulta } from './almacen';

export const AREA_RECLUTADORES = 'reclutadores';
export const NOMBRE_MAX = 60;
export const MENSAJE_SIN_TABLAS_RECLUTADORES = 'Faltan tablas en la base de datos: corre add-indicadores-tables.ts y add-reclutadores-tables.ts.';

/** Las dos tablas. Solo agrega; idempotente. El script y las pruebas usan este mismo texto. */
export const SQL_TABLAS_RECLUTADORES = `
  -- Los reclutadores como Sergio los junta: un nombre, sin importar cómo lo escriban los participantes.
  create table if not exists reclutadores (
    id         uuid primary key default gen_random_uuid(),
    nombre     text not null,
    creado_por text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create unique index if not exists reclutadores_nombre_uniq on reclutadores (lower(nombre));

  -- A quién pertenece cada forma de escribir el nombre (ya sin mayúsculas, acentos ni signos): a un reclutador, o «no es reclutador».
  create table if not exists reclutador_alias (
    clave           text primary key,
    reclutador_id   uuid references reclutadores(id) on delete cascade,
    ignorar         boolean not null default false,
    actualizado_por text,
    updated_at      timestamptz not null default now(),
    check ((ignorar and reclutador_id is null) or (not ignorar and reclutador_id is not null))
  );
  create index if not exists reclutador_alias_reclutador_idx on reclutador_alias (reclutador_id);
`;

// ── Formas de lo que viaja ───────────────────────────────────────────────────
const ConteoSchema = z.array(z.number()).length(TAMANO_CONTEO);
const PorPeriodoSchema = z.object({ '12m': ConteoSchema, '6m': ConteoSchema, anio: ConteoSchema, todo: ConteoSchema });

export const DatosReclutadoresSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]),
  hoy: z.string(),
  escrituras: z.array(z.object({
    clave: z.string(),
    nombre: z.string(),
    formas: z.array(z.tuple([z.string(), z.number()])),
    c: PorPeriodoSchema,
  })),
  sinNombre: PorPeriodoSchema,
  sinFecha: z.number(),
  contactosCompartidos: z.number(),
});

export const ReclutadorSchema = z.object({ id: z.string(), nombre: z.string() });
export const AliasSchema = z.object({ clave: z.string(), reclutadorId: z.string().nullable(), ignorar: z.boolean() });

/** Lo que recibe la pantalla: el último cálculo (si ya hay uno), los reclutadores y a quién pertenece cada forma del nombre. */
export const SalidaReclutadoresSchema = z.object({
  calculadoEn: z.string().optional(),
  datos: DatosReclutadoresSchema.optional(),
  reclutadores: z.array(ReclutadorSchema),
  alias: z.array(AliasSchema),
  /** Todavía no se corrió add-reclutadores-tables.ts: se puede ver el cálculo pero no juntar nombres. */
  sinTablas: z.boolean(),
});
export type SalidaReclutadores = z.infer<typeof SalidaReclutadoresSchema>;
export type ReclutadorFila = z.infer<typeof ReclutadorSchema>;
export type AliasFila = z.infer<typeof AliasSchema>;

export const DestinoSchema = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('reclutador'), id: z.string().uuid() }),
  z.object({ tipo: z.literal('nuevo'), nombre: z.string() }),
  z.object({ tipo: z.literal('ignorar') }),
  z.object({ tipo: z.literal('quitar') }),
]);
export type Destino = z.infer<typeof DestinoSchema>;

/** Los cálculos viejos traen menos números por conteo (7 los de la versión 1, 10 los primeros de la 2); se rellenan con ceros hasta los 14 de ahora (la pantalla sabe, por la versión, que esos ceros no son datos). */
export function rellenar(crudo: any): any {
  const relleno = (c: unknown) => (Array.isArray(c) && c.length < TAMANO_CONTEO ? [...c, ...new Array<number>(TAMANO_CONTEO - c.length).fill(0)] : c);
  const periodos = (o: any) => (o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, relleno(v)])) : o);
  if (!crudo || typeof crudo !== 'object') return crudo;
  return {
    ...crudo,
    escrituras: Array.isArray(crudo.escrituras) ? crudo.escrituras.map((e: any) => ({ ...e, c: periodos(e?.c) })) : crudo.escrituras,
    sinNombre: periodos(crudo.sinNombre),
  };
}

const isoDe = (v: unknown) => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

/** «  ana   gómez » → «ana gómez»; vacío o demasiado largo no vale. */
export function limpiarNombre(nombre: string): string {
  const limpio = String(nombre ?? '').replace(/\s+/g, ' ').trim();
  if (!limpio) throw new ZiteError({ code: 'BAD_REQUEST', message: 'Escribe el nombre del reclutador.' });
  if (limpio.length > NOMBRE_MAX) throw new ZiteError({ code: 'BAD_REQUEST', message: `El nombre del reclutador no puede pasar de ${NOMBRE_MAX} letras.` });
  return limpio;
}

// ── Leer ─────────────────────────────────────────────────────────────────────
export async function leerReclutadores(db: Consulta = pool): Promise<SalidaReclutadores> {
  let calculo: { calculadoEn: string; datos: DatosReclutadores } | undefined;
  const { rows } = await db.query(`select calculado_en, datos from indicadores_calculos where area = $1`, [AREA_RECLUTADORES]).catch((err) => {
    if (faltaLaTabla(err)) return { rows: [] as any[] };
    throw err;
  });
  if (rows[0]) calculo = { calculadoEn: isoDe(rows[0].calculado_en), datos: DatosReclutadoresSchema.parse(rellenar(rows[0].datos)) as DatosReclutadores };

  try {
    const reclutadores = await db.query(`select id::text as id, nombre from reclutadores order by lower(nombre)`);
    const alias = await db.query(`select clave, reclutador_id::text as reclutador_id, ignorar from reclutador_alias`);
    return {
      ...(calculo ? { calculadoEn: calculo.calculadoEn, datos: calculo.datos } : {}),
      reclutadores: reclutadores.rows.map((r) => ({ id: String(r.id), nombre: String(r.nombre) })),
      alias: alias.rows.map((a) => ({ clave: String(a.clave), reclutadorId: a.reclutador_id ? String(a.reclutador_id) : null, ignorar: !!a.ignorar })),
      sinTablas: false,
    };
  } catch (err) {
    // Sin las tablas se ve el cálculo, sin poder juntar nombres; no se cae.
    if (faltaLaTabla(err)) return { ...(calculo ? { calculadoEn: calculo.calculadoEn, datos: calculo.datos } : {}), reclutadores: [], alias: [], sinTablas: true };
    throw err;
  }
}

export async function guardarCalculoReclutadores(datos: DatosReclutadores, quien: string, db: Consulta = pool): Promise<void> {
  // Se valida lo que se va a guardar: lo que no se pueda volver a leer no se guarda.
  DatosReclutadoresSchema.parse(datos);
  await db.query(
    `insert into indicadores_calculos (area, calculado_en, calculado_por, datos) values ($1, now(), $2, $3::jsonb)
     on conflict (area) do update set calculado_en = now(), calculado_por = excluded.calculado_por, datos = excluded.datos`,
    [AREA_RECLUTADORES, quien, JSON.stringify(datos)],
  );
}

// ── Juntar nombres ───────────────────────────────────────────────────────────
async function reclutadorPorNombre(db: Consulta, nombre: string, quien: string): Promise<ReclutadorFila> {
  const existente = await db.query(`select id::text as id, nombre from reclutadores where lower(nombre) = lower($1)`, [nombre]);
  if (existente.rows[0]) return { id: String(existente.rows[0].id), nombre: String(existente.rows[0].nombre) };
  const creado = await db.query(
    `insert into reclutadores (nombre, creado_por) values ($1, $2) on conflict ((lower(nombre))) do nothing returning id::text as id, nombre`,
    [nombre, quien],
  );
  if (creado.rows[0]) return { id: String(creado.rows[0].id), nombre: String(creado.rows[0].nombre) };
  // Otra persona lo creó en este instante: se lee el que quedó.
  const ganador = await db.query(`select id::text as id, nombre from reclutadores where lower(nombre) = lower($1)`, [nombre]);
  return { id: String(ganador.rows[0].id), nombre: String(ganador.rows[0].nombre) };
}

/**
 * Asigna formas de escribir el nombre a un reclutador (existente o nuevo), las marca «no es reclutador» o las deja sin asignar otra vez.
 * Cada paso se puede repetir sin daño: si algo se corta a la mitad, se vuelve a intentar.
 */
export async function asignar(
  db: Consulta,
  asignaciones: ReadonlyArray<{ claves: string[]; destino: Destino }>,
  quien: string,
): Promise<{ reclutadores: ReclutadorFila[]; cambios: AliasFila[] }> {
  const cambios = new Map<string, AliasFila>();
  for (const { claves, destino } of asignaciones) {
    const unicas = [...new Set(claves)];
    if (destino.tipo === 'quitar') {
      await db.query(`delete from reclutador_alias where clave = any($1::text[])`, [unicas]);
      for (const clave of unicas) cambios.set(clave, { clave, reclutadorId: null, ignorar: false });
      continue;
    }
    let reclutadorId: string | null = null;
    if (destino.tipo === 'nuevo') reclutadorId = (await reclutadorPorNombre(db, limpiarNombre(destino.nombre), quien)).id;
    if (destino.tipo === 'reclutador') {
      const hay = await db.query(`select 1 from reclutadores where id = $1::uuid`, [destino.id]);
      if (!hay.rows[0]) throw new ZiteError({ code: 'NOT_FOUND', message: 'Ese reclutador ya no existe.' });
      reclutadorId = destino.id;
    }
    const ignorar = destino.tipo === 'ignorar';
    await db.query(
      `insert into reclutador_alias (clave, reclutador_id, ignorar, actualizado_por, updated_at)
       select c, $2::uuid, $3::boolean, $4, now() from unnest($1::text[]) as c
       on conflict (clave) do update set reclutador_id = excluded.reclutador_id, ignorar = excluded.ignorar, actualizado_por = excluded.actualizado_por, updated_at = now()`,
      [unicas, reclutadorId, ignorar, quien],
    );
    for (const clave of unicas) cambios.set(clave, { clave, reclutadorId, ignorar });
  }
  const reclutadores = await db.query(`select id::text as id, nombre from reclutadores order by lower(nombre)`);
  return { reclutadores: reclutadores.rows.map((r) => ({ id: String(r.id), nombre: String(r.nombre) })), cambios: [...cambios.values()] };
}

export async function renombrar(db: Consulta, id: string, nombre: string): Promise<ReclutadorFila> {
  const limpio = limpiarNombre(nombre);
  const otro = await db.query(`select 1 from reclutadores where lower(nombre) = lower($1) and id <> $2::uuid`, [limpio, id]);
  if (otro.rows[0]) throw new ZiteError({ code: 'CONFLICT', message: `Ya hay un reclutador llamado «${limpio}». Junta los dos con «Juntar con otro reclutador».` });
  const r = await db.query(`update reclutadores set nombre = $2, updated_at = now() where id = $1::uuid returning id::text as id, nombre`, [id, limpio]);
  if (!r.rows[0]) throw new ZiteError({ code: 'NOT_FOUND', message: 'Ese reclutador ya no existe.' });
  return { id: String(r.rows[0].id), nombre: String(r.rows[0].nombre) };
}

/** Borra al reclutador; sus formas de escribir el nombre quedan sin asignar otra vez. Devuelve cuáles. */
export async function eliminar(db: Consulta, id: string): Promise<string[]> {
  const claves = await db.query(`select clave from reclutador_alias where reclutador_id = $1::uuid`, [id]);
  const r = await db.query(`delete from reclutadores where id = $1::uuid returning id`, [id]);
  if (!r.rows[0]) throw new ZiteError({ code: 'NOT_FOUND', message: 'Ese reclutador ya no existe.' });
  return claves.rows.map((c) => String(c.clave));
}

/** Envuelve un fallo de «no existe la tabla» en el mensaje que se le muestra a Sergio. */
export function traducirFaltaTablas(err: unknown): never {
  if (faltaLaTabla(err)) throw new ZiteError({ code: 'INTERNAL_ERROR', message: MENSAJE_SIN_TABLAS_RECLUTADORES });
  throw err;
}

