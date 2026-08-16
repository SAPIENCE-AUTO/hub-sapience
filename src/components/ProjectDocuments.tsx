import { useEffect, useState } from 'react';
import { ExternalLink, FileText, RefreshCw, FolderOpen, FileSpreadsheet, Presentation, Image as ImageIcon, File as FileIcon, ChevronDown, MessageSquarePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import TeamsChannelDialog from '@/components/TeamsChannelDialog';
import { getProjectTeamsFiles, GetProjectTeamsFilesOutputType } from 'zite-endpoints-sdk';

type TeamsFile = GetProjectTeamsFilesOutputType['folders'][0]['files'][0];
type TeamsFolder = GetProjectTeamsFilesOutputType['folders'][0];

interface Props {
  projectCode: string;
}

function formatDateTime(iso?: string) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fileIconFor(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['pdf', 'doc', 'docx'].includes(ext)) return FileText;
  if (['xls', 'xlsx', 'csv'].includes(ext)) return FileSpreadsheet;
  if (['ppt', 'pptx'].includes(ext)) return Presentation;
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return ImageIcon;
  return FileIcon;
}

function TeamsFileCard({ file }: { file: TeamsFile }) {
  const Icon = fileIconFor(file.name);
  return (
    <div className="flex items-center gap-3 py-3 px-4 rounded-lg bg-muted/40 hover:bg-muted/70 transition-colors group">
      <Icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground truncate">{file.name}</p>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap text-xs text-muted-foreground">
          {file.modifiedAt && <span>Modificado {formatDateTime(file.modifiedAt)}</span>}
          {file.modifiedBy && <span>· {file.modifiedBy}</span>}
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 flex-shrink-0 text-primary opacity-70 group-hover:opacity-100"
        onClick={() => window.open(file.webUrl, '_blank', 'noopener,noreferrer')}
      >
        <ExternalLink className="w-3.5 h-3.5" />
        <span className="hidden sm:inline text-xs">Abrir</span>
      </Button>
    </div>
  );
}

function TeamsFolderSection({ folder }: { folder: TeamsFolder }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border rounded-xl overflow-hidden border-[#027495]/25">
      <CollapsibleTrigger asChild>
        <button className="w-full flex items-center gap-2.5 px-4 py-2.5 bg-[#0F3D4C] hover:bg-[#0A2F3B] transition-colors text-left">
          <FolderOpen className="w-4 h-4 text-white/80 flex-shrink-0" />
          <span className="text-sm font-semibold text-white">{folder.name}</span>
          <span className="text-xs text-white/60">({folder.files.length})</span>
          <span className="ml-auto text-[11px] text-white/50 uppercase tracking-wide">Teams</span>
          <ChevronDown className={`w-4 h-4 text-white/70 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="p-2">
          {folder.files.length === 0 ? (
            <p className="text-xs text-muted-foreground italic px-2 py-1.5">No hay archivos todavía</p>
          ) : (
            <div className="space-y-1.5">
              {folder.files.map(file => <TeamsFileCard key={file.id} file={file} />)}
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export default function ProjectDocuments({ projectCode }: Props) {
  const [teamsLinked, setTeamsLinked] = useState(false);
  const [teamsFolders, setTeamsFolders] = useState<TeamsFolder[]>([]);
  const [teamsError, setTeamsError] = useState<string | null>(null);
  const [teamsLoading, setTeamsLoading] = useState(true);
  const [teamsDialogOpen, setTeamsDialogOpen] = useState(false);

  const loadTeams = async () => {
    setTeamsLoading(true);
    try {
      const res = await getProjectTeamsFiles({ projectCode });
      setTeamsLinked(res.linked);
      setTeamsFolders(res.folders);
      setTeamsError(res.error ?? null);
    } catch {
      setTeamsError('No se pudo consultar Teams');
    } finally {
      setTeamsLoading(false);
    }
  };

  useEffect(() => { loadTeams(); }, [projectCode]);

  if (teamsLoading) {
    return (
      <div className="p-6 space-y-3 max-w-2xl">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-10 w-full rounded-xl" />
      </div>
    );
  }

  if (teamsLinked && teamsFolders.every(f => f.files.length === 0)) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-12">
        <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
          <FileText className="w-8 h-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold mb-2">Sin documentos aún</h3>
        <p className="text-muted-foreground text-sm max-w-sm">
          Los archivos que subas al canal de Teams de este proyecto aparecerán aquí automáticamente.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl space-y-8">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-foreground">Documentos del proyecto</h2>
        <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={loadTeams}>
          <RefreshCw className="w-3.5 h-3.5" />
          Actualizar
        </Button>
      </div>

      {teamsError && (
        <p className="text-xs text-destructive">No se pudieron leer los archivos de Teams: {teamsError}</p>
      )}
      {teamsLinked && teamsFolders.map(folder => (
        <TeamsFolderSection key={folder.name} folder={folder} />
      ))}
      {!teamsLinked && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed p-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Sin canal de Teams vinculado</p>
            <p className="text-xs text-muted-foreground mt-0.5">Vincúlalo para ver aquí sus carpetas y archivos.</p>
          </div>
          <Button size="sm" className="gap-1.5 flex-shrink-0 bg-[#0F3D4C] hover:bg-[#0A2F3B] text-white" onClick={() => setTeamsDialogOpen(true)}>
            <MessageSquarePlus className="w-3.5 h-3.5" />
            Vincular canal
          </Button>
        </div>
      )}

      <TeamsChannelDialog
        open={teamsDialogOpen}
        onOpenChange={setTeamsDialogOpen}
        project={{ projectCode }}
        onSuccess={loadTeams}
      />
    </div>
  );
}
