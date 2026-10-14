import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';
import { capituloEsAleatorio } from '../serverUtils/swipe/aleatorio';

/**
 * Duplica un capítulo dentro de la misma sesión: copia nombre/descripción,
 * orden aleatorio e ideas (título, descripción, imagen, orden) — nunca votos,
 * así el nuevo capítulo arranca "bloqueado" y limpio, listo para reusar como
 * base de un siguiente workshop sin tener que rearmar las ideas a mano.
 */
export default createEndpoint({
  authenticated: true,
  description: 'Duplica un capítulo de Swipe (y sus ideas) dentro de la misma sesión',
  inputSchema: z.object({ capituloId: z.string() }),
  outputSchema: z.object({ id: z.string() }),
  execute: async ({ input }) => {
    const capResult = await pool.query(
      `select sesion_id, nombre, descripcion from swipe_capitulos where id = $1`,
      [input.capituloId],
    );
    const cap = capResult.rows[0];
    if (!cap) throw new Error('Capítulo no encontrado');

    const ordenResult = await pool.query(
      `select coalesce(max(orden), -1) + 1 as siguiente from swipe_capitulos where sesion_id = $1`,
      [cap.sesion_id],
    );
    const orden = ordenResult.rows[0].siguiente as number;

    const nuevoResult = await pool.query(
      `insert into swipe_capitulos (sesion_id, nombre, descripcion, orden) values ($1, $2, $3, $4) returning id`,
      [cap.sesion_id, `${cap.nombre} (copia)`, cap.descripcion, orden],
    );
    const nuevoId = nuevoResult.rows[0].id as string;

    // Una copia que olvida el orden aleatorio sesgaría el siguiente workshop sin avisar.
    if (await capituloEsAleatorio(input.capituloId)) {
      await pool.query(`update swipe_capitulos set aleatorio = true where id = $1`, [nuevoId]);
    }

    await pool.query(
      `insert into swipe_ideas (capitulo_id, titulo, descripcion, imagen_url, orden)
       select $1, titulo, descripcion, imagen_url, orden from swipe_ideas where capitulo_id = $2`,
      [nuevoId, input.capituloId],
    );

    return { id: nuevoId };
  },
});
