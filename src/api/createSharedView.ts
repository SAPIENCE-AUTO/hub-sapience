import { z } from 'zod';
import { createEndpoint, SharedViews } from '../../server/compat';
import { randomUUID } from 'crypto';
import { resolveWriteBoardId } from '../serverUtils/smartWrite';

export default createEndpoint({
  authenticated: true,
  description: 'Creates a shareable read-only view for a recruitment board. Optionally duplicates from an existing view token.',
  inputSchema: z.object({
    viewName: z.string().optional(),
    boardId: z.string().optional(),
    projectCode: z.string().optional(),
    boardName: z.string().optional(),
    filtersJson: z.string().optional(),
    visibleColumnsJson: z.string().optional(),
    duplicateFromToken: z.string().optional(),
  }),
  outputSchema: z.object({
    id: z.string(),
    token: z.string(),
    shareUrl: z.string(),
  }),
  execute: async ({ input, context }) => {
    const token = randomUUID();

    if (input.duplicateFromToken) {
      // ── Duplicate mode ────────────────────────────────────────────────
      const original = await SharedViews.findOne({ filters: { token: input.duplicateFromToken } });
      if (!original) throw new Error('Vista original no encontrada');

      // Resolve the original's boardId to UUID if it's still legacy
      const dupResolved = await resolveWriteBoardId(original.boardId ?? '', {
        projectCode: original.projectCode ?? undefined,
        boardName: original.boardName ?? undefined,
        boardType: 'recruitment',
      });

      const record = await SharedViews.create({
        record: {
          viewName: `Copia de ${original.viewName ?? 'Vista'}`,
          boardId: dupResolved.writeBoardId,
          projectCode: original.projectCode,
          boardName: original.boardName,
          token,
          filtersJson: original.filtersJson,
          visibleColumnsJson: original.visibleColumnsJson,
          createdBy: context.user!.email,
          active: true,
        },
      });
      const shareUrl = `${process.env.ZITE_APP_URL ?? ''}/shared/${token}`;
      return { id: record.id, token, shareUrl };
    }

    // ── Normal create mode ──────────────────────────────────────────────

    // Resolve boardId to UUID
    const resolved = await resolveWriteBoardId(input.boardId ?? '', {
      projectCode: input.projectCode ?? undefined,
      boardName: input.boardName ?? undefined,
      boardType: 'recruitment',
    });
    const effectiveBoardId = resolved.writeBoardId;

    // Anti-duplicate: check if an equivalent view already exists under legacy
    if (resolved.legacyBoardId && resolved.legacyBoardId !== effectiveBoardId) {
      const { records: legacyViews } = await SharedViews.findAll({
        filters: { boardId: resolved.legacyBoardId, viewName: input.viewName ?? '' },
        limit: 1,
      });
      const existing = legacyViews.find(v => v.active !== false);
      if (existing) {
        // Move existing view to UUID instead of creating duplicate
        await SharedViews.update({
          id: existing.id,
          record: { boardId: effectiveBoardId },
        });
        console.log('[createSharedView] Moved existing legacy view to UUID', {
          id: existing.id, from: resolved.legacyBoardId, to: effectiveBoardId,
        });
        const shareUrl = `${process.env.ZITE_APP_URL ?? ''}/shared/${existing.token ?? ''}`;
        return { id: existing.id, token: existing.token ?? '', shareUrl };
      }
    }

    const record = await SharedViews.create({
      record: {
        viewName: input.viewName ?? '',
        boardId: effectiveBoardId,
        projectCode: input.projectCode ?? '',
        boardName: input.boardName ?? '',
        token,
        filtersJson: input.filtersJson ?? '{}',
        visibleColumnsJson: input.visibleColumnsJson ?? '[]',
        createdBy: context.user!.email,
        active: true,
      },
    });
    const shareUrl = `${process.env.ZITE_APP_URL ?? ''}/shared/${token}`;
    return { id: record.id, token, shareUrl };
  },
});
