import { useState, useEffect, useMemo } from 'react';
import { useAuth } from 'zite-auth-sdk';
import { getDeals, getCommercialViews, saveCommercialView, backfillExchangeRates, GetDealsOutputType, GetCommercialViewsOutputType } from 'zite-endpoints-sdk';
import { BarChart2, Printer, RefreshCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { DashboardFilters, DateReference, WidgetConfig, SavedView } from '@/lib/commercial-dashboard/types';
import { DEFAULT_FILTERS, DEFAULT_DATE_REFERENCE, DEFAULT_WIDGETS } from '@/lib/commercial-dashboard/constants';
import { applyFilters } from '@/lib/commercial-dashboard/filters';
import KpiCardsRow from '@/components/commercial-dashboard/KpiCardsRow';
import CommercialDashboardFilters from '@/components/commercial-dashboard/CommercialDashboardFilters';
import DashboardWidgetGrid from '@/components/commercial-dashboard/DashboardWidgetGrid';
import SavedViewsDropdown from '@/components/commercial-dashboard/SavedViewsDropdown';

type Deal = GetDealsOutputType['deals'][0];
type ViewOut = GetCommercialViewsOutputType['views'][0];

function toSavedView(v: ViewOut): SavedView {
  return { dbId: v.dbId, viewId: v.viewId, viewName: v.viewName, isDefault: v.isDefault, isShared: v.isShared, filtersJson: v.filtersJson, widgetsJson: v.widgetsJson, dateReference: v.dateReference as DateReference, sortOrder: v.sortOrder };
}

function parseWidgets(json: string): WidgetConfig[] {
  try { const p = JSON.parse(json); if (Array.isArray(p)) return p; } catch {}
  return DEFAULT_WIDGETS;
}

function parseFilters(json: string): DashboardFilters {
  try { const p = JSON.parse(json); if (p && typeof p === 'object') return { ...DEFAULT_FILTERS, ...p }; } catch {}
  return DEFAULT_FILTERS;
}

export default function CommercialDashboardPage() {
  const { user, isLoading: authLoading, loginWithRedirect } = useAuth();
  const [deals, setDeals] = useState<Deal[]>([]);
  const [views, setViews] = useState<SavedView[]>([]);
  const [loading, setLoading] = useState(true);
  const [backfilling, setBackfilling] = useState(false);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [filters, setFilters] = useState<DashboardFilters>(DEFAULT_FILTERS);
  const [dateRef, setDateRef] = useState<DateReference>(DEFAULT_DATE_REFERENCE);
  const [widgets, setWidgets] = useState<WidgetConfig[]>(DEFAULT_WIDGETS);

  useEffect(() => {
    if (!authLoading && !user) loginWithRedirect({ redirectUrl: window.location.href });
    if (!authLoading && user) loadData();
  }, [authLoading, user]);

  async function runBackfill(silent = false) {
    setBackfilling(true);
    try {
      const res = await backfillExchangeRates({});
      if (res.updated > 0) {
        const refreshed = await getDeals({});
        setDeals(refreshed.deals);
        if (!silent) toast.success(`✓ Tipos de cambio actualizados (${res.updated} deals)`);
      } else if (!silent) {
        toast.info('Todos los deals ya tienen tipo de cambio');
      }
    } catch {
      if (!silent) toast.error('Error al actualizar tipos de cambio');
    } finally {
      setBackfilling(false);
    }
  }

  async function loadData() {
    setLoading(true);
    try {
      const [d, v] = await Promise.all([getDeals({}), getCommercialViews({})]);
      setDeals(d.deals);
      const parsed = v.views.map(toSavedView);
      setViews(parsed);
      const def = parsed.find(x => x.isDefault) ?? parsed[0] ?? null;
      if (def) applyView(def);

      // Auto-backfill if there are USD deals missing exchangeRate
      const hasMissing = d.deals.some(deal => deal.currency?.includes('USD') && !deal.exchangeRate);
      if (hasMissing) {
        // Run silently in background
        setTimeout(() => runBackfill(true), 100);
      }
    } catch { toast.error('Error al cargar el dashboard'); }
    finally { setLoading(false); }
  }

  async function saveCurrentView() {
    const activeView = views.find(v => v.viewId === activeViewId);
    if (!activeView) { toast.info('Selecciona una vista para guardar'); return; }
    try {
      await saveCommercialView({
        viewId: activeView.viewId,
        viewName: activeView.viewName,
        filtersJson: JSON.stringify(filters),
        widgetsJson: JSON.stringify(widgets),
        dateReference: dateRef,
        isDefault: activeView.isDefault,
        isShared: activeView.isShared,
        sortOrder: activeView.sortOrder,
      });
      setViews(vs => vs.map(v => v.viewId === activeView.viewId
        ? { ...v, filtersJson: JSON.stringify(filters), widgetsJson: JSON.stringify(widgets), dateReference: dateRef }
        : v
      ));
      toast.success('Vista guardada');
    } catch { toast.error('Error al guardar la vista'); }
  }

  function applyView(v: SavedView) {
    setActiveViewId(v.viewId);
    setFilters(parseFilters(v.filtersJson));
    setDateRef(v.dateReference);
    setWidgets(parseWidgets(v.widgetsJson));
  }

  const filteredDeals = useMemo(() => applyFilters(deals, filters, dateRef), [deals, filters, dateRef]);

  if (authLoading || (loading && !deals.length)) {
    return (
      <div className="p-6 space-y-5">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
        <div className="grid grid-cols-2 gap-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-64 rounded-xl" />)}</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5 print:p-3">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <BarChart2 className="w-5 h-5 text-primary" /> Dashboard Comercial
          </h2>
          <p className="text-sm text-muted-foreground">
            {filteredDeals.length} de {deals.length} deals · {filteredDeals.filter(d => d.phase === 'Ganado').length} ganados
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap print:hidden">
          <SavedViewsDropdown
            views={views} activeViewId={activeViewId}
            currentFiltersJson={JSON.stringify(filters)}
            currentWidgetsJson={JSON.stringify(widgets)}
            currentDateRef={dateRef}
            onSelectView={applyView}
            onViewsChange={setViews}
          />
          <Button variant="ghost" size="sm" className="gap-1.5" disabled={backfilling} onClick={() => runBackfill(false)}>
            <RefreshCcw className={`w-4 h-4 ${backfilling ? 'animate-spin' : ''}`} /> Actualizar TC
          </Button>
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => window.print()}>
            <Printer className="w-4 h-4" /> Imprimir
          </Button>
        </div>
      </div>

      <div className="print:hidden">
        <CommercialDashboardFilters filters={filters} dateRef={dateRef} deals={deals} onFiltersChange={setFilters} onDateRefChange={setDateRef} />
      </div>

      <KpiCardsRow allDeals={deals} filters={filters} dateRef={dateRef} />

      <DashboardWidgetGrid widgets={widgets} deals={filteredDeals} dateRef={dateRef} onWidgetsChange={setWidgets} onSaveRequested={saveCurrentView} />
    </div>
  );
}
