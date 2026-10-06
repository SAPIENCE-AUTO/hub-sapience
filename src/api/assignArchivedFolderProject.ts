import { z } from 'zod';
import { createEndpoint, pool, ZiteError } from '../../server/compat';

// Liga una carpeta raíz del archivo de grabaciones (p. ej. 'DOS DOS') a un
// proyecto del Hub, para las carpetas cuyo nombre no casó solo con ningún
// proyecto. sharepoint-to-blob.ts reutiliza esta asignación para lo que se
// archive después de la misma carpeta (ver loadProjectIndex).
export default createEndpoint({
  authenticated: true,
  description: 'Asigna todos los archivos archivados de una carpeta raíz a un proyecto del Hub',
  inputSchema: z.object({ projectFolder: z.string().min(1), projectId: z.string().uuid().nullable() }),
  outputSchema: z.object({ updated: z.number() }),
  execute: async ({ input }) => {
    if (input.projectId) {
      const p = await pool.query('select 1 from projects where id = $1', [input.projectId]);
      if (!p.rowCount) throw new ZiteError({ code: 'NOT_FOUND', message: 'Proyecto no encontrado' });
    }
    const r = await pool.query('update archived_files set project_id = $2 where project_folder = $1', [input.projectFolder, input.projectId]);
    return { updated: r.rowCount ?? 0 };
  },
});
