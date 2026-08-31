import { z } from 'zod';
import { createEndpoint, Users, Projects, CalendarEvents, RecruitmentRows, Tasks } from '../../server/compat';

// ── In-memory cache (10 min TTL) ─────────────────────────────────────────────
const CACHE_TTL_MS = 10 * 60 * 1000;
let cache: {
  data: {
    members: { id: string; email?: string; firstName?: string; lastName?: string }[];
    projects: { code: string; name?: string; status?: string }[];
    events: { id: string; name: string; date?: string; projectCode?: string }[];
    groups: { name: string; projectCode?: string }[];
    tasks: { id: string; name: string; projectCode?: string; status?: string; boardName?: string }[];
  };
  expiresAt: number;
} | null = null;

export default createEndpoint({
  description: 'Get team members, projects, events, groups and tasks for the mention reference picker',
  authenticated: true,
  inputSchema: z.object({}),
  outputSchema: z.object({
    members: z.array(z.object({
      id: z.string(),
      email: z.string().optional(),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
    })),
    projects: z.array(z.object({
      code: z.string(),
      name: z.string().optional(),
      status: z.string().optional(),
    })),
    events: z.array(z.object({
      id: z.string(),
      name: z.string(),
      date: z.string().optional(),
      projectCode: z.string().optional(),
    })),
    groups: z.array(z.object({
      name: z.string(),
      projectCode: z.string().optional(),
    })),
    tasks: z.array(z.object({
      id: z.string(),
      name: z.string(),
      projectCode: z.string().optional(),
      status: z.string().optional(),
      boardName: z.string().optional(),
    })),
  }),
  execute: async () => {
    // Return cached data if still fresh
    if (cache && Date.now() < cache.expiresAt) {
      return cache.data;
    }

    const [
      { records: users },
      { records: projects },
      { records: eventRecords },
      { records: recruitRows },
      { records: taskRecords },
    ] = await Promise.all([
      Users.findAll({ limit: 100, fields: ['email', 'firstName', 'lastName', 'hiddenFromChat'] }),
      Projects.findAll({ limit: 200, fields: ['projectCode', 'fullName', 'status'] }),
      CalendarEvents.findAll({ limit: 200, fields: ['eventName', 'eventDate', 'projectCode'] }),
      RecruitmentRows.findAll({ limit: 500, fields: ['group', 'projectCode'] }),
      Tasks.findAll({ limit: 500, fields: ['taskName', 'projectCode', 'status', 'boardName', 'parentTaskId', 'deletedAt'] }),
    ]);

    // Deduplicate groups by name
    const seenGroups = new Map<string, string | undefined>();
    for (const row of recruitRows) {
      if (row.group && !seenGroups.has(row.group)) {
        seenGroups.set(row.group, row.projectCode ?? undefined);
      }
    }

    const data = {
      members: users.filter(u => !u.hiddenFromChat).map(u => ({
        id: u.id,
        email: u.email ?? undefined,
        firstName: u.firstName ?? undefined,
        lastName: u.lastName ?? undefined,
      })),
      projects: projects
        .filter(p => p.projectCode)
        .map(p => ({
          code: p.projectCode!,
          name: p.fullName ?? p.projectCode ?? '',
          status: p.status ?? undefined,
        })),
      events: eventRecords
        .filter(e => e.eventName)
        .map(e => ({
          id: e.id,
          name: e.eventName!,
          date: e.eventDate ?? undefined,
          projectCode: e.projectCode ?? undefined,
        })),
      groups: Array.from(seenGroups.entries()).map(([name, projectCode]) => ({
        name,
        projectCode,
      })),
      tasks: taskRecords
        .filter(t => t.taskName && !t.parentTaskId && !t.deletedAt)
        .map(t => ({
          id: t.id,
          name: t.taskName!,
          projectCode: t.projectCode ?? undefined,
          status: t.status ?? undefined,
          boardName: t.boardName ?? undefined,
        })),
    };

    // Store in cache
    cache = { data, expiresAt: Date.now() + CACHE_TTL_MS };

    return data;
  },
});
