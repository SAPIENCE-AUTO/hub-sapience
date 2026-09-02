import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';

const ACCENT_MAP: Record<string, string> = {
  á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ñ: 'n', ü: 'u',
  Á: 'A', É: 'E', Í: 'I', Ó: 'O', Ú: 'U', Ñ: 'N', Ü: 'U',
};

function slugifyCodigo(nombre: string): string {
  const sinAcentos = nombre.split('').map((ch) => ACCENT_MAP[ch] ?? ch).join('');
  const base = sinAcentos
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20);
  return base || 'SWIPE';
}

/** Sufijo corto para evitar colisiones entre sesiones con nombres parecidos, sin exponer un UUID completo en la URL del QR. */
function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6).toUpperCase();
}

export default createEndpoint({
  authenticated: true,
  description: 'Crea una sesión de Swipe (un workshop) y genera su código público',
  inputSchema: z.object({
    nombre: z.string().min(1),
    cliente: z.string().optional(),
    proyectoId: z.string().optional(),
  }),
  outputSchema: z.object({ id: z.string(), codigo: z.string() }),
  execute: async ({ input, context }) => {
    const base = slugifyCodigo(input.nombre);
    let codigo = `${base}-${randomSuffix()}`;
    // Reintenta con otro sufijo en el raro caso de colisión — el unique
    // constraint de la tabla es la garantía real, esto solo evita el error.
    for (let attempt = 0; attempt < 5; attempt++) {
      const exists = await pool.query(`select 1 from swipe_sesiones where codigo = $1`, [codigo]);
      if (exists.rows.length === 0) break;
      codigo = `${base}-${randomSuffix()}`;
    }

    const result = await pool.query(
      `insert into swipe_sesiones (codigo, nombre, cliente, proyecto_id, created_by) values ($1, $2, $3, $4, $5) returning id`,
      [codigo, input.nombre, input.cliente ?? null, input.proyectoId ?? null, context.user.id],
    );

    return { id: result.rows[0].id as string, codigo };
  },
});
