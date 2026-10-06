import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';

// Archivo de grabaciones: archivos movidos de SharePoint a Azure Blob por
// server/scripts/sharepoint-to-blob.ts (tabla archived_files). Sin filtros
// devuelve todo — son unos miles de filas, la agrupación y búsqueda se hacen
// en el cliente.
const fileSchema = z.object({
  id: z.string(),
  projectId: z.string().optional(),
  projectCode: z.string().optional(),
  projectName: z.string().optional(),
  projectFolder: z.string(),
  fileName: z.string(),
  sharepointPath: z.string(),
  sizeBytes: z.number(),
  contentType: z.string().optional(),
  originalModifiedAt: z.string().optional(),
  archivedAt: z.string(),
  estado: z.string(),
});

export default createEndpoint({
  authenticated: true,
  description: 'Lista los archivos movidos de SharePoint a Azure Blob (por proyecto o todos)',
  inputSchema: z.object({ projectId: z.string().optional() }),
  outputSchema: z.object({ files: z.array(fileSchema) }),
  execute: async ({ input }) => {
    const params: unknown[] = [];
    let where = '';
    if (input.projectId) {
      params.push(input.projectId);
      where = 'where a.project_id = $1';
    }
    const r = await pool.query(
      `select a.id, a.project_id, p.project_code, p.full_name, a.project_folder, a.file_name,
              a.sharepoint_path, a.size_bytes::float8 as size_bytes, a.content_type,
              a.original_modified_at, a.created_at, a.estado
         from archived_files a
         left join projects p on p.id = a.project_id
         ${where}
        order by a.project_folder, a.sharepoint_path`,
      params,
    );
    return {
      files: r.rows.map((row) => ({
        id: row.id,
        projectId: row.project_id ?? undefined,
        projectCode: row.project_code ?? undefined,
        projectName: row.full_name ?? undefined,
        projectFolder: row.project_folder,
        fileName: row.file_name,
        sharepointPath: row.sharepoint_path,
        sizeBytes: row.size_bytes,
        contentType: row.content_type ?? undefined,
        originalModifiedAt: row.original_modified_at ?? undefined,
        archivedAt: row.created_at,
        estado: row.estado,
      })),
    };
  },
});
