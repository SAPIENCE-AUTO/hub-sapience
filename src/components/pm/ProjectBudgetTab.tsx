import { useState, useEffect, useCallback, Fragment } from 'react';
import { useAuth } from 'zite-auth-sdk';
import { getProjectBudget, linkProjectDeal, GetProjectBudgetOutputType } from 'zite-endpoints-sdk';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { ChevronDown, ChevronUp, User, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import LinkProjectDealDialog from './LinkProjectDealDialog';

// Vincular un proyecto a un deal, y controlar qué rubros/sub-rubros de
// presupuesto son visibles, es exclusivo de Sergio — ver linkProjectDeal.ts,
// que también valida esto del lado del servidor. Este gate de UI es solo
// cosmético.
const LINK_DEAL_ALLOWED_EMAILS = ['sergio@sapience.com.mx'];

type BudgetData = GetProjectBudgetOutputType;
type RubroData = BudgetData['rubros'][0];

function fmtAmt(v: number, currency: string) {
  const sym = currency === 'USD' ? 'USD ' : currency === 'EUR' ? 'EUR ' : '$';
  return `${sym}${v.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Cada entrada guardada es o el nombre del rubro completo ("Reclutamiento e
// incentivos" — todo visible) o "Rubro::LineItemId" (solo esa línea puntual)
// — mismo formato que consume getProjectBudget.ts. Se usa el ID real de la
// línea, NO el texto de subRubro: dos cotizaciones distintas del mismo
// proyecto pueden traer líneas con el mismo subRubro (ej. "Reclutamiento" en
// Cuanti y en Cuali) — togglear por texto las apagaba a todas juntas sin
// querer (bug real visto en RAPIDITO 3).
function subKey(rubro: string, lineItemId: string): string {
  return `${rubro}::${lineItemId}`;
}

function SummaryCard({ label, value, sub }: { label: string; value: string; sub?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 space-y-1 ${sub ? 'bg-muted/30' : 'bg-card'}`}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${sub ? 'text-foreground' : 'text-primary'}`}>{value}</p>
    </div>
  );
}

function RubroBlock({ rubro, currency, canEdit, visible, onToggleWhole, onToggleSub }: {
  rubro: RubroData;
  currency: string;
  canEdit: boolean;
  visible: Set<string>;
  onToggleWhole: (rubro: string, allSubKeys: string[], isCurrentlyOn: boolean) => void;
  onToggleSub: (rubro: string, allSubKeys: string[], key: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const allSubKeys = rubro.lineItems.map(li => subKey(rubro.rubroName, li.id));
  const allOn = visible.has(rubro.rubroName) || (allSubKeys.length > 0 && allSubKeys.every(k => visible.has(k)));

  return (
    <div className="border border-border rounded-xl overflow-hidden bg-card">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setOpen(o => !o); }}
        className="w-full flex items-center gap-3 px-4 py-3.5 bg-muted/20 hover:bg-muted/40 transition-colors text-left cursor-pointer"
      >
        <div className="flex-1 min-w-0">
          <span className="font-semibold text-sm">{rubro.rubroName}</span>
          {rubro.assignedUsers.length > 0 && (
            <div className="flex gap-1 mt-1.5 flex-wrap">
              {rubro.assignedUsers.map(u => (
                <Badge key={u.id} variant="secondary" className="text-[10px] py-0 px-1.5 gap-1 font-normal">
                  <User className="w-2.5 h-2.5" />{u.name}
                </Badge>
              ))}
            </div>
          )}
        </div>
        {canEdit && (
          <span onClick={e => e.stopPropagation()} title="Visible para quien tenga este rubro asignado" className="flex-shrink-0">
            <Switch checked={allOn} onCheckedChange={() => onToggleWhole(rubro.rubroName, allSubKeys, allOn)} />
          </span>
        )}
        <span className="text-sm font-bold text-primary tabular-nums flex-shrink-0">
          {fmtAmt(rubro.subtotalCotizado, currency)}
        </span>
        {open
          ? <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          : <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        }
      </div>

      {open && (
        <div className="overflow-x-auto border-t border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/30 border-b border-border">
                {[...(canEdit ? ['Visible'] : []), 'Sub-rubro', 'Cant.', 'Comp.', 'P. Unitario', 'Total'].map((h, i) => (
                  <th key={h} className={`px-4 py-2 text-xs font-semibold text-muted-foreground ${i > (canEdit ? 1 : 0) ? 'text-right' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(() => {
                const groups = new Map<string, typeof rubro.lineItems>();
                for (const li of rubro.lineItems) {
                  const key = li.cotizacionName || '—';
                  if (!groups.has(key)) groups.set(key, []);
                  groups.get(key)!.push(li);
                }
                const showSubheaders = groups.size > 1;
                const colSpan = canEdit ? 6 : 5;
                return [...groups.entries()].map(([cotName, items]) => (
                  <Fragment key={cotName}>
                    {showSubheaders && (
                      <tr>
                        <td colSpan={colSpan} className="px-4 py-1 text-[10px] font-semibold text-muted-foreground bg-muted/30">
                          {cotName}
                        </td>
                      </tr>
                    )}
                    {items.map(li => {
                      const key = subKey(rubro.rubroName, li.id);
                      const on = visible.has(rubro.rubroName) || visible.has(key);
                      return (
                        <tr key={li.id} className="hover:bg-muted/20 transition-colors">
                          {canEdit && (
                            <td className="px-4 py-2.5">
                              <Switch className="scale-90" checked={on} onCheckedChange={() => onToggleSub(rubro.rubroName, allSubKeys, key)} />
                            </td>
                          )}
                          <td className="px-4 py-2.5 font-medium">{li.subRubro || '—'}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{li.cantidad}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{li.componentes}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{fmtAmt(li.unitCost, currency)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{fmtAmt(li.total, currency)}</td>
                        </tr>
                      );
                    })}
                  </Fragment>
                ));
              })()}
            </tbody>
            <tfoot>
              <tr className="border-t border-border bg-muted/20">
                <td colSpan={canEdit ? 5 : 4} className="px-4 py-2.5 text-xs font-semibold text-right text-muted-foreground">Subtotal</td>
                <td className="px-4 py-2.5 text-right font-bold text-primary tabular-nums">{fmtAmt(rubro.subtotalCotizado, currency)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

export default function ProjectBudgetTab({ projectCode }: { projectCode: string }) {
  const { user } = useAuth();
  const [data, setData] = useState<BudgetData | null>(null);
  const [loading, setLoading] = useState(true);
  // Qué queda visible por rubro/sub-rubro para este proyecto — ver
  // linkProjectDeal.ts. Se guarda solo (sin botón "Guardar") en cuanto Sergio
  // prende/apaga un switch aquí mismo, en la pestaña, en vez de tener que
  // abrir el diálogo de "Vincular a Deal" cada vez.
  const [visible, setVisible] = useState<Set<string>>(new Set());
  const canLinkDeal = !!(user as { email?: string } | null)?.email && LINK_DEAL_ALLOWED_EMAILS.includes((user as { email?: string }).email!);

  const load = useCallback(() => {
    if (!projectCode) return;
    setLoading(true);
    getProjectBudget({ projectCode }).then(d => {
      setData(d);
      // Sin configurar todavía (null) el estado real hoy es "todo visible"
      // para quien tenga el rubro asignado — se siembra el set con cada
      // rubro completo para que los switches arranquen reflejando eso, en
      // vez de arrancar apagados y verse como si ya estuviera todo oculto.
      setVisible(d.visibleBudgetRubros != null ? new Set(d.visibleBudgetRubros) : new Set(d.rubros.map((r: RubroData) => r.rubroName)));
    }).catch(() => {}).finally(() => setLoading(false));
  }, [projectCode]);

  useEffect(() => { load(); }, [load]);

  const persist = async (next: Set<string>) => {
    const prev = visible;
    setVisible(next); // optimista
    try {
      await linkProjectDeal({ projectId: data!.projectId, dealId: data!.dealId, visibleRubros: [...next] });
    } catch (e) {
      setVisible(prev);
      toast.error(e instanceof Error ? e.message : 'No se pudo guardar la visibilidad');
    }
  };

  const toggleWhole = (rubro: string, allSubKeys: string[], isCurrentlyOn: boolean) => {
    const next = new Set(visible);
    next.delete(rubro);
    allSubKeys.forEach(k => next.delete(k));
    if (!isCurrentlyOn) {
      if (allSubKeys.length === 0) next.add(rubro);
      else allSubKeys.forEach(k => next.add(k));
    }
    persist(next);
  };

  const toggleSub = (rubro: string, allSubKeys: string[], key: string) => {
    const next = new Set(visible);
    if (next.has(rubro)) {
      // estaba en modo "todo el rubro" — expandir a granular, todas
      // encendidas menos la que se acaba de tocar.
      next.delete(rubro);
      allSubKeys.forEach(k => { if (k !== key) next.add(k); });
    } else if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    persist(next);
  };

  if (loading) return (
    <div className="p-6 space-y-4 max-w-4xl">
      <div className="grid grid-cols-2 gap-4"><Skeleton className="h-20 rounded-xl" /><Skeleton className="h-20 rounded-xl" /></div>
      {[1, 2, 3].map(i => <Skeleton key={i} className="h-36 rounded-xl" />)}
    </div>
  );

  if (!data || data.rubros.length === 0) return (
    <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
      <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center">
        <Wallet className="w-7 h-7 text-muted-foreground/50" />
      </div>
      <p className="font-semibold text-muted-foreground">Sin presupuesto disponible</p>
      <p className="text-sm text-muted-foreground/70 max-w-xs">
        Este proyecto no tiene cotizaciones incluidas con líneas de presupuesto, o no tienes acceso a ningún rubro.
      </p>
      {canLinkDeal && data?.projectId && (
        <LinkProjectDealDialog projectId={data.projectId} currentDealId={data.dealId} onLinked={load} />
      )}
    </div>
  );

  const { currency, rubros, totals, canSeeAll, projectId, dealId } = data;

  return (
    <div className="p-6 space-y-5 max-w-4xl">
      {canLinkDeal && projectId && (
        <div className="flex justify-end">
          <LinkProjectDealDialog projectId={projectId} currentDealId={dealId} onLinked={load} />
        </div>
      )}

      {canSeeAll && (
        <div className="grid grid-cols-2 gap-4">
          <SummaryCard label="Presupuesto cotizado (sin markup)" value={fmtAmt(totals.cotizado, currency)} />
          <SummaryCard label="Total con markup" value={fmtAmt(totals.conMarkup, currency)} sub />
        </div>
      )}

      <div className="space-y-3">
        {rubros.map(rubro => (
          <RubroBlock
            key={rubro.rubroName}
            rubro={rubro}
            currency={currency}
            canEdit={canLinkDeal}
            visible={visible}
            onToggleWhole={toggleWhole}
            onToggleSub={toggleSub}
          />
        ))}
      </div>
    </div>
  );
}
