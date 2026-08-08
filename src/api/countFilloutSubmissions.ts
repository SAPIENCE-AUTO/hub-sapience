import { z } from 'zod';
import { createEndpoint, BoardColumns, RecruitmentRows } from '../../server/compat';

const normalize = (str: string) =>
  str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

export default createEndpoint({
  authenticated: true,
  description: 'Counts how many new Fillout submissions are available for a board without importing anything.',
  inputSchema: z.object({ boardId: z.string() }),
  outputSchema: z.object({ total: z.number(), newCount: z.number() }),
  execute: async ({ input }) => {
    const apiKey = process.env.ZITE_FILLOUT_API_KEY ?? '';
    if (!apiKey) throw new Error('Fillout API key not configured');

    const { records: cols } = await BoardColumns.findAll({
      filters: { boardId: input.boardId, columnType: '__fillout_link__' },
      limit: 5,
    });
    const linkCol = cols[0];
    if (!linkCol?.optionsJson) return { total: 0, newCount: 0 };

    const meta = JSON.parse(linkCol.optionsJson) as {
      formId: string;
      projectCode: string;
      boardName: string;
      lastSyncedAt?: string;
    };
    const { formId, projectCode, boardName } = meta;

    // Compute afterDate with 5-min overlap window
    let afterDate: string | undefined;
    if (meta.lastSyncedAt) {
      const cursor = new Date(meta.lastSyncedAt);
      cursor.setMinutes(cursor.getMinutes() - 5);
      afterDate = cursor.toISOString();
    }

    // Fetch submissions from Fillout (paginated)
    const PAGE_SIZE = 50;
    const submissions: any[] = [];
    let offset = 0;
    while (true) {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
        sort: 'asc',
        status: 'finished',
      });
      if (afterDate) params.set('afterDate', afterDate);

      const res = await fetch(`https://api.fillout.com/v1/api/forms/${formId}/submissions?${params}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (res.status === 429 || !res.ok) break;

      const data = await res.json();
      const page: any[] = data.responses ?? data.submissions ?? (Array.isArray(data) ? data : []);
      if (page.length === 0) break;
      submissions.push(...page);
      if (page.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    if (submissions.length === 0) return { total: 0, newCount: 0 };

    // Build set of already-imported submissionIds (same dedup logic as checkNewSubmissions)
    const { records: existingRows } = await RecruitmentRows.findAll({
      filters: { boardName, projectCode },
      limit: 2000,
      fields: ['email', 'participantName', 'sourceForm'],
    });

    const importedSubmissionIds = new Set<string>();

    for (const r of existingRows) {
      if (r.sourceForm && r.sourceForm.includes('|')) {
        const parts = r.sourceForm.split('|');
        if (parts.length >= 2) importedSubmissionIds.add(parts[parts.length - 1]);
      }
    }

    // Count truly new submissions
    const newSubmissions = submissions.filter(s => {
      const sid = s.submissionId ?? s.id;
      return sid ? !importedSubmissionIds.has(String(sid)) : true;
    });

    return { total: submissions.length, newCount: newSubmissions.length };
  },
});
