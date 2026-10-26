import { pool } from '../../../server/compat';
import { leerDefinicion } from '../../lib/formularios/tipos';
import { leerGenerador, type FrentePlan } from '../../lib/formularios/generador';
import { frentesConLaMuestra, leerMuestra, type DefinicionMuestra, type PerfilMuestra } from '../../lib/reclutamiento/muestra';

/**
 * Los perfiles y cuotas viven en la muestra (pedido de Sergio, 2026-10-26): al
 * guardarla, los filtros del proyecto toman el nombre y la cuota de sus
 * perfiles (el screener, su copia de trabajo si está en vivo, y la estructura
 * del generador). Cambia solo eso, que el participante no ve: no hay nada que
 * publicar. La revisión sube, para que un editor abierto no pise el cambio.
 */
export async function perfilesALosFiltros(proyectoId: string, def: DefinicionMuestra, antes?: DefinicionMuestra): Promise<number> {
  const perfiles = def.perfiles ?? [];
  if (!perfiles.length) return 0;
  const previos: PerfilMuestra[] = antes?.perfiles ?? [];
  const { rows } = await pool.query(`select id, definicion, cambios, generador from formularios where proyecto_id = $1`, [proyectoId]);
  let cambiados = 0;
  for (const r of rows) {
    const alDia = (json: unknown) => {
      if (!json) return null;
      const d = leerDefinicion(json);
      if (!d.frentes?.length) return null;
      const frentes = frentesConLaMuestra(d.frentes, perfiles, previos);
      return JSON.stringify(frentes) === JSON.stringify(d.frentes) ? null : { ...d, frentes };
    };
    const definicion = alDia(r.definicion);
    const cambios = alDia(r.cambios);
    const e = leerGenerador(r.generador)?.estructura;
    const frentesPlan: FrentePlan[] | null = e?.frentes.length ? frentesConLaMuestra(e.frentes, perfiles, previos) : null;
    const plan = frentesPlan && JSON.stringify(frentesPlan) !== JSON.stringify(e!.frentes) ? frentesPlan : null;
    if (!definicion && !cambios && !plan) continue;
    await pool.query(
      `update formularios set
         definicion = coalesce($2::jsonb, definicion),
         cambios = case when cambios is null then null else coalesce($3::jsonb, cambios) end,
         generador = case when $4::jsonb is null then generador else jsonb_set(generador, '{estructura,frentes}', $4::jsonb) end,
         revision = revision + case when $2::jsonb is null and $3::jsonb is null then 0 else 1 end,
         updated_at = now()
       where id = $1`,
      [r.id, definicion && JSON.stringify(definicion), cambios && JSON.stringify(cambios), plan && JSON.stringify(plan)],
    );
    cambiados++;
  }
  return cambiados;
}

/** Los perfiles de la muestra del proyecto (vacío si no tiene muestra). */
export async function perfilesDeLaMuestra(proyectoId: string | null): Promise<PerfilMuestra[]> {
  if (!proyectoId) return [];
  const { rows: [m] } = await pool.query(`select definicion from muestras where proyecto_id = $1`, [proyectoId]);
  return m ? (leerMuestra(m.definicion).perfiles ?? []) : [];
}
