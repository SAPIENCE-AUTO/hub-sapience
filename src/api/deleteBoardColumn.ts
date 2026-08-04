import { z } from 'zod';
import { createEndpoint, BoardColumns, CellValues } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  authenticated: true,
  description: 'Soft-delete a board column and its associated cell values',
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    const now = new Date().toISOString();
    const u = context.user;
    const deletedBy = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email;

    // Soft-delete all associated cell values
    const { records } = await CellValues.findAll({
      filters: { columnId: input.id },
      fields: ['id'],
      limit: 500,
    });
    for (const cell of records) {
      await CellValues.update({ id: cell.id, record: { deletedAt: now } });
    }

    // Soft-delete the column itself, recording who did it
    await BoardColumns.update({
      id: input.id,
      record: { deletedAt: now, deletedBy },
    });

    return { success: true };
  },
});
