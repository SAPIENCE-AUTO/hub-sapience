// Dónde se guardan los indicadores: el último cálculo de cada área (para que la pantalla abra al instante) y las metas que Sergio escribe.
// Tablas creadas por server/scripts/add-indicadores-tables.ts, fuera del pipeline de generate.py (igual que las de Swipe).
import { z } from 'zod';
import { pool } from '../../../server/compat';
import type { DatosReclutamiento } from '../../lib/indicadores/reclutamiento';

const PorVecesSchema = z.object({ 1: z.number(), 2: z.number(), 3: z.number(), 4: z.number(), 5: z.number() }).default({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });

export const ProyectoSchema = z.object({
  codigo: z.string(),
  cliente: z.string().optional(),
  fecha: z.string(),
  inferida: z.boolean(),
  participaron: z.number(),
  noElegibles: z.number(),
  porMismoCliente: z.number(),
  // Los cálculos guardados antes de «Avisos respetados» no traen este campo: se leen con 0 hasta que se actualice.
  marcadosTrabajados: z.number().default(0),
  // Los cálculos guardados antes de separar elegibles y no elegibles por número de veces no traen estos dos: se leen con ceros.
  noElegiblesPorVeces: PorVecesSchema,
  elegiblesPorVeces: PorVecesSchema,
  previas: z.object({ 2: z.number(), 3: z.number(), 4: z.number(), 5: z.number() }),
  duplicados: z.number(),
});

export const DatosSchema = z.object({
  proyectos: z.array(ProyectoSchema),
  vida: z.object({ personas: z.number(), enAlMenos: z.object({ 2: z.number(), 3: z.number(), 5: z.number(), 10: z.number() }) }),
  sinFecha: z.number(),
});

/** Lo que recibe la pantalla: el último cálculo (si ya hay uno) y las metas guardadas, por clave de indicador. */
export const SalidaSchema = z.object({
  calculadoEn: z.string().optional(),
  datos: DatosSchema.optional(),
  metas: z.record(z.string(), z.number()),
});
export type Salida = z.infer<typeof SalidaSchema>;

/** Lo único que se necesita del pool: así las pruebas le pasan una base en memoria. */
export interface Consulta { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> }

/** Postgres: la tabla no existe (todavía no se corrió add-indicadores-tables.ts). */
export const faltaLaTabla = (err: unknown) => (err as { code?: string } | null)?.code === '42P01';

export const MENSAJE_SIN_TABLAS = 'Faltan las tablas de indicadores en la base de datos (add-indicadores-tables.ts).';

const isoDe = (v: unknown) => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

export async function leerIndicadores(area: string, db: Consulta = pool): Promise<Salida> {
  try {
    const calculo = await db.query(`select calculado_en, datos from indicadores_calculos where area = $1`, [area]);
    const metas = await db.query(`select indicador, valor from indicadores_metas where area = $1`, [area]);
    const fila = calculo.rows[0];
    return {
      ...(fila ? { calculadoEn: isoDe(fila.calculado_en), datos: DatosSchema.parse(fila.datos) } : {}),
      metas: Object.fromEntries(metas.rows.map((m) => [String(m.indicador), Number(m.valor)])),
    };
  } catch (err) {
    // Sin las tablas la pantalla abre vacía y avisa al intentar calcular; no se cae.
    if (faltaLaTabla(err)) return { metas: {} };
    throw err;
  }
}

export async function guardarCalculo(area: string, datos: DatosReclutamiento, quien: string, db: Consulta = pool): Promise<string> {
  const r = await db.query(
    `insert into indicadores_calculos (area, calculado_en, calculado_por, datos) values ($1, now(), $2, $3::jsonb)
     on conflict (area) do update set calculado_en = now(), calculado_por = excluded.calculado_por, datos = excluded.datos
     returning calculado_en`,
    [area, quien, JSON.stringify(datos)],
  );
  return isoDe(r.rows[0].calculado_en);
}

/** `valor` null borra la meta. */
export async function guardarMeta(area: string, indicador: string, valor: number | null, quien: string, db: Consulta = pool): Promise<void> {
  if (valor === null) {
    await db.query(`delete from indicadores_metas where area = $1 and indicador = $2`, [area, indicador]);
    return;
  }
  await db.query(
    `insert into indicadores_metas (area, indicador, valor, actualizado_por, updated_at) values ($1, $2, $3, $4, now())
     on conflict (area, indicador) do update set valor = excluded.valor, actualizado_por = excluded.actualizado_por, updated_at = now()`,
    [area, indicador, valor, quien],
  );
}
