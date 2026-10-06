import { z } from 'zod';
import { createEndpoint, pool, ZiteError } from '../../server/compat';
import { archiveBlobSasUrl } from '../../server/azure/blobSas';

// Link temporal (SAS de solo lectura, 2 h) a un archivo del archivo de
// grabaciones. El contenedor de Blob es privado: este endpoint es la única
// puerta, y exige sesión del Hub. Con `download: true` el link fuerza la
// descarga con el nombre original en vez de reproducir en el navegador.
export default createEndpoint({
  authenticated: true,
  description: 'Devuelve un link temporal para reproducir o descargar un archivo archivado en Azure Blob',
  inputSchema: z.object({ id: z.string().uuid(), download: z.boolean().optional() }),
  outputSchema: z.object({
    url: z.string(),
    file: z.object({
      id: z.string(),
      fileName: z.string(),
      projectFolder: z.string(),
      projectCode: z.string().optional(),
      sharepointPath: z.string(),
      sizeBytes: z.number(),
      contentType: z.string().optional(),
      originalModifiedAt: z.string().optional(),
    }),
  }),
  execute: async ({ input }) => {
    const r = await pool.query(
      `select a.id, a.file_name, a.project_folder, p.project_code, a.sharepoint_path, a.blob_name,
              a.size_bytes::float8 as size_bytes, a.content_type, a.original_modified_at
         from archived_files a
         left join projects p on p.id = a.project_id
        where a.id = $1`,
      [input.id],
    );
    const row = r.rows[0];
    if (!row) throw new ZiteError({ code: 'NOT_FOUND', message: 'Archivo no encontrado' });
    return {
      url: archiveBlobSasUrl(row.blob_name, input.download ? { downloadName: row.file_name } : {}),
      file: {
        id: row.id,
        fileName: row.file_name,
        projectFolder: row.project_folder,
        projectCode: row.project_code ?? undefined,
        sharepointPath: row.sharepoint_path,
        sizeBytes: row.size_bytes,
        contentType: row.content_type ?? undefined,
        originalModifiedAt: row.original_modified_at ?? undefined,
      },
    };
  },
});
