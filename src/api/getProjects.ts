import { z } from 'zod';
import { createEndpoint, Projects, Tasks, CalendarEvents } from '../../server/compat';

const linkedField = z.union([z.string(), z.array(z.string())]).optional();

const projectSchema = z.object({
  id: z.string(),
  projectCode: z.string().optional(),
  fullName: z.string().optional(),
  status: z.string().optional(),
  client: z.string().optional(),
  tematica: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  description: z.string().optional(),
  timelineStatus: z.string().optional(),
  timelineUrl: z.string().optional(),
  timelineUpdatedAt: z.string().optional(),
  teamsChannelUrl: z.string().optional(),
  teamsChannelStatus: z.string().optional(),
  computedStartDate: z.string().optional(),
  computedEndDate: z.string().optional(),
  lider: linkedField,
  analistas: linkedField,
  moderadores: linkedField,
  asistentes: linkedField,
  muestra: z.string().optional(),
  muestraImagen: z.string().optional(),
});

export default createEndpoint({
  authenticated: true,
  description: 'Get all projects with auto-detected start/end dates from tasks and calendar events',
  inputSchema: z.object({ search: z.string().optional() }),
  outputSchema: z.object({ projects: z.array(projectSchema) }),
  execute: async ({ input }) => {
    // Fetch projects, tasks, and events in parallel — minimal fields on all three
    const [{ records: projects }, { records: tasks }, { records: events }] = await Promise.all([
      Projects.findAll({
        limit: 500,
        fields: [
          'projectCode', 'fullName', 'status', 'client', 'tematica',
          'startDate', 'endDate', 'description',
          'timelineStatus', 'timelineUrl', 'timelineUpdatedAt',
          'teamsChannelUrl', 'teamsChannelStatus',
          'lider', 'analistas', 'moderadores', 'asistentes', 'muestra', 'muestraImagen',
        ],
      }),
      Tasks.findAll({ limit: 1000, fields: ['projectCode', 'startDate', 'endDate', 'deletedAt'] }),
      CalendarEvents.findAll({ limit: 500, fields: ['projectCode', 'eventDate'] }),
    ]);

    // Build min/max date maps per projectCode from native task fields only
    const minMap = new Map<string, string>();
    const maxMap = new Map<string, string>();

    const updateMin = (code: string, d: string) => {
      const ex = minMap.get(code); if (!ex || d < ex) minMap.set(code, d);
    };
    const updateMax = (code: string, d: string) => {
      const ex = maxMap.get(code); if (!ex || d > ex) maxMap.set(code, d);
    };

    for (const t of tasks) {
      if (!t.projectCode || t.deletedAt) continue;
      const start = t.startDate?.split('T')[0];
      const end   = t.endDate?.split('T')[0];
      if (start) updateMin(t.projectCode, start);
      if (end)   updateMax(t.projectCode, end);
    }

    for (const ev of events) {
      if (!ev.projectCode || !ev.eventDate) continue;
      const d = ev.eventDate.split('T')[0];
      if (d) { updateMin(ev.projectCode, d); updateMax(ev.projectCode, d); }
    }

    const filtered = input.search
      ? projects.filter(r =>
          r.projectCode?.toLowerCase().includes(input.search!.toLowerCase()) ||
          r.fullName?.toLowerCase().includes(input.search!.toLowerCase()) ||
          r.client?.toLowerCase().includes(input.search!.toLowerCase())
        )
      : projects;

    return {
      projects: filtered.map(p => ({
        ...p,
        startDate: p.startDate?.split('T')[0],
        endDate:   p.endDate?.split('T')[0],
        computedStartDate: p.projectCode ? minMap.get(p.projectCode) : undefined,
        computedEndDate:   p.projectCode ? maxMap.get(p.projectCode) : undefined,
        lider: p.lider,
        analistas: p.analistas,
        moderadores: p.moderadores,
        asistentes: p.asistentes,
        muestra: (p as any).muestra,
        muestraImagen: (p as any).muestraImagen,
      })),
    };
  },
});
