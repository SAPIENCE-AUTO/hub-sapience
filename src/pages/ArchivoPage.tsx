import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getArchivedFiles } from 'zite-endpoints-sdk';
import { Archive, ChevronDown, ChevronRight, Loader2, Search, Share2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import ArchivedFileList from '@/components/archivo/ArchivedFileList';
import AssignProjectPopover from '@/components/archivo/AssignProjectPopover';
import ArchivedFilePlayerDialog from '@/components/archivo/ArchivedFilePlayerDialog';
import ShareScopeDialog, { type ScopeToShare } from '@/components/archivo/ShareScopeDialog';
import { type ArchivedFile, formatBytes, groupBy } from '@/components/archivo/utils';

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// /archivo y /archivo/:id — todo lo que se movió de SharePoint a Azure Blob.
// /archivo/:id es el destino de los accesos directos .url que quedaron en
// SharePoint: abre la lista con ese archivo ya reproduciéndose.
export default function ArchivoPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [files, setFiles] = useState<ArchivedFile[] | null>(null);
  const [query, setQuery] = useState('');
  const [openProjects, setOpenProjects] = useState<Record<string, boolean>>({});
  const [shareTarget, setShareTarget] = useState<ScopeToShare | null>(null);

  const load = () => getArchivedFiles({})
    .then(res => setFiles(res.files))
    .catch(() => setFiles([]));
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    if (!files) return [];
    const q = norm(query.trim());
    if (!q) return files;
    return files.filter(f => norm(`${f.sharepointPath} ${f.projectCode ?? ''} ${f.projectName ?? ''}`).includes(q));
  }, [files, query]);

  const projects = useMemo(
    () => groupBy(filtered, f => f.projectFolder).sort(([a], [b]) => a.localeCompare(b, 'es')),
    [filtered],
  );
  const total = filtered.reduce((s, f) => s + f.sizeBytes, 0);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Archive className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-bold">Archivo de grabaciones</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Archivos que se movieron de SharePoint a almacenamiento de archivo para liberar espacio. Solo los usuarios del Hub pueden abrirlos.
        </p>

        <div className="relative">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar por proyecto, carpeta o nombre de archivo" className="pl-9" />
        </div>

        {files === null ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-8"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</div>
        ) : files.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8">Todavía no se ha archivado nada.</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">{projects.length} {projects.length === 1 ? 'proyecto' : 'proyectos'} · {filtered.length} {filtered.length === 1 ? 'archivo' : 'archivos'} · {formatBytes(total)}</p>
            <div className="space-y-2">
              {projects.map(([folder, items]) => {
                const isOpen = openProjects[folder] ?? (!!query.trim() || projects.length === 1);
                const first = items[0];
                return (
                  <div key={folder} className="border border-border rounded-lg">
                    <div className="flex items-center pr-2">
                      <button
                        onClick={() => setOpenProjects(prev => ({ ...prev, [folder]: !isOpen }))}
                        className="flex-1 min-w-0 flex items-center gap-2 px-3 py-2.5 text-left"
                      >
                        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        <span className="text-sm font-semibold truncate">{folder}</span>
                        {first.projectCode && first.projectCode !== folder && (
                          <span className="text-xs text-muted-foreground truncate">→ {first.projectCode}</span>
                        )}
                        {!first.projectId && (
                          <AssignProjectPopover
                            projectFolder={folder}
                            onAssigned={load}
                            label={
                              <span role="button" className="text-[10px] uppercase tracking-wide text-amber-600 shrink-0 underline decoration-dotted hover:text-amber-700">
                                sin proyecto · asignar
                              </span>
                            }
                          />
                        )}
                        <span className="ml-auto text-xs text-muted-foreground shrink-0">
                          {items.length} · {formatBytes(items.reduce((s, f) => s + f.sizeBytes, 0))}
                        </span>
                      </button>
                      <button
                        onClick={() => setShareTarget({ scope: 'project', pathPrefix: folder, label: folder, fileCount: items.length })}
                        className="text-muted-foreground hover:text-primary p-1.5 shrink-0"
                        title="Compartir proyecto con cliente"
                      >
                        <Share2 className="h-4 w-4" />
                      </button>
                    </div>
                    {isOpen && (
                      <div className="px-3 pb-3">
                        <ArchivedFileList files={items} onOpen={fid => navigate(`/archivo/${fid}`)} onShare={setShareTarget} defaultOpen={!!query.trim()} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
      <ArchivedFilePlayerDialog fileId={id ?? null} onClose={() => navigate('/archivo')} />
      <ShareScopeDialog target={shareTarget} onClose={() => setShareTarget(null)} />
    </div>
  );
}
