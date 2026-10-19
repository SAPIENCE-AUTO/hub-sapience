import { z } from 'zod';
import { createEndpoint, ZiteError } from '../../server/compat';
import { pool } from '../../server/compat/db';

// Panel de Actividad de Configuración — exclusivo de Sergio. Esto es
// monitoreo de personas, no un dato operativo: no se abre a otros roles ni
// por rol ni por nivel, solo por correo, y se valida aquí (el gate de la UI
// es solo cosmético).
const ALLOWED_EMAILS = ['sergio@sapience.com.mx'];
// «En línea» = hubo un latido de uso en los últimos 3 min. Es el mismo reloj para «en línea», «visto hace…» y la sección actual (antes el «visto hace»
// salía de users.last_active_at, que también mueven el chat y las páginas de proyecto, y los dos relojes se contradecían).
const ONLINE_WINDOW_MS = 3 * 60 * 1000;

export default createEndpoint({
  authenticated: true,
  description: 'Actividad de uso del Hub por usuario (solo Sergio)',
  inputSchema: z.object({ days: z.number().int().min(1).max(90).optional() }),
  outputSchema: z.object({
    days: z.array(z.string()),
    users: z.array(z.object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
      role: z.string().optional(),
      lastActiveAt: z.string().optional(),
      online: z.boolean(),
      currentSection: z.string().optional(),
      totalSeconds: z.number(),
      secondsByDay: z.record(z.string(), z.number()),
      sections: z.array(z.object({ section: z.string(), seconds: z.number() })),
    })),
  }),
  execute: async ({ input, context }) => {
    if (!ALLOWED_EMAILS.includes(context.user?.email ?? '')) {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Solo Sergio puede ver la actividad de uso.' });
    }
    const nDays = input.days ?? 7;

    const [usersRes, actRes, lastRes] = await Promise.all([
      pool.query(`select id, first_name, last_name, email, role from users order by first_name`),
      pool.query(
        `select user_id, to_char(day, 'YYYY-MM-DD') as day, section, seconds::float8 as seconds, updated_at
         from user_activity
         where day > (now() at time zone 'America/Mexico_City')::date - $1::int`,
        [nDays],
      ),
      // El último latido de cada persona, de cualquier fecha (no solo del rango que se mira), y la sección donde estaba.
      pool.query(`select distinct on (user_id) user_id, section, updated_at from user_activity order by user_id, updated_at desc`),
    ]);

    const days: string[] = [];
    const todayMx = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
    for (let i = nDays - 1; i >= 0; i--) {
      const d = new Date(todayMx); d.setDate(d.getDate() - i);
      days.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    }

    type Row = { user_id: string; day: string; section: string; seconds: number; updated_at: Date };
    const byUser = new Map<string, Row[]>();
    for (const r of actRes.rows as Row[]) {
      if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
      byUser.get(r.user_id)!.push(r);
    }

    const lastByUser = new Map<string, { section: string; at: number }>();
    for (const r of lastRes.rows as Array<{ user_id: string; section: string; updated_at: Date | string }>) {
      lastByUser.set(r.user_id, { section: r.section, at: new Date(r.updated_at).getTime() });
    }

    const now = Date.now();
    const users = usersRes.rows.map((u: any) => {
      const rows = byUser.get(u.id) ?? [];
      const secondsByDay: Record<string, number> = {};
      const secBySection = new Map<string, number>();
      for (const r of rows) {
        if (!(r.seconds > 0)) continue; // un aviso de 0 s («estoy aquí») marca «en línea», pero no es tiempo de uso
        secondsByDay[r.day] = (secondsByDay[r.day] ?? 0) + r.seconds;
        secBySection.set(r.section, (secBySection.get(r.section) ?? 0) + r.seconds);
      }
      const last = lastByUser.get(u.id);
      const online = !!last && now - last.at < ONLINE_WINDOW_MS;
      return {
        id: u.id,
        name: [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email,
        email: u.email,
        role: u.role ?? undefined,
        lastActiveAt: last ? new Date(last.at).toISOString() : undefined,
        online,
        currentSection: online ? last?.section : undefined,
        totalSeconds: Object.values(secondsByDay).reduce((a, b) => a + b, 0),
        secondsByDay,
        sections: [...secBySection.entries()].map(([section, seconds]) => ({ section, seconds })).sort((a, b) => b.seconds - a.seconds),
      };
    }).sort((a, b) => Number(b.online) - Number(a.online) || b.totalSeconds - a.totalSeconds);

    return { days, users };
  },
});
