import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { MessageSquare, Globe, Settings2, RotateCcw, Check, X } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { GetRecruitmentDashboardOutputType, GetInvoiceWidgetDataOutputType, saveWidgetLayout } from 'zite-endpoints-sdk';
import ProjectCards from './ProjectCards';
import MyTasks from './MyTasks';
import UpcomingEvents from './UpcomingEvents';
import InvoiceWidget from './InvoiceWidget';
import DraggableWidgetGrid from './DraggableWidgetGrid';
import { buildLayout, LayoutItem, WidgetSize } from './widgetConfig';

type PoCounts = GetRecruitmentDashboardOutputType['poCounts'];
type Mention = GetRecruitmentDashboardOutputType['recentMentions'][0];

const roleColors: Record<string, string> = {
  Owner:       'bg-primary text-primary-foreground',
  Socio:       'bg-purple-100 text-purple-700',
  Head:        'bg-blue-100 text-blue-700',
  'Líder':     'bg-emerald-100 text-emerald-700',
  Coordinador: 'bg-orange-100 text-orange-700',
  Analista:    'bg-sky-100 text-sky-700',
};

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Buenos días';
  if (h < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

function SectionHeading({ label, accentColor }: { label: string; accentColor?: string }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      {accentColor && <span className={`w-2 h-2 rounded-full flex-shrink-0 ${accentColor}`} />}
      <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{label}</h2>
    </div>
  );
}

const PO_STATUSES: { key: keyof Omit<PoCounts, 'total'>; label: string; accent: string }[] = [
  { key: 'borrador',          label: 'Borrador',      accent: 'bg-muted text-muted-foreground border-border' },
  { key: 'enviadaAprobacion', label: 'En aprobación', accent: 'bg-[hsl(var(--chart-3)/0.15)] text-[hsl(var(--chart-3))] border-[hsl(var(--chart-3)/0.3)]' },
  { key: 'aprobada',          label: 'Aprobada',      accent: 'bg-[hsl(var(--chart-2)/0.15)] text-[hsl(var(--chart-2))] border-[hsl(var(--chart-2)/0.3)]' },
  { key: 'devuelta',          label: 'Devuelta',      accent: 'bg-destructive/10 text-destructive border-destructive/20' },
  { key: 'cancelada',         label: 'Cancelada',     accent: 'bg-muted text-muted-foreground border-border' },
];

function POCountCards({ counts, loading }: { counts: PoCounts | undefined; loading: boolean }) {
  const navigate = useNavigate();
  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {PO_STATUSES.map(s => <Skeleton key={s.key} className="h-20 rounded-xl" />)}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {PO_STATUSES.map(({ key, label, accent }) => (
        <button
          key={key}
          onClick={() => navigate('/operacion/compras')}
          className={`flex flex-col items-center justify-center gap-1 rounded-xl border p-4 transition-all hover:scale-[1.03] hover:shadow-md cursor-pointer ${accent}`}
        >
          <span className="text-3xl font-black leading-none">{counts?.[key] ?? 0}</span>
          <span className="text-[11px] font-medium text-center leading-tight">{label}</span>
        </button>
      ))}
    </div>
  );
}

