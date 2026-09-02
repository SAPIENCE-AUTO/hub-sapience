import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useEffect, useState, useRef } from 'react';
import { useAuth } from 'zite-auth-sdk';
import { useProject } from '../context/ProjectContext';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ArrowLeft, Home, Users, Activity, MessageSquare, FileText, ClipboardList, Save, ImagePlus, X, Loader2, DollarSign, Wrench } from 'lucide-react';
import { StatusBadge } from '../components/StatusBadge';
import { ProjectHubLanding } from '../components/project-hub/ProjectHubLanding';
import { ProjectToolsTab } from '../components/project-hub/ProjectToolsTab';
import RecruitmentPage from './RecruitmentPage';
import PMPage from './PMPage';
import ChatPage from './ChatPage';
import ProjectDocuments from '../components/ProjectDocuments';
import ProjectMinutas from '../components/ProjectMinutas';
import ProjectBudgetTab from '../components/pm/ProjectBudgetTab';
import { saveProject, getProjects } from 'zite-endpoints-sdk';
import type { GetProjectsOutputType } from 'zite-endpoints-sdk';
import { uploadFile } from 'zite-file-upload-sdk';
import { toast } from 'sonner';

type Project = GetProjectsOutputType['projects'][0];
type TabId = 'hub' | 'reclutamiento' | 'actividades' | 'presupuesto' | 'chat' | 'documentos' | 'tools';
type PmSection = 'timelines' | 'calendarios';

const ALL_TABS: { id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'reclutamiento', label: 'Reclutamiento', icon: Users },
  { id: 'actividades',   label: 'Actividades',   icon: Activity },
  { id: 'presupuesto',   label: 'Presupuesto',   icon: DollarSign },
  { id: 'chat',          label: 'Chat',           icon: MessageSquare },
  { id: 'documentos',    label: 'Documentos',     icon: FileText },
  { id: 'tools',         label: 'Tools',          icon: Wrench },
];

// Acceso limitado mientras Tools solo tiene el módulo Swipe recién lanzado —
// "de momento" (Sergio, 2026-08-20): se espera abrir a más gente conforme se
// sumen más herramientas.
const TOOLS_ALLOWED_EMAILS = ['sergio@sapience.com.mx', 'luis@sapience.com.mx'];

// `?tab=` en la URL viene de 3 lugares con vocabularios distintos: los links
// de este componente (usan los TabId de arriba), el correo de aprobación de
// deal (approveDeal.ts, manda "presupuesto") y las menciones de tarea/evento
// en el chat (ChatPage.tsx, mandan "timeline"/"calendar" — nunca fueron un
// TabId real, así que hoy caen siempre en Reclutamiento por el fallback de
// "pestaña no encontrada"). Sin `?tab=`, el default es "hub" (la pantalla de
// aterrizaje) en vez de una sección específica.
function resolveInitialTab(tabParam: string | null): { tab: TabId; section: PmSection } {
  if (tabParam === 'timeline') return { tab: 'actividades', section: 'timelines' };
  if (tabParam === 'calendar') return { tab: 'actividades', section: 'calendarios' };
  if (tabParam && ALL_TABS.some(t => t.id === tabParam)) {
    return { tab: tabParam as TabId, section: 'timelines' };
  }
  return { tab: 'hub', section: 'timelines' };
}

