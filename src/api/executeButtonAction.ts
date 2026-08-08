import { z } from 'zod';
import { createEndpoint, BoardColumns, RecruitmentRows } from '../../server/compat';
import { resolveWriteBoardId, smartWriteCellValue } from '../serverUtils/smartWrite';

export default createEndpoint({
  authenticated: true,
  description: 'Execute the action configured for a button column',
  inputSchema: z.object({
    columnId: z.string(),
    rowId: z.string(),
    boardId: z.string(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ input }) => {
    const { columnId, rowId, boardId } = input;

    // Resolve UUID-first board ID
    let resolvedBoardId = boardId;
    let legacyBoardId: string | undefined = boardId;
    try {
      const res = await resolveWriteBoardId(boardId);
      resolvedBoardId = res.writeBoardId;
      legacyBoardId = res.legacyBoardId ?? boardId;
      if (res.reason === 'legacy-fallback' || res.reason === 'input-passthrough') {
        console.warn('[executeButtonAction] Board UUID not found, using legacy', { boardId, reason: res.reason });
      }
    } catch (err) {
      console.warn('[executeButtonAction] resolveWriteBoardId failed', { boardId, error: String(err) });
    }

    // Load column config
    const col = await BoardColumns.findOne({ id: columnId });
    if (!col || !col.optionsJson) {
      return { success: false, message: 'Columna no encontrada o sin configuración.' };
    }

    let config: {
      action: string;
      label?: string;
      variant?: string;
      newStatus?: string;
      webhookUrl?: string;
    };
    try {
      config = JSON.parse(col.optionsJson);
    } catch {
      return { success: false, message: 'Configuración de botón inválida.' };
    }

    const action = config.action;

    // ── send_nda ──────────────────────────────────────────────
    if (action === 'send_nda') {
      await RecruitmentRows.update({
        id: rowId,
        record: {
          ndaSent: true,
          ndaSentDate: new Date().toISOString(),
        },
      });
      return { success: true, message: 'NDA marcado como enviado.' };
    }

    // ── change_status ─────────────────────────────────────────
    if (action === 'change_status') {
      const newStatus = config.newStatus;
      if (!newStatus) return { success: false, message: 'No se configuró un status de destino.' };

      // Try updating RecruitmentRows status first (most common use case)
      try {
        await RecruitmentRows.update({
          id: rowId,
          record: { status: newStatus },
        });
        return { success: true, message: `Status actualizado a "${newStatus}".` };
      } catch {
        // Fallback: store as a cell value via smartWriteCellValue (UUID-first)
        await smartWriteCellValue({
          uuidBoardId: resolvedBoardId,
          legacyBoardId,
          rowId,
          columnId: '__status__',
          values: { textValue: newStatus },
          isEmpty: false,
        });
        return { success: true, message: `Status actualizado a "${newStatus}".` };
      }
    }

    // ── send_email ────────────────────────────────────────────
    if (action === 'send_email') {
      // Placeholder — integrate with email service when ready
      return { success: true, message: 'Email programado para envío (integración pendiente).' };
    }

    // ── duplicate_row ─────────────────────────────────────────
    if (action === 'duplicate_row') {
      const original = await RecruitmentRows.findOne({ id: rowId });
      if (!original) return { success: false, message: 'Fila no encontrada para duplicar.' };

      const { id: _id, ...rest } = original;
      const dupName = `${rest.rowName ?? 'Fila'} (copia)`;
      await RecruitmentRows.create({ record: { ...rest, rowName: dupName } });

      return { success: true, message: 'Fila duplicada correctamente.' };
    }

    // ── webhook ───────────────────────────────────────────────
    if (action === 'webhook') {
      const webhookUrl = config.webhookUrl;
      if (!webhookUrl) return { success: false, message: 'No se configuró una URL de webhook.' };

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rowId,
          boardId,
          columnId,
          timestamp: new Date().toISOString(),
          action: 'button_click',
        }),
      });

      if (!response.ok) {
        return { success: false, message: `Webhook respondió con código ${response.status}.` };
      }
      return { success: true, message: 'Webhook ejecutado correctamente.' };
    }

    return { success: false, message: `Acción desconocida: ${action}` };
  },
});
