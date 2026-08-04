import { useState } from 'react';
import { ChevronRight, Link2, Unlink, RefreshCw, BarChart2, TableIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { linkProjectDeal } from 'zite-endpoints-sdk';
import type { GetMultiProjectCostAnalysisOutputType } from 'zite-endpoints-sdk';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import CostPnLTable from './CostPnLTable';
import CostRubroChart from './CostRubroChart';

type ProjectAnalysis = GetMultiProjectCostAnalysisOutputType['projects'][0];
type DealItem = GetMultiProjectCostAnalysisOutputType['dealsList'][0];

const fmt = (v: number) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(v);

function Num({ v, pct = false }: { v: number | null; pct?: boolean }) {
  if (v === null) return <span className="text-muted-foreground">—</span>;
  const pos = v >= 0;
  return (
    <span className={cn('font-medium tabular-nums', pos ? 'text-emerald-600' : 'text-destructive')}>
      {pct ? `${v.toFixed(1)}%` : fmt(v)}
    </span>
  );
}

interface Props {
  analysis: ProjectAnalysis;
  dealsList: DealItem[];
  isExpanded: boolean;
  onToggle: () => void;
  onDealUpdated: (projectId: string, deal: DealItem | null) => void;
  onRefreshAnalysis: () => void;
}

export default function ProjectCostRow({ analysis, dealsList, isExpanded, onToggle, onDealUpdated, onRefreshAnalysis }: Props) {
  const { project, deal, totals } = analysis;
  const [editingDeal, setEditingDeal] = useState(false);
  const [pendingDealId, setPendingDealId] = useState('');
  const [saving, setSaving] = useState(false);

  const saveDeal = async (dealId?: string) => {
    const matchedDeal = dealId ? (dealsList.find(d => d.id === dealId) ?? null) : null;
    // Optimistic update — update UI immediately
    onDealUpdated(project.id, matchedDeal);
    setEditingDeal(false);
    toast.success(dealId ? 'Deal vinculado' : 'Deal desvinculado');
    // Persist in background
    setSaving(true);
    try {
      await linkProjectDeal({ projectId: project.id, dealId });
      onRefreshAnalysis();
    } catch {
      toast.error('Error al guardar — recarga para ver el estado real');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {/* ── Summary row ── */}
      <tr className="hover:bg-muted/30 cursor-pointer border-b border-border transition-colors" onClick={onToggle}>
        <td className="px-3 py-3 text-center">
          <ChevronRight className={cn('w-4 h-4 text-muted-foreground transition-transform duration-200', isExpanded && 'rotate-90')} />
        </td>
        <td className="px-3 py-3">
          <span className="font-mono text-xs text-muted-foreground block">{project.projectCode}</span>
          {project.fullName && <span className="text-sm font-medium text-foreground leading-tight">{project.fullName}</span>}
        </td>
        <td className="px-3 py-3">
          {deal
            ? <span className="text-sm text-foreground truncate max-w-[10rem] block">{deal.dealName}</span>
            : <Badge variant="outline" className="text-xs text-muted-foreground font-normal">Sin deal</Badge>}
        </td>
        <td className="px-3 py-3 text-right text-sm text-muted-foreground tabular-nums">{fmt(totals.cotizado)}</td>
        <td className="px-3 py-3 text-right text-sm"><Num v={totals.markUpInicial} /></td>
        <td className="px-3 py-3 text-right text-sm tabular-nums">{fmt(totals.costoConMarkup)}</td>
        <td className="px-3 py-3 text-right text-sm tabular-nums font-medium">{fmt(totals.precioCliente)}</td>
        <td className="px-3 py-3 text-right text-sm tabular-nums">{fmt(totals.gastado)}</td>
        <td className="px-3 py-3 text-right text-sm"><Num v={totals.diferenciaTotalMxn} /></td>
        <td className="px-3 py-3 text-right text-sm"><Num v={totals.markUpFinal} /></td>
        <td className="px-3 py-3 text-right text-sm"><Num v={totals.revenueInicial} pct /></td>
        <td className="px-3 py-3 text-right text-sm"><Num v={totals.revenueFinal} pct /></td>
      </tr>

      {/* ── Expanded detail ── */}
      {isExpanded && (
        <tr className="bg-muted/10 border-b border-border">
          <td colSpan={11} className="px-6 py-5">
            <div className="space-y-4">
              {/* Deal linker */}
              <div className="flex flex-wrap items-center gap-3 bg-card border border-border rounded-lg px-4 py-3" onClick={e => e.stopPropagation()}>
                <Link2 className="w-4 h-4 text-muted-foreground shrink-0" />
                {!editingDeal ? (
                  <>
                    {deal ? (
                      <>
                        <span className="text-sm text-muted-foreground">Deal:</span>
                        <span className="text-sm font-semibold">{deal.dealName}</span>
                        {deal.clientPrice && <Badge variant="secondary" className="text-xs">{fmt(deal.clientPrice)}</Badge>}
                        <div className="flex gap-2 ml-auto">
                          <Button size="sm" variant="outline" onClick={() => { setEditingDeal(true); setPendingDealId(deal.id); }}>
                            <RefreshCw className="w-3 h-3 mr-1" />Cambiar
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => saveDeal()} disabled={saving}>
                            <Unlink className="w-3 h-3 mr-1" />Desvincular
                          </Button>
                        </div>
                      </>
                    ) : (
                      <>
                        <span className="text-sm text-muted-foreground">Sin deal vinculado</span>
                        <Button size="sm" className="ml-auto" onClick={() => { setEditingDeal(true); setPendingDealId(''); }}>
                          <Link2 className="w-3 h-3 mr-1" />Vincular Deal
                        </Button>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <span className="text-sm font-medium">Seleccionar deal:</span>
                    <Select value={pendingDealId} onValueChange={setPendingDealId}>
                      <SelectTrigger className="w-72 h-8 text-sm"><SelectValue placeholder="Busca un deal..." /></SelectTrigger>
                      <SelectContent>
                        {dealsList.map(d => <SelectItem key={d.id} value={d.id}>{d.dealName}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button size="sm" onClick={() => saveDeal(pendingDealId)} disabled={saving || !pendingDealId}>Guardar</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingDeal(false)}>Cancelar</Button>
                  </>
                )}
              </div>

              {/* P&L detail */}
              <Tabs defaultValue="tabla">
                <TabsList>
                  <TabsTrigger value="tabla" className="gap-1.5"><TableIcon className="w-3.5 h-3.5" />Tabla P&L</TabsTrigger>
                  <TabsTrigger value="grafico" className="gap-1.5"><BarChart2 className="w-3.5 h-3.5" />Gráfico</TabsTrigger>
                </TabsList>
                <TabsContent value="tabla" className="mt-3">
                  <CostPnLTable byRubro={analysis.byRubro} totals={analysis.totals} />
                </TabsContent>
                <TabsContent value="grafico" className="mt-3 bg-card border border-border rounded-lg p-4">
                  <CostRubroChart byRubro={analysis.byRubro} />
                </TabsContent>
              </Tabs>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
