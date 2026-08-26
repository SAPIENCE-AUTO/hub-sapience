import { z } from 'zod';
import { createEndpoint, pool, DocumentBlocks, ZiteError } from '../../server/compat';

const EMPTY_DOC = JSON.stringify({ schemaVersion: 2, version: 1, blocks: [{ type: 'paragraph', content: [] }] });

export default createEndpoint({
  authenticated: true,
  description: 'Crea (si no existe todavía) y regresa el id del document_blocks que guarda las notas con formato de un pendiente personal. Bloque standalone tipo Texto (sin deal) — mismo motor que usan las minutas, pero privado: nadie más lo ve ni lo puede abrir salvo por conocer el id, y el editor se monta con collaborative=false.',
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ blockId: z.string() }),
  execute: async ({ input, context }) => {
    const userId = context.user!.id;

    const { rows } = await pool.query(
      `select notas_block_id from pendientes_personales where id = $1 and user_id = $2`,
      [input.id, userId],
    );
    if (rows.length === 0) throw new ZiteError({ code: 'NOT_FOUND', message: 'Pendiente no encontrado' });
    if (rows[0].notas_block_id) return { blockId: rows[0].notas_block_id };

    const now = new Date().toISOString();
    const authorName = [context.user!.firstName, context.user!.lastName].filter(Boolean).join(' ') || context.user!.email;
    const created = await DocumentBlocks.create({
      record: {
        blockType: 'Texto',
        authorName,
        authorEmail: context.user!.email,
        createdAt: now,
        updatedAt: now,
        documentJson: EMPTY_DOC,
      } as any,
    });

    await pool.query(`update pendientes_personales set notas_block_id = $1 where id = $2`, [created.id, input.id]);
    return { blockId: created.id };
  },
});
