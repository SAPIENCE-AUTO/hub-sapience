import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ExternalLink, Loader2, Unlink, Link2, Plus, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import {
  listTeamsChannels, createTeamsChannel, unlinkTeamsChannel,
  ListTeamsChannelsOutputType, GetProjectsOutputType,
} from 'zite-endpoints-sdk';

type Project = GetProjectsOutputType['projects'][0];
type Team = ListTeamsChannelsOutputType['teams'][0];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project | null;
  onSuccess: () => void;
}

export default function TeamsChannelDialog({ open, onOpenChange, project, onSuccess }: Props) {
  const [team, setTeam] = useState<Team | null>(null);
  const [loadingTeams, setLoadingTeams] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [tab, setTab] = useState<'create' | 'link'>('create');

  const [createChannelName, setCreateChannelName] = useState('');
  const [linkChannelId, setLinkChannelId] = useState('');

  const [saving, setSaving] = useState(false);
  const [unlinking, setUnlinking] = useState(false);

  const hasChannel = !!(project?.teamsChannelStatus === 'Listo' && project?.teamsChannelUrl);

  useEffect(() => {
    if (!open) return;
    setCreateChannelName(project?.projectCode ?? '');
    setLinkChannelId('');
    setTab('create');
    setLoadError(false);

    setLoadingTeams(true);
    listTeamsChannels({})
      .then(res => {
        setTeam(res.teams[0] ?? null);
        if (res.teams.length === 0) setLoadError(true);
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoadingTeams(false));
  }, [open, project?.projectCode]);

  const handleConfirm = async () => {
    if (!project || !team) return;
    setSaving(true);
    try {
      if (tab === 'create') {
        if (!createChannelName.trim()) { toast.error('Escribe el nombre del canal'); setSaving(false); return; }
        await createTeamsChannel({
          projectCode: project.projectCode ?? '',
          mode: 'create',
          teamId: team.id,
          channelName: createChannelName.trim(),
        });
        toast.success('¡Canal creado con carpetas — vinculado al proyecto!');
      } else {
        if (!linkChannelId) { toast.error('Selecciona un canal'); setSaving(false); return; }
        const ch = team.channels.find(c => c.id === linkChannelId);
        if (!ch?.webUrl) { toast.error('Este canal no tiene URL disponible'); setSaving(false); return; }
        await createTeamsChannel({ projectCode: project.projectCode ?? '', mode: 'link', channelUrl: ch.webUrl });
        toast.success('Canal vinculado exitosamente');
      }
      onSuccess();
      onOpenChange(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al configurar el canal';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleUnlink = async () => {
    if (!project) return;
    setUnlinking(true);
    try {
      await unlinkTeamsChannel({ projectCode: project.projectCode ?? '' });
      toast.success('Canal desvinculado');
      onSuccess();
      onOpenChange(false);
    } catch {
      toast.error('Error al desvincular el canal');
    } finally {
      setUnlinking(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>Canal de Teams</span>
            {project?.projectCode && (
              <span className="text-xs font-mono bg-muted px-2 py-0.5 rounded-md text-muted-foreground">
                {project.projectCode}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {hasChannel ? (
          /* ── Already linked ── */
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-chart-2/10 border border-chart-2/20">
              <div className="w-8 h-8 rounded-full bg-chart-2/20 flex items-center justify-center flex-shrink-0">
                <Link2 className="w-4 h-4 text-chart-2" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-chart-2">Canal vinculado</p>
                <p className="text-xs text-muted-foreground truncate mt-0.5">{project?.teamsChannelUrl}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <a href={project?.teamsChannelUrl ?? '#'} target="_blank" rel="noopener noreferrer" className="flex-1">
                <Button variant="outline" className="w-full gap-2 text-sm">
                  <ExternalLink className="w-3.5 h-3.5" /> Abrir en Teams
                </Button>
              </a>
              <Button
                variant="ghost"
                onClick={handleUnlink}
                disabled={unlinking}
                className="gap-2 text-sm text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                {unlinking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Unlink className="w-3.5 h-3.5" />}
                Desvincular
              </Button>
            </div>
          </div>
        ) : (
          /* ── No channel yet ── */
          <>
            {loadingTeams ? (
              <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground text-sm">
                <Loader2 className="w-4 h-4 animate-spin" /> Cargando canales de Teams...
              </div>
            ) : loadError || !team ? (
              <div className="flex items-center gap-3 p-4 rounded-lg bg-destructive/5 border border-destructive/20 my-2">
                <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-destructive">No se pudo cargar el equipo de Teams</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Verifica la conexión con Microsoft Teams e intenta de nuevo.</p>
                </div>
              </div>
            ) : (
              <Tabs value={tab} onValueChange={v => setTab(v as 'create' | 'link')} className="py-2">
                <TabsList className="w-full">
                  <TabsTrigger value="create" className="flex-1 gap-1.5">
                    <Plus className="w-3.5 h-3.5" /> Crear nuevo
                  </TabsTrigger>
                  <TabsTrigger value="link" className="flex-1 gap-1.5">
                    <Link2 className="w-3.5 h-3.5" /> Vincular existente
                  </TabsTrigger>
                </TabsList>

                {/* ── Create tab ── */}
                <TabsContent value="create" className="space-y-4 mt-4">
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 border border-border/60">
                    <span className="text-xs text-muted-foreground">Equipo:</span>
                    <span className="text-xs font-semibold">{team.displayName}</span>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Nombre del canal</Label>
                    <Input
                      value={createChannelName}
                      onChange={e => setCreateChannelName(e.target.value)}
                      placeholder={project?.projectCode ?? 'Nombre del canal'}
                      autoFocus
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Se crearán automáticamente las carpetas: PROPUESTA, CALENDARIOS, TIMELINE, ENTREGABLES, MATERIALES, GRABACIONES y GUÍAS.
                  </p>
                </TabsContent>

                {/* ── Link tab ── */}
                <TabsContent value="link" className="space-y-4 mt-4">
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 border border-border/60">
                    <span className="text-xs text-muted-foreground">Equipo:</span>
                    <span className="text-xs font-semibold">{team.displayName}</span>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Canal existente</Label>
                    <Select value={linkChannelId} onValueChange={setLinkChannelId}>
                      <SelectTrigger><SelectValue placeholder="Seleccionar canal…" /></SelectTrigger>
                      <SelectContent>
                        {team.channels.map(ch => (
                          <SelectItem key={ch.id} value={ch.id}>{ch.displayName}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </TabsContent>
              </Tabs>
            )}

            {!loadingTeams && !loadError && team && (
              <DialogFooter>
                <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
                <Button onClick={handleConfirm} disabled={saving} className="gap-2">
                  {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {tab === 'create' ? 'Crear canal' : 'Vincular canal'}
                </Button>
              </DialogFooter>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
