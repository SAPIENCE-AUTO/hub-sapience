import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from 'zite-auth-sdk';
import {
  getDashboardData, GetDashboardDataOutputType,
  getRecruitmentDashboard, GetRecruitmentDashboardOutputType,
  getInvoiceWidgetData, GetInvoiceWidgetDataOutputType,
  saveWidgetLayout,
} from 'zite-endpoints-sdk';
import { useProject } from '../context/ProjectContext';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Globe, Settings2, RotateCcw, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import ProjectCards from '../components/dashboard/ProjectCards';
import MyTasks from '../components/dashboard/MyTasks';
import UpcomingEvents from '../components/dashboard/UpcomingEvents';
import RecruitmentDashboard from '../components/dashboard/RecruitmentDashboard';
import InvoiceWidget from '../components/dashboard/InvoiceWidget';
import DraggableWidgetGrid from '../components/dashboard/DraggableWidgetGrid';
import { buildLayout, LayoutItem, WidgetSize } from '../components/dashboard/widgetConfig';

type DashData = GetDashboardDataOutputType;
type RecruitData = GetRecruitmentDashboardOutputType;
type InvoiceData = GetInvoiceWidgetDataOutputType;

// Widgets available in the standard (non-recruitment) dashboard
const NORMAL_WIDGET_IDS = new Set(['my_projects', 'my_tasks', 'upcoming_events', 'received_invoices']);

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Buenos días';
  if (h < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

const roleColors: Record<string, string> = {
  Owner:        'bg-primary text-primary-foreground',
  Socio:        'bg-purple-100 text-purple-700',
  Head:         'bg-blue-100 text-blue-700',
  'Líder':      'bg-emerald-100 text-emerald-700',
  Coordinador:  'bg-orange-100 text-orange-700',
  Analista:     'bg-sky-100 text-sky-700',
};

function SectionHeading({ label, accentColor }: { label: string; accentColor?: string }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      {accentColor && <span className={`w-2 h-2 rounded-full flex-shrink-0 ${accentColor}`} />}
      <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{label}</h2>
    </div>
  );
}

