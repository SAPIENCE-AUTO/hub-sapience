import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';

const ideaActivaSchema = z.object({
  id: z.string(),
  titulo: z.string(),
  descripcion: z.string().optional(),
  imagenUrl: z.string().optional(),
  orden: z.number(),
});

const tableroActivoSchema = z.object({
  id: z.string(),
  nombre: z.string(),
  descripcion: z.string().optional(),
  totalIdeas: z.number(),
  ejeXLabel: z.string(),
  ejeXMin: z.number(),
  ejeXMax: z.number(),
  ejeYLabel: z.string(),
  ejeYMin: z.number(),
  ejeYMax: z.number(),
  cuadranteAltoAltoLabel: z.string().optional(),
  cuadranteBajoAltoLabel: z.string().optional(),
  cuadranteBajoBajoLabel: z.string().optional(),
  cuadranteAltoBajoLabel: z.string().optional(),
  ideaActiva: ideaActivaSchema.nullable(),
});

export default createEndpoint({
  authenticated: false,
  description: 'Estado público de una sesión de Ejes: sesión + tablero activo + idea activa dentro de él (si hay una abierta)',
  inputSchema: z.object({ codigo: z.string() }),
  outputSchema: z.object({
    found: z.boolean(),
    estadoSesion: z.string().optional(),
    nombre: z.string().optional(),
    cliente: z.string().optional(),
    tableroActivo: tableroActivoSchema.nullable().optional(),
  }),
  execute: async ({ input }) => {
    const sesionResult = await pool.query(
      `select id, nombre, cliente, estado from ejes_sesiones where codigo = $1`,
      [input.codigo],
    );
    const sesion = sesionResult.rows[0];
    if (!sesion) return { found: false };

    // A diferencia de Swipe (que guarda capitulo_activo_id en la sesión),
    // aquí basta con el primer tablero 'abierto' de la sesión — no hace
    // falta duplicar el puntero, el estado de la tabla ya es la fuente de
    // verdad. La idea activa (si hay una 'abierto' dentro de este tablero)
    // se trae en el mismo query — activación 1 a 1 dentro del tablero, no
    // se manda la lista completa de ideas al participante.
    const tabResult = await pool.query(
      `select t.id, t.nombre, t.descripcion, count(i.id) as total_ideas,
              t.eje_x_label, t.eje_x_min, t.eje_x_max, t.eje_y_label, t.eje_y_min, t.eje_y_max,
              t.cuadrante_alto_alto_label, t.cuadrante_bajo_alto_label, t.cuadrante_bajo_bajo_label, t.cuadrante_alto_bajo_label,
              ia.id as idea_activa_id, ia.titulo as idea_activa_titulo, ia.descripcion as idea_activa_descripcion,
              ia.imagen_url as idea_activa_imagen_url, ia.orden as idea_activa_orden
       from ejes_tableros t
       left join ejes_ideas i on i.tablero_id = t.id
       left join ejes_ideas ia on ia.tablero_id = t.id and ia.estado = 'abierto'
       where t.sesion_id = $1 and t.estado = 'abierto'
       group by t.id, ia.id
       limit 1`,
      [sesion.id],
    );
    const tab = tabResult.rows[0];

    return {
      found: true,
      estadoSesion: sesion.estado as string,
      nombre: sesion.nombre as string,
      cliente: (sesion.cliente ?? undefined) as string | undefined,
      tableroActivo: tab
        ? {
            id: tab.id as string,
            nombre: tab.nombre as string,
            descripcion: (tab.descripcion ?? undefined) as string | undefined,
            totalIdeas: Number(tab.total_ideas ?? 0),
            ejeXLabel: tab.eje_x_label as string,
            ejeXMin: Number(tab.eje_x_min),
            ejeXMax: Number(tab.eje_x_max),
            ejeYLabel: tab.eje_y_label as string,
            ejeYMin: Number(tab.eje_y_min),
            ejeYMax: Number(tab.eje_y_max),
            cuadranteAltoAltoLabel: (tab.cuadrante_alto_alto_label ?? undefined) as string | undefined,
            cuadranteBajoAltoLabel: (tab.cuadrante_bajo_alto_label ?? undefined) as string | undefined,
            cuadranteBajoBajoLabel: (tab.cuadrante_bajo_bajo_label ?? undefined) as string | undefined,
            cuadranteAltoBajoLabel: (tab.cuadrante_alto_bajo_label ?? undefined) as string | undefined,
            ideaActiva: tab.idea_activa_id
              ? {
                  id: tab.idea_activa_id as string,
                  titulo: tab.idea_activa_titulo as string,
                  descripcion: (tab.idea_activa_descripcion ?? undefined) as string | undefined,
                  imagenUrl: (tab.idea_activa_imagen_url ?? undefined) as string | undefined,
                  orden: Number(tab.idea_activa_orden),
                }
              : null,
          }
        : null,
    };
  },
});
