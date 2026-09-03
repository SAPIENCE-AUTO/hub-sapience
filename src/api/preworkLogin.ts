import { z } from 'zod';
import { createEndpoint, ZiteError, pool } from '../../server/compat';
import { verifyPassword, createSessionToken } from '../../server/preworkAuth';
import { fechaHoyMexico } from '../../server/preworkDate';

/**
 * Login del portal de participante (misiones/diario Prework) — email +
 * contraseña real contra `prework_participantes`, ajeno a Supabase (ese es
 * solo para el equipo interno, ver server/auth.ts) y al par token+password
 * del portal de proveedores. Público a propósito, como
 * getSupplierPortalData.ts: valida credenciales dentro de `execute`, no vía
 * `authenticated: true`.
 */
export default createEndpoint({
  authenticated: false,
  description: 'Login de participante para el portal de Prework (email + contraseña)',
  inputSchema: z.object({
    email: z.string().email(),
    password: z.string().min(1),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    token: z.string().optional(),
    participante: z.object({
      id: z.string(),
      nombre: z.string(),
      email: z.string(),
    }).optional(),
  }),
  execute: async ({ input }) => {
    const { rows } = await pool.query<{
      id: string; nombre: string; email: string; password_hash: string; password_salt: string;
    }>(
      `select id, nombre, email, password_hash, password_salt
       from prework_participantes
       where lower(email) = lower($1)
       limit 1`,
      [input.email],
    );
    const participante = rows[0];
    if (!participante || !verifyPassword(input.password, participante.password_hash, participante.password_salt)) {
      // ZiteError, no Error plano: server/index.ts convierte cualquier Error
      // no-ZiteError en "Error interno" genérico (línea ~205) para no filtrar
      // detalles internos — pero eso también se come mensajes pensados para
      // el usuario si no se usa ZiteError.
      throw new ZiteError({ code: 'UNAUTHORIZED', message: 'Correo o contraseña incorrectos.' });
    }

    // "Día 1" de las misiones relativas (ver prework_misiones.dia_relativo):
    // arranca solo en el primer login, no lo fija el moderador. Si ya tenía
    // fecha_inicio (no es su primer login) esto no toca nada.
    await pool.query(
      `update prework_asignaciones set fecha_inicio = $1
       where prework_participante_id = $2 and incluido = true and fecha_inicio is null`,
      [fechaHoyMexico(), participante.id],
    );

    return {
      success: true,
      token: createSessionToken(participante.id),
      participante: { id: participante.id, nombre: participante.nombre, email: participante.email },
    };
  },
});
