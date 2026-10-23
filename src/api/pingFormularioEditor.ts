import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';
import { exigirAccesoFormularios } from '../serverUtils/formularios/acceso';

/** Una ventana del editor cuenta como abierta este tiempo después de su último aviso (avisa cada 30 s). */
const SEGUNDOS_ABIERTO = 75;

/**
 * Cada ventana con el editor abierto avisa aquí cada 30 segundos (y al
 * cerrarse, con `salir`). Devuelve quién más lo tiene abierto y la revisión
 * guardada, así el editor avisa si otra persona está editando o ya guardó.
 * `sesion` es por ventana: dos ventanas de la misma persona también se avisan.
 * No toca `updated_at`: abrir el editor no es cambiar el filtro.
 */
export default createEndpoint({
  authenticated: true,
  description: 'Avisa que el editor de un formulario sigue abierto y dice quién más lo tiene abierto',
  inputSchema: z.object({ formularioId: z.string(), sesion: z.string().min(6).max(64), salir: z.boolean().optional() }),
  outputSchema: z.object({
    revision: z.number(),
    otros: z.array(z.object({ nombre: z.string(), mismaPersona: z.boolean() })),
  }),
  execute: async ({ input, context }) => {
    exigirAccesoFormularios(context);
    const u = context.user!;
    const nombre = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || 'Alguien';
    const { rows: [f] } = await pool.query(
      `update formularios set editando = (
         select coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
         from jsonb_each(coalesce(editando, '{}'::jsonb)) as e(k, v)
         where k <> $2 and (v->>'hasta')::timestamptz > now()
       ) || case when $3 then '{}'::jsonb
                 else jsonb_build_object($2::text, jsonb_build_object('nombre', $4::text, 'email', $5::text, 'hasta', now() + make_interval(secs => $6))) end
       where id = $1
       returning revision, editando`,
      [input.formularioId, input.sesion, !!input.salir, nombre, (u.email ?? '').toLowerCase(), SEGUNDOS_ABIERTO],
    );
    if (!f) return { revision: 0, otros: [] };
    const otros = Object.entries((f.editando ?? {}) as Record<string, { nombre: string; email: string }>)
      .filter(([k]) => k !== input.sesion)
      .map(([, v]) => ({ nombre: v.nombre, mismaPersona: v.email === (u.email ?? '').toLowerCase() }));
    return { revision: f.revision, otros };
  },
});
