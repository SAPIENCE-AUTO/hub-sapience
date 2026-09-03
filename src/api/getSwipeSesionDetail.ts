import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';

const capituloSchema = z.object({
  id: z.string(),
  nombre: z.string(),
  descripcion: z.string().optional(),
  orden: z.number(),
  estado: z.string(),
  ideasCount: z.number(),
  ideaThumbnails: z.array(z.string()),
  pctAprobacion: z.number().optional(),
});

export default createEndpoint({
  authenticated: true,
  description: 'Detalle de una sesión de Swipe para el dashboard: datos de la sesión y sus capítulos',
  inputSchema: z.object({ sesionId: z.string() }),
  outputSchema: z.object({
    found: z.boolean(),
    id: z.string().optional(),
    codigo: z.string().optional(),
    nombre: z.string().optional(),
    cliente: z.string().optional(),
    estado: z.string().optional(),
    participantesCount: z.number().optional(),
    capitulos: z.array(capituloSchema).optional(),
  }),
  execute: async ({ input }) => {
    const sesionResult = await pool.query(
      `select id, codigo, nombre, cliente, estado from swipe_sesiones where id = $1`,
      [input.sesionId],
    );
    const sesion = sesionResult.rows[0];
    if (!sesion) return { found: false };

    const capitulosResult = await pool.query(
      `select c.id, c.nombre, c.descripcion, c.orden, c.estado, count(i.id) as ideas_count
       from swipe_capitulos c
       left join swipe_ideas i on i.capitulo_id = c.id
       where c.sesion_id = $1
       group by c.id
       order by c.orden asc`,
      [input.sesionId],
    );

    // Hasta 3 fotos por capítulo, para la pila de miniaturas del dashboard
    // — no vale la pena mandar la idea completa aquí, solo la portada.
    const thumbsResult = await pool.query(
      `select i.capitulo_id, i.imagen_url
       from swipe_ideas i
       join swipe_capitulos c on c.id = i.capitulo_id
       where c.sesion_id = $1 and i.imagen_url is not null
       order by i.capitulo_id, i.orden asc`,
      [input.sesionId],
    );
    const thumbsPorCapitulo = new Map<string, string[]>();
    for (const row of thumbsResult.rows) {
      const lista = thumbsPorCapitulo.get(row.capitulo_id) ?? [];
      if (lista.length < 3) lista.push(row.imagen_url);
      thumbsPorCapitulo.set(row.capitulo_id, lista);
    }

    // % de aprobación agregado del capítulo completo (todas sus ideas
    // juntas) — para el vistazo rápido en la lista, sin tener que entrar.
    const aprobacionResult = await pool.query(
      `select i.capitulo_id,
         count(v.id) filter (where v.valor in ('potencial', 'super')) as potencial,
         count(v.id) filter (where v.valor = 'descarte') as descarte
       from swipe_ideas i
       join swipe_capitulos c on c.id = i.capitulo_id
       left join swipe_votos v on v.idea_id = i.id
       where c.sesion_id = $1
       group by i.capitulo_id`,
      [input.sesionId],
    );
    const aprobacionPorCapitulo = new Map<string, number | undefined>();
    for (const row of aprobacionResult.rows) {
      const potencial = Number(row.potencial ?? 0);
      const descarte = Number(row.descarte ?? 0);
      const base = potencial + descarte;
      aprobacionPorCapitulo.set(row.capitulo_id, base > 0 ? Math.round((potencial / base) * 100) : undefined);
    }

    const participantesResult = await pool.query(
      `select count(*) as n from swipe_participantes where sesion_id = $1`,
      [input.sesionId],
    );

    return {
      found: true,
      id: sesion.id as string,
      codigo: sesion.codigo as string,
      nombre: sesion.nombre as string,
      cliente: (sesion.cliente ?? undefined) as string | undefined,
      estado: sesion.estado as string,
      participantesCount: Number(participantesResult.rows[0]?.n ?? 0),
      capitulos: capitulosResult.rows.map((row) => ({
        id: row.id as string,
        nombre: row.nombre as string,
        descripcion: (row.descripcion ?? undefined) as string | undefined,
        orden: Number(row.orden),
        estado: row.estado as string,
        ideasCount: Number(row.ideas_count ?? 0),
        ideaThumbnails: thumbsPorCapitulo.get(row.id) ?? [],
        pctAprobacion: aprobacionPorCapitulo.get(row.id),
      })),
    };
  },
});