export default function DashboardPage() {
  const { user, isLoading: authLoading } = useAuth();
  const { setSelectedProject } = useProject();
  const [data, setData] = useState<DashData | null>(null);
  const [recruitData, setRecruitData] = useState<RecruitData | null>(null);
  const [invoiceData, setInvoiceData] = useState<InvoiceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [invoiceLoading, setInvoiceLoading] = useState(false);

  const [widgetLayout, setWidgetLayout] = useState<LayoutItem[]>([]);
  const [editing, setEditing] = useState(false);
  const [savedLayoutJson, setSavedLayoutJson] = useState('');
  const [saving, setSaving] = useState(false);
  const [layoutReady, setLayoutReady] = useState(false);

  const isRecruitment = user?.departamento === 'Reclutamiento';
  const dashboardInFlightRef = useRef(false);

  useEffect(() => { setSelectedProject(null); }, []);

  // Initialize layout once when user is available
  useEffect(() => {
    if (authLoading || !user || layoutReady) return;
    const savedJson = (user as any).widgetLayout as string | undefined;
    const initial = buildLayout(user.dashboardWidgets ?? [], savedJson)
      .filter(item => NORMAL_WIDGET_IDS.has(item.id));
    setWidgetLayout(initial);
    setSavedLayoutJson(savedJson ?? '');
    setLayoutReady(true);
  }, [user, authLoading, layoutReady]);

  // Fetch main dashboard data — depend on user.id + isRecruitment (not full user object)
  // to avoid re-triggering when unrelated user fields change (prevents rate-limit errors)
  useEffect(() => {
    if (authLoading || !user?.id) return;
    setLoading(true);
    if (isRecruitment) {
      getRecruitmentDashboard({}).then(setRecruitData).catch(console.error).finally(() => setLoading(false));
    } else {
      if (dashboardInFlightRef.current) {
        console.log('[DashboardPage] getDashboardData skipped: in-flight');
        return;
      }
      dashboardInFlightRef.current = true;
      const fetchWithRetry = async (attempt = 0): Promise<void> => {
        console.log('[DashboardPage] getDashboardData attempt', { attempt });
        try {
          const result = await getDashboardData({});
          setData(result);
        } catch (e: any) {
          const msg = (e?.message ?? '').toLowerCase();
          const isRetryable = msg.includes('too many requests') || msg.includes('bad gateway') || msg.includes('timeout') || msg.includes('worker timeout');
          if (attempt < 4 && isRetryable) {
            const isBadGatewayOrTimeout = msg.includes('bad gateway') || msg.includes('timeout');
            const delayMs = isBadGatewayOrTimeout ? 6000 * (attempt + 1) : 4000 * (attempt + 1);
            console.warn('[DashboardPage] getDashboardData retry', { attempt, delayMs, errorMsg: msg });
            await new Promise(r => setTimeout(r, delayMs));
            return fetchWithRetry(attempt + 1);
          }
          console.error('[DashboardPage] getDashboardData failed after retries', e);
        }
      };
      fetchWithRetry().finally(() => {
        dashboardInFlightRef.current = false;
        setLoading(false);
      });
    }
  }, [user?.id, authLoading, isRecruitment]);

  // Fetch invoice data — un pequeño margen (no 3s: getDashboardData ya no
  // serializa su Fase 2/3 en el backend, así que el burst real es mucho
  // menor que cuando se puso este retraso) para no arrancar en el mismo
  // instante que getDashboardData.
  useEffect(() => {
    if (authLoading || !user?.id) return;
    const widgets = user.dashboardWidgets ?? [];
    const showAll = widgets.length === 0;
    if (!showAll && !widgets.includes('Facturas recibidas')) return;
    setInvoiceLoading(true);
    const timer = setTimeout(() => {
      getInvoiceWidgetData({}).then(setInvoiceData).catch(console.error).finally(() => setInvoiceLoading(false));
    }, 800);
    return () => clearTimeout(timer);
  }, [user?.id, authLoading]);

  const handleStartEdit = () => {
    setSavedLayoutJson(JSON.stringify(widgetLayout));
    setEditing(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveWidgetLayout({ layout: JSON.stringify(widgetLayout) });
      setSavedLayoutJson(JSON.stringify(widgetLayout));
      setEditing(false);
      toast.success('Layout guardado');
    } catch {
      toast.error('Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    const restored = buildLayout(user?.dashboardWidgets ?? [], savedLayoutJson || undefined)
      .filter(item => NORMAL_WIDGET_IDS.has(item.id));
    setWidgetLayout(restored);
    setEditing(false);
  };

  const handleReset = () => {
    setWidgetLayout(
      buildLayout(user?.dashboardWidgets ?? [], undefined)
        .filter(item => NORMAL_WIDGET_IDS.has(item.id))
    );
  };

  const renderWidget = useCallback((id: string, _size: WidgetSize): React.ReactNode => {
    switch (id) {
      case 'my_projects':
        return (
          <div className="space-y-2">
            <SectionHeading label="Mis proyectos" accentColor="bg-[hsl(var(--chart-4))]" />
            {loading ? (
              <div className="flex flex-wrap gap-2">
                {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-7 w-28 rounded-full" />)}
              </div>
            ) : (
              <ProjectCards projects={data?.myProjects ?? []} />
            )}
          </div>
        );
      case 'my_tasks':
        return (
          <div className="space-y-2">
            <SectionHeading label="Mis tareas" accentColor="bg-primary" />
            {loading ? <Skeleton className="h-56 rounded-xl" /> : <MyTasks tasks={data?.myTasks ?? []} />}
          </div>
        );
      case 'upcoming_events':
        return (
          <div className="space-y-2">
            <SectionHeading label="Próximos eventos" accentColor="bg-secondary" />
            {loading ? <Skeleton className="h-56 rounded-xl" /> : <UpcomingEvents events={data?.upcomingEvents ?? []} />}
          </div>
        );
      case 'received_invoices':
        return (
          <div className="space-y-2">
            <SectionHeading label="Facturas recibidas" accentColor="bg-[hsl(var(--chart-5))]" />
            <InvoiceWidget data={invoiceData} loading={invoiceLoading} />
          </div>
        );
      default:
        return null;
    }
  }, [data, loading, invoiceData, invoiceLoading]);

  if (isRecruitment) {
    return (
      <RecruitmentDashboard
        user={{
          firstName: user?.firstName,
          role: user?.role,
          departamento: user?.departamento,
          dashboardWidgets: user?.dashboardWidgets,
          widgetLayout: (user as any).widgetLayout,
        }}
        data={recruitData}
        loading={loading}
        invoiceData={invoiceData}
        invoiceLoading={invoiceLoading}
      />
    );
  }

  const firstName = user?.firstName?.split(' ')[0] || '';

  return (
    <div className="p-6 space-y-6">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-black">
            {getGreeting()}{firstName ? `, ${firstName}` : ''}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {data?.isGlobal ? 'Vista global — todos los proyectos y tareas' : 'Tus proyectos, tareas y actividades'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {data?.isGlobal && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted px-2.5 py-1.5 rounded-full">
              <Globe className="w-3 h-3" /> Vista global
            </span>
          )}
          {user?.role && (
            <span className={`text-xs px-2.5 py-1.5 rounded-full font-semibold ${roleColors[user.role] ?? 'bg-muted text-muted-foreground'}`}>
              {user.role}
            </span>
          )}
          {/* Personalization controls */}
          {!editing ? (
            <button
              onClick={handleStartEdit}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground bg-muted hover:bg-muted/70 px-2.5 py-1.5 rounded-full transition-colors"
            >
              <Settings2 className="w-3 h-3" />
              Personalizar
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={handleReset}>
                <RotateCcw className="w-3 h-3" /> Resetear
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={handleCancel}>
                <X className="w-3 h-3" /> Cancelar
              </Button>
              <Button size="sm" className="h-7 text-xs gap-1" onClick={handleSave} disabled={saving}>
                <Check className="w-3 h-3" />
                {saving ? 'Guardando...' : 'Guardar'}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Edit mode hint banner */}
      {editing && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-primary/5 border border-primary/20 rounded-xl text-xs text-primary">
          <Settings2 className="w-3.5 h-3.5 flex-shrink-0" />
          <span>
            Arrastra los widgets para reordenarlos • Usa <strong>Ampliar/Reducir</strong> para cambiar el ancho
          </span>
        </div>
      )}

      {/* Widget grid */}
      {widgetLayout.length > 0 && (
        <DraggableWidgetGrid
          layout={widgetLayout}
          editing={editing}
          onLayoutChange={setWidgetLayout}
          renderWidget={renderWidget}
        />
      )}

    </div>
  );
}