function getInitials(name?: string) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function MentionItem({ mention }: { mention: Mention }) {
  const navigate = useNavigate();
  const timeAgo = mention.sentAt
    ? formatDistanceToNow(new Date(mention.sentAt), { addSuffix: true, locale: es })
    : '';
  return (
    <button
      onClick={() => navigate('/chat')}
      className="w-full text-left flex items-start gap-3 p-3 rounded-lg hover:bg-muted/60 transition-colors"
    >
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[hsl(var(--chart-1)/0.2)] text-[hsl(var(--chart-1))] flex items-center justify-center text-xs font-bold">
        {getInitials(mention.senderName)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold truncate">{mention.senderName ?? mention.senderEmail ?? 'Desconocido'}</span>
          {mention.channel && (
            <span className="text-[11px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full shrink-0">
              # {mention.channel}
            </span>
          )}
          <span className="text-[11px] text-muted-foreground ml-auto shrink-0">{timeAgo}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 leading-relaxed">{mention.content ?? ''}</p>
      </div>
    </button>
  );
}

function MentionsList({ mentions, loading }: { mentions: Mention[]; loading: boolean }) {
  if (loading) return <Skeleton className="h-48 rounded-xl" />;
  if (mentions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground">
        <MessageSquare className="w-8 h-8 opacity-30" />
        <p className="text-sm">Sin menciones recientes</p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
      {mentions.map(m => <MentionItem key={m.id} mention={m} />)}
    </div>
  );
}

interface Props {
  user: {
    firstName?: string;
    role?: string;
    departamento?: string;
    dashboardWidgets?: string[];
    widgetLayout?: string;
  };
  data: GetRecruitmentDashboardOutputType | null;
  loading: boolean;
  invoiceData: GetInvoiceWidgetDataOutputType | null;
  invoiceLoading: boolean;
}

export default function RecruitmentDashboard({ user, data, loading, invoiceData, invoiceLoading }: Props) {
  const [layout, setLayout] = useState<LayoutItem[]>([]);
  const [editing, setEditing] = useState(false);
  const [savedLayoutJson, setSavedLayoutJson] = useState('');
  const [saving, setSaving] = useState(false);
  const [layoutReady, setLayoutReady] = useState(false);

  const firstName = user.firstName?.split(' ')[0] || '';

  // Initialize layout once
  useEffect(() => {
    if (layoutReady) return;
    const initial = buildLayout(user.dashboardWidgets ?? [], user.widgetLayout);
    setLayout(initial);
    setSavedLayoutJson(user.widgetLayout ?? '');
    setLayoutReady(true);
  }, [layoutReady, user.dashboardWidgets, user.widgetLayout]);

  const handleStartEdit = () => {
    setSavedLayoutJson(JSON.stringify(layout));
    setEditing(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveWidgetLayout({ layout: JSON.stringify(layout) });
      setSavedLayoutJson(JSON.stringify(layout));
      setEditing(false);
      toast.success('Layout guardado');
    } catch {
      toast.error('Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setLayout(buildLayout(user.dashboardWidgets ?? [], savedLayoutJson || undefined));
    setEditing(false);
  };

  const handleReset = () => {
    setLayout(buildLayout(user.dashboardWidgets ?? [], undefined));
  };

  const renderWidget = useCallback((id: string, _size: WidgetSize): React.ReactNode => {
    switch (id) {
      case 'purchase_orders':
        return (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <SectionHeading label="Órdenes de compra — Reclutamiento e Incentivos" accentColor="bg-[hsl(var(--chart-3))]" />
              {!loading && data && (
                <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                  {data.poCounts.total} total
                </span>
              )}
            </div>
            <POCountCards counts={data?.poCounts} loading={loading} />
          </div>
        );
      case 'recent_mentions':
        return (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <SectionHeading label="Menciones recientes" accentColor="bg-[hsl(var(--chart-1))]" />
              <MessageSquare className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
            <MentionsList mentions={data?.recentMentions ?? []} loading={loading} />
          </div>
        );
      case 'my_projects':
        return (
          <div className="space-y-2">
            <SectionHeading label="Mis proyectos" accentColor="bg-[hsl(var(--chart-4))]" />
            {loading ? (
              <div className="flex flex-wrap gap-2">
                {[1,2,3,4].map(i => <Skeleton key={i} className="h-7 w-28 rounded-full" />)}
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

  return (
    <div className="p-6 space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-black">
            {getGreeting()}{firstName ? `, ${firstName}` : ''}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Panel de Reclutamiento — órdenes de compra y actividad reciente
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {data?.isGlobal && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted px-2.5 py-1.5 rounded-full">
              <Globe className="w-3 h-3" /> Vista global
            </span>
          )}
          {user.role && (
            <span className={`text-xs px-2.5 py-1.5 rounded-full font-semibold ${roleColors[user.role] ?? 'bg-muted text-muted-foreground'}`}>
              {user.role}
            </span>
          )}
          <span className="text-xs px-2.5 py-1.5 rounded-full font-semibold bg-[hsl(var(--chart-4)/0.15)] text-[hsl(var(--chart-4))]">
            Reclutamiento
          </span>
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
      {layout.length > 0 && (
        <DraggableWidgetGrid
          layout={layout}
          editing={editing}
          onLayoutChange={setLayout}
          renderWidget={renderWidget}
        />
      )}

    </div>
  );
}
