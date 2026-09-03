import { z } from 'zod';
import { createEndpoint, ZiteError, pool } from '../../server/compat';

const TIPOS = [
  'foto', 'video', 'texto', 'matching', 'swipe', 'voto', 'reaccion',
  'nota_voz', 'encuesta', 'ranking', 'reaccion_estimulo', 'heatmap', 'dibujar',
] as const;

export default createEndpoint({
  authenticated: true,
  description: 'Actualiza una misión/tarea de Prework existente',
  inputSchema: z.object({
    id: z.string(),
    titulo: z.string().min(1).optional(),
    descripcion: z.string().optional(),
    tipo: z.enum(TIPOS).optional(),
    configuracion: z.record(z.string(), z.any()).optional(),
    visibilidad: z.enum(['privada', 'social']).optional(),
    modoProgramacion: z.enum(['fecha_fija', 'relativo_inicio']).optional(),
    fechaLanzamiento: z.string().optional(),
    diaRelativo: z.number().int().min(1).optional(),
    orden: z.number().optional(),
    estado: z.enum(['borrador', 'publicada', 'archivada']).optional(),
  }).refine(
    (v) => v.modoProgramacion !== 'fecha_fija' || !!v.fechaLanzamiento,
    { message: 'Falta fechaLanzamiento al cambiar a modo fecha fija' },
  ).refine(
    (v) => v.modoProgramacion !== 'relativo_inicio' || v.diaRelativo !== undefined,
    { message: 'Falta diaRelativo al cambiar a modo relativo' },
  ),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input }) => {
    const cols: Record<string, string> = {
      titulo: 'titulo', descripcion: 'descripcion', tipo: 'tipo', visibilidad: 'visibilidad',
      modoProgramacion: 'modo_programacion', fechaLanzamiento: 'fecha_lanzamiento', diaRelativo: 'dia_relativo',
      orden: 'orden', estado: 'estado',
    };
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [key, col] of Object.entries(cols)) {
      const value = (input as Record<string, unknown>)[key];
      if (value !== undefined) { values.push(value); sets.push(`${col} = $${values.length}`); }
    }
    // Cambiar de modo limpia el campo del modo anterior — si no, la
    // constraint de consistencia (ver add-prework-tables.ts) truena porque
    // quedarían los dos (o ninguno) puestos.
    if (input.modoProgramacion === 'fecha_fija') { sets.push('dia_relativo = null'); }
    if (input.modoProgramacion === 'relativo_inicio') { sets.push('fecha_lanzamiento = null'); }

    if (input.configuracion !== undefined) { values.push(JSON.stringify(input.configuracion)); sets.push(`configuracion = $${values.length}`); }
    if (sets.length === 0) throw new ZiteError({ code: 'BAD_REQUEST', message: 'Nada que actualizar' });
    sets.push('updated_at = now()');

    values.push(input.id);
    const result = await pool.query(
      `update prework_misiones set ${sets.join(', ')} where id = $${values.length}`,
      values,
    );
    if (result.rowCount === 0) throw new ZiteError({ code: 'NOT_FOUND', message: 'Misión no encontrada' });

    return { success: true };
  },
});
