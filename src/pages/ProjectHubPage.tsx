import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from 'zite-auth-sdk';
import { useProject } from '../context/ProjectContext';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, Home, Users, Activity, MessageSquare, FileText, DollarSign, Wrench, Landmark } from 'lucide-react';
import { StatusBadge } from '../components/StatusBadge';
import { SharpliIcon } from '../components/SharpliIcon';
import { ProjectHubLanding } from '../components/project-hub/ProjectHubLanding';
import { ProjectToolsTab } from '../components/project-hub/ProjectToolsTab';
import { PestanasProyecto } from '../components/project-hub/PestanasProyecto';
import { FormulariosPanel } from '../components/formularios/FormulariosPanel';
import { MuestraPanel } from '../components/reclutamiento/MuestraPanel';
import { leerMuestra } from '../lib/reclutamiento/muestra';
import { puedeVerFormularios } from '../lib/formularios/acceso';
import { puedeVerGuias } from '../lib/guias/acceso';
import SharpliEmbedTab from '../components/project-hub/SharpliEmbedTab';
import RecruitmentPage, { type ParteReclutamiento } from './RecruitmentPage';
import PMPage from './PMPage';
import ChatPage from './ChatPage';
import ProjectDocuments from '../components/ProjectDocuments';
import ProjectMinutas from '../components/ProjectMinutas';
import MeetingRecordingsSection from '../components/minutas/MeetingRecordingsSection';
import ArchivedFilesSection from '../components/archivo/ArchivedFilesSection';
import ProjectBudgetTab from '../components/pm/ProjectBudgetTab';
import CollectionProcessTab from '../components/cobranza/CollectionProcessTab';
import { getFormularios, getMuestra, getProjects } from 'zite-endpoints-sdk';
import type { GetProjectsOutputType } from 'zite-endpoints-sdk';

type Project = GetProjectsOutputType['projects'][0];
type TabId = 'hub' | 'reclutamiento' | 'actividades' | 'presupuesto' | 'chat' | 'documentos' | 'tools' | 'cobranza' | 'sharpli';
type PmSection = 'timelines' | 'calendarios';

const ALL_TABS: { id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'reclutamiento', label: 'Reclutamiento', icon: Users },
  { id: 'actividades',   label: 'Actividades',   icon: Activity },
  { id: 'presupuesto',   label: 'Presupuesto',   icon: DollarSign },
  { id: 'cobranza',      label: 'Cobranza',       icon: Landmark },
  { id: 'chat',          label: 'Chat',           icon: MessageSquare },
  { id: 'documentos',    label: 'Documentos',     icon: FileText },
  { id: 'tools',         label: 'Tools',          icon: Wrench },
  { id: 'sharpli',       label: 'Sharpli',        icon: SharpliIcon },
];

// Acceso limitado mientras Tools solo tiene el módulo Swipe recién lanzado —
// "de momento" (Sergio, 2026-08-20): se espera abrir a más gente conforme se
// sumen más herramientas. Swipe ya se abrió a cinco personas más (Sergio,
// 2026-10-14); Ejes y Prework siguen solo para quienes tienen todo Tools.
const TOOLS_ALLOWED_EMAILS = ['sergio@sapience.com.mx', 'luis@sapience.com.mx'];
const SWIPE_ALLOWED_EMAILS = [
  'cue@sapience.com.mx', 'pamela.escarela@sapience.com.mx', 'vero.garcia@sapience.com.mx',
  'claudia@sapience.com.mx', 'pamela@sapience.com.mx',
];

// `?tab=` en la URL viene de 3 lugares con vocabularios distintos: los links
// de este componente (usan los TabId de arriba), el correo de aprobación de
// deal (approveDeal.ts, manda "presupuesto") y las menciones de tarea/evento
// en el chat (ChatPage.tsx, mandan "timeline"/"calendar" — nunca fueron un
// TabId real, así que hoy caen siempre en Reclutamiento por el fallback de
// "pestaña no encontrada"). Sin `?tab=`, el default es "hub" (la pantalla de
// aterrizaje) en vez de una sección específica.
function resolveInitialTab(tabParam: string | null): { tab: TabId; section: PmSection } {
  if (tabParam === 'timeline') return { tab: 'actividades', section: 'timelines' };
  // «?tab=filtros» (de cuando Filtros era pestaña aparte) y «?tab=muestra» abren esa parte de Reclutamiento.
  if (tabParam === 'filtros' || tabParam === 'muestra') return { tab: 'reclutamiento', section: 'timelines' };
  if (tabParam === 'calendar') return { tab: 'actividades', section: 'calendarios' };
  if (tabParam && ALL_TABS.some(t => t.id === tabParam)) {
    return { tab: tabParam as TabId, section: 'timelines' };
  }
  return { tab: 'hub', section: 'timelines' };
}

