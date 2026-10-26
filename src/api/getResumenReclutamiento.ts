import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';
import { exigirAccesoFormularios } from '../serverUtils/formularios/acceso';
import { avanceDeGrupos, muestraDeProyecto } from '../serverUtils/muestra/muestra';
import { bandejaDe } from '../lib/formularios/motor';
import { TECNICAS, porTecnica } from '../lib/reclutamiento/muestra';
import type { Resultado } from '../lib/formularios/tipos';

/**
 * El widget de Reclutamiento en el inicio del proyecto (2026-10-26): lo que
 * falta, no conteos. Filtro: cómo va el filtro (el que está en vivo, si hay):
 * respuestas, las de hoy, candidatos y sugeridos que nadie ha contactado.
 * Participantes: lugares cubiertos contra la muestra, por técnica, y la
 * actividad más urgente (la próxima con cupo pendiente).
 */
export default createEndpoint({
  authenticated: true,
  description: 'Resumen de reclutamiento de un proyecto para su inicio',
  inputSchema: z.object({ proyectoId: z.string() }),
  outputSchema: z.object({
    filtro: z.object({
      titulo: z.string(), estado: z.string(), respuestas: z.number(), hoy: z.number(),
      candidatos: z.number(), casi: z.number(), sugeridos: z.number(), sinRevisar: z.number(),
    }).nullable(),
    muestra: z.object({
      lugares: z.number(), cubiertos: z.number(),
      porTecnica: z.array(z.object({ nombre: z.string(), lugares: z.number(), cubiertos: z.number() })),
      urgente: z.object({ codigo: z.string(), fecha: z.string(), personas: z.number(), cubiertos: z.number(), perfil: z.string().optional() }).optional(),
    }).nullable(),
  }),
  execute: async ({ input, context }) => {
    exigirAccesoFormularios(context);

    // ── Filtro: el que está en vivo (si no, el más reciente) ──
    const { rows: [f] } = await pool.query(
      `select id, titulo, estado from formularios where proyecto_id = $1 order by (estado = 'en_vivo') desc, updated_at desc nulls last limit 1`,
      [input.proyectoId],
    );
    let filtro = null;
    if (f) {
      const { rows } = await pool.query(
        `select r.created_at, r.resultado, rr.status
         from formulario_respuestas r
         left join recruitment_rows rr on rr.id::text = r.resultado->'tablero'->>'fila'
         where r.formulario_id = $1 and not r.es_prueba and not (r.resultado ? 'traida')`,
        [f.id],
      );
      const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
      let candidatos = 0, casi = 0, sugeridos = 0, sinRevisar = 0, deHoy = 0;
      for (const r of rows) {
        const res = r.resultado as Resultado;
        const b = bandejaDe(res);
        if (b === 'Candidato') candidatos++;
        if (b === 'Casi') casi++;
        if (res.sugerido) { sugeridos++; if (!r.status || r.status === 'Pendiente') sinRevisar++; }
        if (new Date(r.created_at).toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' }) === hoy) deHoy++;
      }
      filtro = { titulo: f.titulo as string, estado: f.estado as string, respuestas: rows.length, hoy: deHoy, candidatos, casi, sugeridos, sinRevisar };
    }

    // ── Participantes contra la muestra ──
    const m = await muestraDeProyecto(input.proyectoId);
    let muestra = null;
    if (m && m.definicion.actividades.length) {
      const acts = m.definicion.actividades;
      const avance = await avanceDeGrupos(m.tableroId, acts.flatMap((a) => (a.grupoId ? [a.grupoId] : [])));
      const cub = (a: (typeof acts)[number]) => Math.min(a.personas, a.grupoId ? avance[a.grupoId]?.total ?? 0 : 0);
      const ahora = Date.now();
      const urgente = acts
        .filter((a) => a.fecha && new Date(a.fecha).getTime() >= ahora && cub(a) < a.personas)
        .sort((a, b) => new Date(a.fecha!).getTime() - new Date(b.fecha!).getTime() || (b.personas - cub(b)) - (a.personas - cub(a)))[0];
      muestra = {
        lugares: acts.reduce((n, a) => n + a.personas, 0),
        cubiertos: acts.reduce((n, a) => n + cub(a), 0),
        porTecnica: porTecnica(acts).map((t) => ({ nombre: TECNICAS[t.tecnica].plural, lugares: t.totales.personas, cubiertos: t.actividades.reduce((n, a) => n + cub(a), 0) })),
        ...(urgente ? { urgente: { codigo: urgente.codigo, fecha: urgente.fecha!, personas: urgente.personas, cubiertos: cub(urgente), ...(urgente.perfil ? { perfil: urgente.perfil } : {}) } } : {}),
      };
    }
    return { filtro, muestra };
  },
});
