import { z } from 'zod';
import { createEndpoint, Messages, ChatConversations, TaskComments, Users } from 'zite-integrations-backend-sdk';
import { parseMembers } from '../lib/chatJson';
import { publishEvent, safeUserChannel } from '../lib/ably';

const TASK_MENTION_RE = /\[✅\s*([^\]]+)\]\(task:([^)]+)\)/g;

function extractTaskMentions(content: string): { taskName: string; taskId: string }[] {
  const results: { taskName: string; taskId: string }[] = [];
  const re = new RegExp(TASK_MENTION_RE.source, 'g');
  let m;
  while ((m = re.exec(content)) !== null) {
    results.push({ taskName: m[1].trim(), taskId: m[2].trim() });
  }
  return results;
}

export default createEndpoint({
  description: 'Send a message to a channel',
  authenticated: true,
  inputSchema: z.object({
    channel: z.string(),
    content: z.string(),
    parentMessageId: z.string().optional(),
    attachments: z.string().optional(), // JSON array of {url, name, type}
  }),
  outputSchema: z.object({ success: z.boolean(), id: z.string() }),
  execute: async ({ input, context }) => {
    // Check if this channel is a DM/group conversation (not "general" or a project code)
    if (input.channel !== 'general') {
      try {
        const conv = await ChatConversations.findOne({ id: input.channel });
        if (conv) {
          // It's a conversation record — verify the user is a member
          const members: string[] = parseMembers(conv.members);
          if (!members.includes(context.user!.email)) {
            throw new Error('No tienes acceso a esta conversación');
          }
        }
        // If conv is undefined → not found, treat as regular project channel, allow access
      } catch (err) {
        // Re-throw access errors
        if (err instanceof Error && err.message === 'No tienes acceso a esta conversación') {
          throw err;
        }
        // Otherwise: lookup error → treat as regular channel, allow access
      }
    }

    const senderName = [context.user!.firstName, context.user!.lastName].filter(Boolean).join(' ') || context.user!.email;
    const now = new Date().toISOString();

    const record = await Messages.create({
      record: {
        channel: input.channel,
        content: input.content,
        senderName,
        senderEmail: context.user!.email,
        sentAt: now,
        parentMessageId: input.parentMessageId,
        attachments: input.attachments,
      },
    });

    console.log('[sendMessage] message created', { messageId: record.id, channel: input.channel });

    // Side-effect: piggyback presence update — keeps user active without extra endpoint calls
    try {
      await Users.update({
        id: context.user!.id,
        record: {
          lastActiveAt: now,
          activeChannel: input.channel,
        } as Parameters<typeof Users.update>[0]['record'],
      });
    } catch {
      // Silent — never fail sendMessage for presence
    }

    // Update lastMessageAt on DM/group conversations (not general/project channels)
    try {
      if (input.channel !== 'general') {
        const convToUpdate = await ChatConversations.findOne({ id: input.channel });
        if (convToUpdate) {
          await ChatConversations.update({ id: convToUpdate.id, record: { lastMessageAt: now } });
          console.log('[sendMessage][conv-ts updated]', { convId: convToUpdate.id });
        }
      }
    } catch (err) {
      console.error('[sendMessage][update-conv-ts failed]', {
        message: err instanceof Error ? err.message : String(err),
      });
    }

    // Detect task mentions — side effect, never fails the endpoint
    try {
      const directMentions = extractTaskMentions(input.content);

      if (directMentions.length > 0) {
        const directTaskIds = new Set(directMentions.map(m => m.taskId));

        // Create TaskComment for each directly mentioned task
        const directRecords = directMentions.map(({ taskName, taskId }) => ({
          taskId,
          messageId: record.id,
          taskName,
          channel: input.channel,
          senderName,
          senderEmail: context.user!.email,
          content: input.content,
          sentAt: now,
          isThreadReply: false,
        }));
        if (directRecords.length > 0) {
          await TaskComments.bulkCreate({ records: directRecords });
        }

        // If this is a thread reply, also mark the parent's tasks as having a reply
        if (input.parentMessageId) {
          const parentMsg = await Messages.findOne({ id: input.parentMessageId, fields: ['content'] });
          if (parentMsg?.content) {
            const parentMentions = extractTaskMentions(parentMsg.content).filter(m => !directTaskIds.has(m.taskId));
            if (parentMentions.length > 0) {
              const replyRecords = parentMentions.map(({ taskName, taskId }) => ({
                taskId,
                messageId: record.id,
                taskName,
                channel: input.channel,
                senderName,
                senderEmail: context.user!.email,
                content: input.content,
                sentAt: now,
                isThreadReply: true,
              }));
              await TaskComments.bulkCreate({ records: replyRecords });
            }
          }
        }
      } else if (input.parentMessageId) {
        // No direct task mentions — but if replying to a task-mentioning message, mark as reply
        const parentMsg = await Messages.findOne({ id: input.parentMessageId, fields: ['content'] });
        if (parentMsg?.content) {
          const parentMentions = extractTaskMentions(parentMsg.content);
          if (parentMentions.length > 0) {
            const replyRecords = parentMentions.map(({ taskName, taskId }) => ({
              taskId,
              messageId: record.id,
              taskName,
              channel: input.channel,
              senderName,
              senderEmail: context.user!.email,
              content: input.content,
              sentAt: now,
              isThreadReply: true,
            }));
            await TaskComments.bulkCreate({ records: replyRecords });
          }
        }
      }
    } catch (err) {
      console.error('[sendMessage][side-effect failed]', {
        step: 'task-comments',
        messageId: record.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }

    console.log('[sendMessage] publishing ably', { ablyChannel: `chat:${input.channel}`, messageId: record.id });

    try {
      await publishEvent(`chat:${input.channel}`, 'message.created', {
        id: record.id,
        channel: input.channel,
        content: input.content,
        senderName,
        senderEmail: context.user!.email,
        sentAt: now,
        parentMessageId: input.parentMessageId ?? undefined,
        attachments: input.attachments ?? undefined,
        pinned: false,
        reactions: undefined,
      });
    } catch (err) {
      console.error('[sendMessage][ably publish failed]', {
        channel: input.channel,
        messageId: record.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }

    // Side-effect: notify each recipient on their personal Ably channel
    try {
      const senderEmailLower = context.user!.email.toLowerCase();

      // Fetch all users for name lookup and recipient resolution
      const { records: allUsers } = await Users.findAll({
        limit: 500,
        fields: ['email', 'firstName', 'lastName', 'hiddenFromChat'],
      });

      let recipientEmails: string[];
      let resolvedAsConv = false;
      let resolvedConvType: string | null = null;

      if (input.channel === 'general') {
        // General channel: everyone who is not hidden
        recipientEmails = allUsers
          .filter(u => u.email && u.hiddenFromChat !== true)
          .map(u => u.email as string);
      } else {
        // Try to resolve as DM/group conversation
        try {
          const convRecord = await ChatConversations.findOne({ id: input.channel });
          if (convRecord) {
            resolvedAsConv = true;
            resolvedConvType = convRecord.type ?? null;
            recipientEmails = parseMembers(convRecord.members);
          } else {
            recipientEmails = [];
          }
        } catch {
          recipientEmails = [];
        }

        if (!resolvedAsConv) {
          // Project channel: notify all non-hidden users (V1 — no project membership filter)
          recipientEmails = allUsers
            .filter(u => u.email && u.hiddenFromChat !== true)
            .map(u => u.email as string);
        }
      }

      // Exclude sender
      recipientEmails = recipientEmails.filter(e => e && e.toLowerCase() !== senderEmailLower);

      // Build lookup map for mention detection
      const userMap = new Map(allUsers.map(u => [u.email?.toLowerCase() ?? '', u]));
      const contentLower = input.content.toLowerCase();
      let mentionCount = 0;

      // Build a clean content preview (strip markdown, max 80 chars)
      const contentPreview = input.content
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links → label
        .replace(/[*_~`#>]/g, '')                 // bold, italic, code, headings, blockquotes
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80) || '📎 Archivo';

      await Promise.allSettled(
        recipientEmails.map(email => {
          const u = userMap.get(email.toLowerCase());
          const fullName = `${u?.firstName ?? ''} ${u?.lastName ?? ''}`.trim().toLowerCase();
          const hasMention = fullName ? contentLower.includes(`@${fullName}`) : false;
          if (hasMention) mentionCount++;

          return publishEvent(safeUserChannel(email), 'notification.new_message', {
            channel: input.channel,
            messageId: record.id,
            senderName,
            senderEmail: context.user!.email,
            hasMention,
            sentAt: now,
            contentPreview,
            isConversation: resolvedAsConv,
            conversationType: resolvedConvType,
          });
        }),
      );

      console.log('[sendMessage][user-notify]', { channel: input.channel, recipients: recipientEmails.length, mentions: mentionCount });
    } catch (err) {
      console.error('[sendMessage][user-notify failed]', {
        message: err instanceof Error ? err.message : String(err),
      });
    }

    console.log('[sendMessage] returning success', { messageId: record.id });

    return { success: true, id: record.id };
  },
});