export default function ProjectHubPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, isLoading: authLoading } = useAuth();
  const { selectedProject, setSelectedProject, projects, setProjects, projectsLoading } = useProject();
  const { tab: initialTab, section: initialPmSection } = resolveInitialTab(searchParams.get('tab'));
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);
  const [pmSection, setPmSection] = useState<PmSection>(initialPmSection);
  // Al abrir Reclutamiento, por defecto Participantes (los tableros).
  const [parte, setParte] = useState<ParteReclutamiento>(() => { const t = searchParams.get('tab'); return t === 'filtros' || t === 'muestra' ? t : 'participantes'; });

  // Mantiene la URL en sync con la pestaña activa (?tab=...) — antes solo
  // vivía en estado de React, así que un reload (o compartir el link)
  // siempre regresaba al hub del proyecto sin importar en qué pestaña
  // estuviera parado. resolveInitialTab ya sabe leer estos mismos valores.
  useEffect(() => {
    const next = activeTab === 'hub' ? null
      : activeTab === 'actividades' ? (pmSection === 'calendarios' ? 'calendar' : 'timeline')
      : activeTab === 'reclutamiento' && parte !== 'participantes' ? parte
      : activeTab;
    if ((searchParams.get('tab') ?? null) === next) return;
    setSearchParams(prev => {
      const p = new URLSearchParams(prev);
      if (next) p.set('tab', next); else p.delete('tab');
      return p;
    }, { replace: true });
  }, [activeTab, pmSection, parte]);
  const [retried, setRetried] = useState(false);

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

  // Permission: can see Presupuesto tab
  const canSeeBudget = !!(
    user?.role === 'Owner' || user?.role === 'Socio' ||
    user?.accessFinanzas === 'Editar' || user?.accessFinanzas === 'Administrar' ||
    ((user?.cotizacionRubros ?? []).length > 0)
  );

  const tieneTodoTools = !!(user?.email && TOOLS_ALLOWED_EMAILS.includes(user.email));
  // Quien solo tiene Swipe también ve la pestaña Tools, pero con Swipe nada más.
  const canSeeTools = tieneTodoTools || !!(user?.email && SWIPE_ALLOWED_EMAILS.includes(user.email));

  // Mismo criterio que el resto del módulo de Cobranza (getCollectionProcesses.ts
  // et al.): Owner o purchaseLevel Finanzas, no un gate por role solamente.
  const canSeeCobranza = !!(user?.role === 'Owner' || user?.purchaseLevel === 'Finanzas');

  // Guías de tópicos (dentro de Tools): todo el equipo desde el 2026-10-26 (src/lib/guias/acceso.ts; el candado real es del servidor). Por eso la pestaña Tools la ve
  // quien tiene alguna herramienta: Swipe (canSeeTools) o las guías; `canSeeTools` sigue siendo «tiene Swipe» porque la portada lo usa para su tarjeta de Swipe.
  const canSeeGuias = puedeVerGuias(user?.email);
  const canSeeToolsTab = canSeeTools || canSeeGuias;

  const visibleTabs = ALL_TABS.filter(t =>
    (t.id !== 'presupuesto' || canSeeBudget) &&
    (t.id !== 'tools' || canSeeToolsTab) &&
    (t.id !== 'cobranza' || canSeeCobranza),
  );

  // Reset active tab if it's no longer visible (p.ej. se perdió el acceso a Presupuesto).
  // Ojo: mientras `authLoading` es true, `user` todavía es null y todos los gates de
  // permiso (canSeeBudget/canSeeTools/canSeeCobranza) dan falso — sin este guard, un
  // link directo a "?tab=cobranza"/"?tab=presupuesto" se resetea a "hub" antes de que
  // el usuario real termine de cargar (confirmado en vivo con el link nuevo de Cobranza).
  useEffect(() => {
    if (authLoading) return;
    if (activeTab !== 'hub' && !visibleTabs.find(t => t.id === activeTab)) {
      setActiveTab('hub');
    }
  }, [authLoading, canSeeBudget, canSeeToolsTab, canSeeCobranza]);

  const goToActividades = (section: PmSection) => { setPmSection(section); setActiveTab('actividades'); };

  // Muestra y Filtros viven dentro de Reclutamiento (por ahora solo para quien ve Filtros). El selector dice
  // cuántos lugares de la muestra están cubiertos, si hay un filtro en vivo y cuántas respuestas reales lleva.
  const verFiltros = puedeVerFormularios(user?.email);
  const [resumenFiltros, setResumenFiltros] = useState<{ enVivo: number; respuestas: number } | null>(null);
  const [resumenMuestra, setResumenMuestra] = useState<{ cubiertos: number; lugares: number } | null>(null);
  const [vueltaResumen, setVueltaResumen] = useState(0);
  useEffect(() => {
    if (!verFiltros || !project?.id || activeTab !== 'reclutamiento') return;
    getFormularios({ proyectoId: project.id })
      .then((d: { formularios: { estado: string; respuestasReales: number }[] }) => setResumenFiltros({
        enVivo: d.formularios.filter((f) => f.estado === 'en_vivo').length,
        respuestas: d.formularios.reduce((n, f) => n + f.respuestasReales, 0),
      }))
      .catch(() => setResumenFiltros(null));
    getMuestra({ proyectoId: project.id })
      .then((d: { muestra: { definicion: unknown } | null; avance: Record<string, { total: number }> }) => {
        const acts = d.muestra ? leerMuestra(d.muestra.definicion).actividades : [];
        setResumenMuestra(acts.length ? {
          lugares: acts.reduce((n, a) => n + a.personas, 0),
          cubiertos: acts.reduce((n, a) => n + Math.min(a.personas, a.grupoId ? d.avance[a.grupoId]?.total ?? 0 : 0), 0),
        } : null);
      })
      .catch(() => setResumenMuestra(null));
  }, [verFiltros, project?.id, activeTab, parte, vueltaResumen]);

  return (
    <div className="flex flex-col h-full">
      {/* Project Header — título + pestañas de sección en la misma fila (antes eran
          dos filas separadas; se aprovecha el espacio en blanco junto al badge
          de estatus para ahorrar una fila completa de alto). */}
      <div className="flex-shrink-0 px-6 py-2.5 bg-card border-b flex items-center gap-3 shadow-xs flex-wrap md:flex-nowrap">
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
            <div className="flex items-center gap-3 min-w-0 flex-wrap md:flex-nowrap">
              <span className="font-bold text-primary text-sm whitespace-nowrap">{project.projectCode}</span>
              <span className="text-sm text-foreground font-medium truncate max-w-[220px]">{project.fullName}</span>
              {project.client && <span className="text-xs text-muted-foreground hidden sm:inline">· {project.client}</span>}
              <StatusBadge status={project.status} />
            </div>

            {activeTab !== 'hub' && <div className="h-4 w-px bg-border flex-shrink-0 hidden md:block" />}

            {activeTab !== 'hub' && (
              <PestanasProyecto pestanas={visibleTabs} activa={activeTab} onElegir={(t) => { setActiveTab(t); if (t === 'reclutamiento') setParte('participantes'); }} />
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
                projectId={project?.id}
                canSeeBudget={canSeeBudget}
                canSeeTools={canSeeTools}
                canSeeCobranza={canSeeCobranza}
                client={project?.client}
                onOpenTab={setActiveTab}
                onOpenActividades={goToActividades}
              />
            )}
            {activeTab === 'reclutamiento' && (
              <RecruitmentPage
                partes={verFiltros && project ? {
                  activa: parte,
                  onElegir: setParte,
                  muestra: { resumen: resumenMuestra, contenido: <MuestraPanel proyectoId={project.id} projectCode={project.projectCode ?? ''} onCambio={() => setVueltaResumen((n) => n + 1)} /> },
                  filtros: { resumen: resumenFiltros, contenido: <FormulariosPanel proyectoId={project.id} /> },
                } : undefined}
              />
            )}
            {activeTab === 'actividades'   && <PMPage initialSection={pmSection} onSectionChange={setPmSection} />}
            {activeTab === 'presupuesto'   && (
              <div className="h-full overflow-y-auto">
                <ProjectBudgetTab projectCode={projectId ?? ''} />
              </div>
            )}
            {activeTab === 'cobranza'      && (
              <CollectionProcessTab projectCode={projectId ?? ''} client={project?.client} />
            )}
            {activeTab === 'chat'          && <ChatPage projectOnly projectChannel={projectId} />}
            {activeTab === 'documentos'    && (
              <div className="h-full overflow-y-auto divide-y divide-border">
                {project?.id && (
                  <div className="p-4">
                    <MeetingRecordingsSection projectId={project.id} />
                  </div>
                )}
                <ProjectMinutas projectCode={projectId ?? ''} />
                <ProjectDocuments projectCode={projectId ?? ''} />
                {project?.id && <ArchivedFilesSection projectId={project.id} />}
              </div>
            )}
            {activeTab === 'tools'         && (
              <ProjectToolsTab
                projectId={project?.id}
                soloSwipe={!tieneTodoTools}
                sinSwipe={!canSeeTools}
                conGuias={canSeeGuias}
                proyecto={project?.id ? { id: project.id, projectCode: project.projectCode ?? '', fullName: project.fullName, client: project.client } : undefined}
              />
            )}
            {activeTab === 'sharpli'       && (
              <SharpliEmbedTab
                projectName={project?.fullName ?? project?.projectCode ?? ''}
                brandName={project?.client ?? ''}
              />
            )}
          </>
        )}
      </div>

    </div>
  );
}
