import { z } from 'zod';
import { createEndpoint, DocumentBlocks } from '../../server/compat';
import { publishEvent } from '../lib/ably';

export default createEndpoint({
  description: 'Create or update a document block, with optional version-conflict detection',
  authenticated: true,
  inputSchema: z.object({
    id: z.string().optional(),
    dealId: z.string().optional(),
    projectCode: z.string().optional(),
    blockType: z.string().optional(),
    content: z.string().optional(),
    documentJson: z.string().optional(),
    sortOrder: z.number().optional(),
    checklistData: z.string().optional(),
    // Collaborative editing
    expectedVersion: z.number().optional(),
    changedBlockId: z.string().optional(),
    operationType: z.enum(['block_update', 'structure_update']).optional(),
  }),
  outputSchema: z.object({
    id: z.string(),
    success: z.boolean().optional(),
    conflict: z.boolean().optional(),
    currentVersion: z.number().optional(),
    currentDocument: z.string().optional(),
    savedVersion: z.number().optional(),
  }),
  execute: async ({ input, context }) => {
    const now = new Date().toISOString();
    const {
      id, dealId, projectCode, content, blockType, sortOrder, checklistData, documentJson,
      expectedVersion, changedBlockId, operationType,
    } = input;

    const userName =
      [context.user!.firstName, context.user!.lastName].filter(Boolean).join(' ') ||
      context.user!.email;

    if (id) {
      let finalDocJson = documentJson;
      let savedVersion: number | undefined;

      // ── Version check + increment ──────────────────────────────────────────
      if (documentJson !== undefined && expectedVersion !== undefined) {
        const existingRecord = await DocumentBlocks.findOne({ id });
        let currentVersion = 0;
        if (existingRecord?.documentJson) {
          try {
            const currentDoc = JSON.parse(existingRecord.documentJson as string);
            currentVersion = typeof currentDoc.version === 'number' ? currentDoc.version : 0;
          } catch {}
        }

        if (currentVersion !== expectedVersion) {
          return {
            id,
            success: false,
            conflict: true,
            currentVersion,
            currentDocument: (existingRecord?.documentJson as string | undefined) ?? undefined,
          };
        }

        // Increment version in the document JSON before saving
        try {
          const docObj = JSON.parse(documentJson);
          docObj.version = currentVersion + 1;
          docObj.updatedAt = now;
          finalDocJson = JSON.stringify(docObj);
          savedVersion = docObj.version;
        } catch {
          finalDocJson = documentJson;
        }
      }

      const record: Record<string, unknown> = { updatedAt: now };
      if (content !== undefined) record.blockContent = content;
      if (blockType !== undefined) record.blockType = blockType;
      if (sortOrder !== undefined) record.sortOrder = sortOrder;
      if (checklistData !== undefined) record.checklistData = checklistData;
      if (finalDocJson !== undefined) record.documentJson = finalDocJson;

      await DocumentBlocks.update({ id, record });

      // ── Publish Ably events best-effort ────────────────────────────────────
      if (savedVersion !== undefined && finalDocJson) {
        const basePayload = {
          docId: id,
          updatedAt: now,
          userId: context.user!.id,
          userEmail: context.user!.email,
          userName,
          docVersion: savedVersion,
        };

        if (operationType === 'block_update' && changedBlockId) {
          try {
            const docObj = JSON.parse(finalDocJson);
            const foundBlock = docObj.blocks?.find((b: any) => b.id === changedBlockId);
            if (foundBlock) {
              await publishEvent(`doc:${id}`, 'block.update', {
                ...basePayload,
                blockId: changedBlockId,
                block: foundBlock,
              });
            }
          } catch (err) {
            console.warn('[saveDocBlock] block.update publish failed:', (err as Error).message);
          }
        } else if (operationType === 'structure_update') {
          try {
            await publishEvent(`doc:${id}`, 'doc.structure_changed', {
              ...basePayload,
              operationId: Math.random().toString(36).slice(2, 10),
            });
          } catch (err) {
            console.warn('[saveDocBlock] doc.structure_changed publish failed:', (err as Error).message);
          }
        }
      }

      return { id, success: true, savedVersion };
    }

    // ── Create new record ────────────────────────────────────────────────────
    const authorName =
      [context.user!.firstName, context.user!.lastName].filter(Boolean).join(' ') ||
      context.user!.email;

    const isMinuta = blockType === 'Minuta';
    const resolvedChecklistData = isMinuta
      ? (projectCode ?? checklistData ?? '')
      : (checklistData ?? undefined);

    const created = await DocumentBlocks.create({
      record: {
        blockContent: content,
        blockType,
        sortOrder,
        checklistData: resolvedChecklistData,
        deal: (!isMinuta && dealId) ? [dealId] : undefined,
        authorName,
        authorEmail: context.user!.email,
        createdAt: now,
        updatedAt: now,
        ...(documentJson !== undefined ? { documentJson } : {}),
      } as any,
    });
    return { id: created.id, success: true };
  },
});
