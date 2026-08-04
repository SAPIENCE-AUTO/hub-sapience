import { useState, useEffect, useMemo } from 'react';
import { useAuth } from 'zite-auth-sdk';
import { getProjects, getMultiProjectCostAnalysis } from 'zite-endpoints-sdk';
import type { GetMultiProjectCostAnalysisOutputType, GetProjectsOutputType } from 'zite-endpoints-sdk';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { BarChart2, ChevronDown, RefreshCw, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import CostSummaryCards from '@/components/finance/CostSummaryCards';
import ProjectCostRow from '@/components/finance/ProjectCostRow';
import ProjectSelectorDialog from '@/components/finance/ProjectSelectorDialog';

type Project = GetProjectsOutputType['projects'][0];
type Analysis = GetMultiProjectCostAnalysisOutputType;

const fmt = (v: number) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(v);

function FilterPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 px-3 py-1 rounded-full border text-xs font-medium transition-colors whitespace-nowrap',
        active
          ? 'bg-primary/10 text-primary border-primary/30'
          : 'bg-background text-muted-foreground border-border hover:border-foreground/30 hover:text-foreground'
      )}
    >
      {label}
    </button>
  );
}

export default function ProjectCostsPage() {
  const { user, isLoading: authLoading, loginWithRedirect } = useAuth();
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [selectedStatuses, setSelectedStatuses] = useState<Set<string>>(new Set());
  const [selectedClients, setSelectedClients] = useState<Set<string>>(new Set());
  const [selectedYears, setSelectedYears] = useState<Set<string>>(new Set());
  const [clientSearch, setClientSearch] = useState('');
  const [clientPopoverOpen, setClientPopoverOpen] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) loginWithRedirect({ redirectUrl: window.location.href });
  }, [authLoading, user, loginWithRedirect]);

  useEffect(() => {
    getProjects({ search: '' }).then(r => {
      setAllProjects(r.projects);
      const ids = r.projects.map(p => p.id);
      setSelectedIds(new Set(ids));
      setLoadingProjects(false);
      if (ids.length > 0) runAnalysis(ids);
    });
  }, []);

  const runAnalysis = async (ids: string[], silent = false) => {
    if (ids.length === 0) { toast.warning('Selecciona al menos un proyecto'); return; }
    if (!silent) setLoadingAnalysis(true);
    try {
      const data = await getMultiProjectCostAnalysis({ projectIds: ids });
      setAnalysis(data);
    } catch { toast.error('Error al cargar el análisis'); }
    finally { setLoadingAnalysis(false); }
  };

  const handleDialogConfirm = (ids: Set<string>) => {
    setSelectedIds(ids);
    if (ids.size === 0) {
      setAnalysis(null);
    } else {
      runAnalysis(Array.from(ids));
    }
  };

  const toggleExpand = (id: string) =>
    setExpandedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // Build projectId → { client, year } map from allProjects
  const projectMeta = useMemo(() => {
    const map = new Map<string, { client: string; year: string }>();
    allProjects.forEach(p => {
      const year = p.startDate ? new Date(p.startDate).getFullYear().toString() : '';
      map.set(p.id, { client: p.client ?? '', year });
    });
    return map;
  }, [allProjects]);

  // Unique filter options
  const uniqueStatuses = useMemo(() => {
    if (!analysis) return [];
    const s = new Set<string>();
    analysis.projects.forEach(pa => { if (pa.project.status) s.add(pa.project.status); });
    return Array.from(s).sort();
  }, [analysis]);

  const uniqueClients = useMemo(() => {
    const s = new Set<string>();
    allProjects.forEach(p => { if (p.client) s.add(p.client); });
    return Array.from(s).sort();
  }, [allProjects]);

  const uniqueYears = useMemo(() => {
    const s = new Set<string>();
    allProjects.forEach(p => {
      if (p.startDate) {
        const y = new Date(p.startDate).getFullYear().toString();
        s.add(y);
      }
    });
    return Array.from(s).sort((a, b) => b.localeCompare(a));
  }, [allProjects]);

  const toggleStatus = (s: string) =>
    setSelectedStatuses(prev => { const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n; });

  const toggleClient = (c: string) =>
    setSelectedClients(prev => { const n = new Set(prev); n.has(c) ? n.delete(c) : n.add(c); return n; });

  const toggleYear = (y: string) =>
    setSelectedYears(prev => { const n = new Set(prev); n.has(y) ? n.delete(y) : n.add(y); return n; });

  const clearAllFilters = () => {
    setSearch('');
    setSelectedStatuses(new Set());
    setSelectedClients(new Set());
    setSelectedYears(new Set());
  };

  const hasActiveFilters = search || selectedStatuses.size > 0 || selectedClients.size > 0 || selectedYears.size > 0;

  const filteredClients = useMemo(() =>
    uniqueClients.filter(c => c.toLowerCase().includes(clientSearch.toLowerCase())),
    [uniqueClients, clientSearch]
  );

  if (authLoading || !user) return null;

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Costos por Proyecto</h1>
          <p className="text-muted-foreground text-sm mt-1">Análisis P&L: cotizado vs. vendido vs. gastado por rubro</p>
        </div>
        <div className="flex items-center gap-2 shrink-0 mt-1">
          <ProjectSelectorDialog
            projects={allProjects}
            selectedIds={selectedIds}
            loadingProjects={loadingProjects}
            onConfirm={handleDialogConfirm}
          />
          {analysis && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => runAnalysis(Array.from(selectedIds))}
              disabled={loadingAnalysis || selectedIds.size === 0}
              className="gap-2"
            >
              <RefreshCw className={cn('w-4 h-4', loadingAnalysis && 'animate-spin')} />
              Actualizar
            </Button>
          )}
        </div>
      </div>

      {/* Empty state */}
      {!analysis && !loadingAnalysis && (
        <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
          <BarChart2 className="w-14 h-14 mb-4 opacity-20" />
          <p className="text-base font-medium">Aún no has analizado ningún proyecto</p>
          <p className="text-sm mt-1 opacity-70">Haz clic en &quot;Seleccionar proyectos&quot; para empezar</p>
        </div>
      )}

      {/* Skeleton while loading */}
      {loadingAnalysis && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            {[...Array(7)].map((_, i) => <Skeleton key={i} className="h-24" />)}
          </div>
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      )}

      {/* Results */}
      {analysis && !loadingAnalysis && (() => {
        const q = search.trim().toLowerCase();

        const filtered = analysis.projects.filter(pa => {
          if (q && !(pa.project.fullName?.toLowerCase().includes(q) || pa.deal?.dealName?.toLowerCase().includes(q))) return false;
          if (selectedStatuses.size > 0 && !selectedStatuses.has(pa.project.status ?? '')) return false;
          const meta = projectMeta.get(pa.project.id);
          if (selectedClients.size > 0 && !selectedClients.has(meta?.client ?? '')) return false;
          if (selectedYears.size > 0 && !selectedYears.has(meta?.year ?? '')) return false;
          return true;
        });

        const filteredTotals = filtered.reduce(
          (acc, pa) => ({
            cotizado: acc.cotizado + pa.totals.cotizado,
            costoConMarkup: acc.costoConMarkup + pa.totals.costoConMarkup,
            precioCliente: acc.precioCliente + pa.totals.precioCliente,
            gastado: acc.gastado + pa.totals.gastado,
            markUpInicial: acc.markUpInicial + pa.totals.markUpInicial,
            markUpFinal: acc.markUpFinal + pa.totals.markUpFinal,
          }),
          { cotizado: 0, costoConMarkup: 0, precioCliente: 0, gastado: 0, markUpInicial: 0, markUpFinal: 0 }
        );
        const filteredDiferenciaTotalMxn = filteredTotals.markUpFinal - filteredTotals.markUpInicial;
        const filteredRevenueInicial = filteredTotals.precioCliente > 0
          ? (filteredTotals.markUpInicial / filteredTotals.precioCliente) * 100
          : null;
        const filteredRevenueFinal = filteredTotals.precioCliente > 0
          ? (filteredTotals.markUpFinal / filteredTotals.precioCliente) * 100
          : null;

        const displayTotals = hasActiveFilters
          ? {
              ...filteredTotals,
              diferenciaTotalMxn: filteredDiferenciaTotalMxn,
              revenueInicial: filteredRevenueInicial,
              revenueFinal: filteredRevenueFinal,
            }
          : analysis.grandTotals;

        return (
          <div className="space-y-4">
            <CostSummaryCards totals={displayTotals} hasDeal={displayTotals.precioCliente > 0} />

            {/* Search + Filters bar */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Search */}
              <div className="relative w-56">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder="Buscar proyecto o deal..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-8 pr-8 h-9 text-sm"
                />
                {search && (
                  <button
                    onClick={() => setSearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Separator */}
              <div className="h-7 w-px bg-border" />

              {/* Status pills */}
              {uniqueStatuses.map(s => (
                <FilterPill
                  key={s}
                  label={s}
                  active={selectedStatuses.has(s)}
                  onClick={() => toggleStatus(s)}
                />
              ))}

              {uniqueStatuses.length > 0 && uniqueYears.length > 0 && (
                <div className="h-7 w-px bg-border" />
              )}

              {/* Year pills */}
              {uniqueYears.map(y => (
                <FilterPill
                  key={y}
                  label={y}
                  active={selectedYears.has(y)}
                  onClick={() => toggleYear(y)}
                />
              ))}

              {uniqueYears.length > 0 && (
                <div className="h-7 w-px bg-border" />
              )}

              {/* Client popover */}
              <Popover open={clientPopoverOpen} onOpenChange={setClientPopoverOpen}>
                <PopoverTrigger asChild>
                  <button
                    className={cn(
                      'inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-medium transition-colors whitespace-nowrap',
                      selectedClients.size > 0
                        ? 'bg-primary/10 text-primary border-primary/30'
                        : 'bg-background text-muted-foreground border-border hover:border-foreground/30 hover:text-foreground'
                    )}
                  >
                    {selectedClients.size > 0 ? `${selectedClients.size} cliente${selectedClients.size > 1 ? 's' : ''}` : 'Cliente'}
                    <ChevronDown className="w-3 h-3 opacity-70" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-60 p-0" align="start">
                  <div className="p-2 border-b border-border">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                      <Input
                        placeholder="Buscar cliente..."
                        value={clientSearch}
                        onChange={e => setClientSearch(e.target.value)}
                        className="pl-7 h-7 text-xs"
                      />
                    </div>
                  </div>
                  <div className="max-h-56 overflow-y-auto p-1">
                    {filteredClients.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-4">Sin resultados</p>
                    ) : filteredClients.map(c => (
                      <label
                        key={c}
                        className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer"
                      >
                        <Checkbox
                          checked={selectedClients.has(c)}
                          onCheckedChange={() => toggleClient(c)}
                          className="w-3.5 h-3.5"
                        />
                        <span className="text-xs truncate">{c}</span>
                      </label>
                    ))}
                  </div>
                  {selectedClients.size > 0 && (
                    <div className="border-t border-border p-2">
                      <button
                        onClick={() => setSelectedClients(new Set())}
                        className="text-xs text-muted-foreground hover:text-foreground w-full text-center"
                      >
                        Limpiar selección
                      </button>
                    </div>
                  )}
                </PopoverContent>
              </Popover>

              {/* Clear all */}
              {hasActiveFilters && (
                <button
                  onClick={clearAllFilters}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="w-3 h-3" />
                  Limpiar
                </button>
              )}
            </div>

            <div className="overflow-x-auto overflow-y-auto rounded-lg border border-border max-h-[calc(100vh-380px)]">
              <table className="w-full text-sm min-w-[960px]">
                <thead className="bg-muted text-muted-foreground border-b border-border sticky top-0 z-10">
                  <tr>
                    <th className="w-10" />
                    <th className="px-3 py-3 text-left font-medium">Proyecto</th>
                    <th className="px-3 py-3 text-left font-medium">Deal</th>
                    <th className="px-3 py-3 text-right font-medium">Cotizados</th>
                    <th className="px-3 py-3 text-right font-medium">Mark Up Inicial</th>
                    <th className="px-3 py-3 text-right font-medium">Subtotal Precio</th>
                    <th className="px-3 py-3 text-right font-medium">Precio a cliente (F)</th>
                    <th className="px-3 py-3 text-right font-medium">Costos Reales</th>
                    <th className="px-3 py-3 text-right font-medium">Diferencia Total MXN</th>
                    <th className="px-3 py-3 text-right font-medium">Mark Up Final</th>
                    <th className="px-3 py-3 text-right font-medium">Revenue Inicial %</th>
                    <th className="px-3 py-3 text-right font-medium">Revenue Final %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-card">
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={12} className="px-3 py-10 text-center text-muted-foreground text-sm">
                        No hay proyectos que coincidan con los filtros aplicados
                      </td>
                    </tr>
                  ) : filtered.map(pa => (
                    <ProjectCostRow
                      key={pa.project.id}
                      analysis={pa}
                      dealsList={analysis.dealsList}
                      isExpanded={expandedIds.has(pa.project.id)}
                      onToggle={() => toggleExpand(pa.project.id)}
                      onRefreshAnalysis={() => runAnalysis(Array.from(selectedIds), true)}
                      onDealUpdated={(projectId, deal) => {
                        setAnalysis(prev => {
                          if (!prev) return prev;
                          return {
                            ...prev,
                            projects: prev.projects.map(pa =>
                              pa.project.id === projectId
                                ? { ...pa, deal: deal ? { id: deal.id, dealName: deal.dealName, clientPrice: deal.clientPrice } : null,
                                    totals: { ...pa.totals, precioCliente: deal?.clientPrice ?? 0 } }
                                : pa
                            ),
                          };
                        });
                      }}
                    />
                  ))}
                </tbody>
                <tfoot className="bg-muted border-t-2 border-border font-semibold text-sm sticky bottom-0 z-10">
                  <tr>
                    <td colSpan={3} className="px-3 py-3 text-foreground font-semibold">
                      TOTAL — {filtered.length}{hasActiveFilters ? ` de ${analysis.projects.length}` : ''} proyectos
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">{fmt(filteredTotals.cotizado)}</td>
                    <td className="px-3 py-3 text-right tabular-nums"><span className={filteredTotals.markUpInicial >= 0 ? 'text-emerald-600' : 'text-destructive'}>{fmt(filteredTotals.markUpInicial)}</span></td>
                    <td className="px-3 py-3 text-right tabular-nums">{fmt(filteredTotals.costoConMarkup)}</td>
                    <td className="px-3 py-3 text-right tabular-nums font-semibold">{fmt(filteredTotals.precioCliente)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{fmt(filteredTotals.gastado)}</td>
                    <td className="px-3 py-3 text-right tabular-nums"><span className={filteredDiferenciaTotalMxn >= 0 ? 'text-emerald-600' : 'text-destructive'}>{fmt(filteredDiferenciaTotalMxn)}</span></td>
                    <td className="px-3 py-3 text-right tabular-nums"><span className={filteredTotals.markUpFinal >= 0 ? 'text-emerald-600' : 'text-destructive'}>{fmt(filteredTotals.markUpFinal)}</span></td>
                    <td className="px-3 py-3 text-right">{filteredRevenueInicial !== null ? <span className={filteredRevenueInicial >= 0 ? 'text-emerald-600' : 'text-destructive'}>{filteredRevenueInicial.toFixed(1)}%</span> : <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-3 py-3 text-right">{filteredRevenueFinal !== null ? <span className={filteredRevenueFinal >= 0 ? 'text-emerald-600' : 'text-destructive'}>{filteredRevenueFinal.toFixed(1)}%</span> : <span className="text-muted-foreground">—</span>}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