export default function ProjectHubPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { selectedProject, setSelectedProject, projects, setProjects, projectsLoading } = useProject();
  const { tab: initialTab, section: initialPmSection } = resolveInitialTab(searchParams.get('tab'));
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);
  const [pmSection, setPmSection] = useState<PmSection>(initialPmSection);
  const [muestraOpen, setMuestraOpen] = useState(false);
  const [muestraText, setMuestraText] = useState('');
  const [muestraImageUrl, setMuestraImageUrl] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [savingMuestra, setSavingMuestra] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [retried, setRetried] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (projectId) setSelectedProject(projectId);
    return () => setSelectedProject(null);
  }, [projectId]);

  const project: Project | null = projects.find(p => p.projectCode === projectId) ?? null;

  // If project not found after loading, retry once (handles newly created projects)
  useEffect(() => {
    if (!projectsLoading && !project && !retried && projectId) {
      setRetried(true);
      getProjects({}).then(data => setProjects(data.projects)).catch(() => {});
    }
  }, [projectsLoading, project, retried, projectId]);
  const isReady = selectedProject === projectId;
  const currentMuestra = (project as any)?.muestra ?? '';
  const currentMuestraImagen = (project as any)?.muestraImagen ?? '';
  const hasMuestra = !!(currentMuestra.trim() || currentMuestraImagen.trim());

  // Permission: can see Presupuesto tab
  const canSeeBudget = !!(
    user?.role === 'Owner' || user?.role === 'Socio' ||
    user?.accessFinanzas === 'Editar' || user?.accessFinanzas === 'Administrar' ||
    ((user?.cotizacionRubros ?? []).length > 0)
  );

  const canSeeTools = !!(user?.email && TOOLS_ALLOWED_EMAILS.includes(user.email));

  const visibleTabs = ALL_TABS.filter(t =>
    (t.id !== 'presupuesto' || canSeeBudget) &&
    (t.id !== 'tools' || canSeeTools),
  );

  // Reset active tab if it's no longer visible (p.ej. se perdió el acceso a Presupuesto)
  useEffect(() => {
    if (activeTab !== 'hub' && !visibleTabs.find(t => t.id === activeTab)) {
      setActiveTab('hub');
    }
  }, [canSeeBudget, canSeeTools]);

  const goToActividades = (section: PmSection) => { setPmSection(section); setActiveTab('actividades'); };

  const openMuestra = () => {
    setMuestraText(currentMuestra);
    setMuestraImageUrl(currentMuestraImagen);
    setMuestraOpen(true);
  };

  const handleImageUpload = async (file: File) => {
    if (!file.type.startsWith('image/')) { toast.error('Solo se permiten imágenes (jpg, png, etc.)'); return; }
    setUploadingImage(true);
    try {
      const { fileUrl } = await uploadFile({ data: file, filename: file.name });
      setMuestraImageUrl(fileUrl);
    } catch { toast.error('Error al subir la imagen'); }
    setUploadingImage(false);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleImageUpload(file);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleImageUpload(file);
  };

  const saveMuestra = async () => {
    if (!project) return;
    setSavingMuestra(true);
    try {
      await saveProject({ id: project.id, projectCode: project.projectCode ?? '', muestra: muestraText, muestraImagen: muestraImageUrl });
      toast.success('Muestra guardada');
      setMuestraOpen(false);
      setProjects(((prev: any[]) => prev.map((p: any) =>
        p.projectCode === projectId ? { ...p, muestra: muestraText, muestraImagen: muestraImageUrl } : p
      )) as any);
    } catch { toast.error('Error al guardar'); }
    setSavingMuestra(false);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Project Header — título + pestañas de sección en la misma fila (antes eran
          dos filas separadas; se aprovecha el espacio en blanco junto al badge
          de estatus para ahorrar una fila completa de alto). */}
      <div className="flex-shrink-0 px-6 py-2.5 bg-card border-b flex items-center gap-3 shadow-xs flex-wrap">
        <Button
          variant="ghost" size="sm"
          className="gap-1.5 text-muted-foreground hover:text-foreground -ml-2 flex-shrink-0"
          onClick={() => navigate('/operacion/proyectos')}
        >
          <ArrowLeft className="w-4 h-4" /> Proyectos
        </Button>
        <div className="h-4 w-px bg-border flex-shrink-0" />

        {activeTab !== 'hub' && (
          <>
            <button
              onClick={() => setActiveTab('hub')}
              title="Inicio del proyecto"
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex-shrink-0"
            >
              <Home className="w-4 h-4" />
            </button>
            <div className="h-4 w-px bg-border flex-shrink-0" />
          </>
        )}

        {projectsLoading ? (
          <div className="flex items-center gap-3">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-4 w-44" />
          </div>
        ) : project ? (
          <>
            <div className="flex items-center gap-3 min-w-0 flex-wrap flex-shrink-0">
              <span className="font-bold text-primary text-sm">{project.projectCode}</span>
              <span className="text-sm text-foreground font-medium truncate max-w-[220px]">{project.fullName}</span>
              {project.client && <span className="text-xs text-muted-foreground hidden sm:inline">· {project.client}</span>}
              <StatusBadge status={project.status} />
            </div>

            {activeTab !== 'hub' && <div className="h-4 w-px bg-border flex-shrink-0 hidden md:block" />}

            {activeTab !== 'hub' && (
            <div className="flex items-center gap-1 flex-wrap">
              {visibleTabs.map(tab => {
                const Icon = tab.icon;
                const active = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors ${
                      active
                        ? 'bg-primary text-white font-semibold shadow-sm'
                        : 'text-muted-foreground font-medium hover:text-foreground hover:bg-muted'
                    }`}
                  >
                    <Icon className={`w-3.5 h-3.5 ${active ? 'text-yellow-400' : ''}`} />
                    {tab.label}
                  </button>
                );
              })}
            </div>
            )}
          </>
        ) : (
          <span className="text-sm text-muted-foreground">Proyecto no encontrado</span>
        )}
      </div>

      {/* Tab Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {!isReady ? (
          <div className="p-6 space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : (
          <>
            {activeTab === 'hub' && projectId && (
              <ProjectHubLanding
                projectCode={projectId}
                canSeeBudget={canSeeBudget}
                onOpenTab={setActiveTab}
                onOpenActividades={goToActividades}
              />
            )}
            {activeTab === 'reclutamiento' && <RecruitmentPage hasMuestra={hasMuestra} onOpenMuestra={openMuestra} />}
            {activeTab === 'actividades'   && <PMPage initialSection={pmSection} />}
            {activeTab === 'presupuesto'   && (
              <div className="h-full overflow-y-auto">
                <ProjectBudgetTab projectCode={projectId ?? ''} />
              </div>
            )}
            {activeTab === 'chat'          && <ChatPage projectOnly projectChannel={projectId} />}
            {activeTab === 'documentos'    && (
              <div className="h-full overflow-y-auto divide-y divide-border">
                <ProjectMinutas projectCode={projectId ?? ''} />
                <ProjectDocuments projectCode={projectId ?? ''} />
              </div>
            )}
            {activeTab === 'tools'         && <ProjectToolsTab projectId={project?.id} />}
          </>
        )}
      </div>

      {/* Muestra Dialog */}
      <Dialog open={muestraOpen} onOpenChange={setMuestraOpen}>
        <DialogContent className="sm:max-w-lg" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-primary" />
              Muestra y criterios de reclutamiento
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Descripción en texto (opcional)</p>
              <Textarea
                className="min-h-[100px] text-sm resize-none"
                placeholder="Ej: 2 grupos de 8 personas. Grupo 1: 18-24 años, beer lovers, mix gender, NSE C+..."
                value={muestraText}
                onChange={e => setMuestraText(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <ImagePlus className="w-3.5 h-3.5" />
                Imagen de la propuesta (opcional) — GPT-4o la leerá directamente
              </p>

              {muestraImageUrl ? (
                <div className="relative rounded-lg overflow-hidden border border-border bg-muted/30 group">
                  <img src={muestraImageUrl} alt="Muestra" className="w-full max-h-56 object-contain" />
                  <button
                    onClick={() => setMuestraImageUrl('')}
                    className="absolute top-2 right-2 p-1 rounded-full bg-card/90 border border-border shadow-sm opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive hover:text-destructive-foreground hover:border-destructive"
                    title="Eliminar imagen"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                  <div className="absolute bottom-0 inset-x-0 px-3 py-1.5 bg-card/80 backdrop-blur-sm border-t border-border/50 flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground truncate">Imagen cargada ✓</span>
                    <button onClick={() => fileInputRef.current?.click()} className="text-[11px] text-primary hover:underline flex-shrink-0 ml-2" disabled={uploadingImage}>
                      Cambiar
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
                  onDragLeave={() => setIsDragOver(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`relative flex flex-col items-center justify-center gap-2 h-32 rounded-lg border-2 border-dashed cursor-pointer transition-colors ${
                    isDragOver ? 'border-primary bg-primary/5' : 'border-border/60 bg-muted/20 hover:border-primary/50 hover:bg-muted/40'
                  }`}
                >
                  {uploadingImage ? (
                    <><Loader2 className="w-6 h-6 text-primary animate-spin" /><p className="text-xs text-muted-foreground">Subiendo imagen...</p></>
                  ) : (
                    <>
                      <ImagePlus className="w-6 h-6 text-muted-foreground/60" />
                      <p className="text-xs text-muted-foreground text-center leading-relaxed">
                        <span className="font-medium text-foreground">Arrastra una imagen</span> o haz clic para seleccionar<br />
                        <span className="text-[11px]">JPG, PNG — máx. 25 MB</span>
                      </p>
                    </>
                  )}
                </div>
              )}
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileInput} />
            </div>

            {(muestraText.trim() || muestraImageUrl) && (
              <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-primary/5 border border-primary/20 text-xs text-muted-foreground">
                <span className="text-primary mt-0.5">✦</span>
                <span>
                  {muestraText.trim() && muestraImageUrl
                    ? 'GPT-4o usará el texto y la imagen para el análisis.'
                    : muestraImageUrl
                    ? 'GPT-4o leerá la imagen para extraer los criterios de la muestra.'
                    : 'GPT-4o usará el texto para el análisis de participantes.'}
                </span>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setMuestraOpen(false)}>Cancelar</Button>
            <Button onClick={saveMuestra} disabled={savingMuestra || uploadingImage} className="gap-1.5">
              {savingMuestra
                ? <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                : <Save className="w-3.5 h-3.5" />
              }
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
