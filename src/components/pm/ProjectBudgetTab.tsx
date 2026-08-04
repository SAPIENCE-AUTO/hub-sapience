import { useState, useEffect } from 'react';
import { getProjectBudget, GetProjectBudgetOutputType } from 'zite-endpoints-sdk';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronDown, ChevronUp, User, Wallet } from 'lucide-react';

type BudgetData = GetProjectBudgetOutputType;
type RubroData = BudgetData['rubros'][0];

function fmtAmt(v: number, currency: string) {
  const sym = currency === 'USD' ? 'USD ' : currency === 'EUR' ? 'EUR ' : '$';
  return `${sym}${v.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function SummaryCard({ label, value, sub }: { label: string; value: string; sub?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 space-y-1 ${sub ? 'bg-muted/30' : 'bg-card'}`}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${sub ? 'text-foreground' : 'text-primary'}`}>{value}</p>
    </div>
  );
}

function RubroBlock({ rubro, currency }: { rubro: RubroData; currency: string }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border border-border rounded-xl overflow-hidden bg-card">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3.5 bg-muted/20 hover:bg-muted/40 transition-colors text-left"
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
        <span className="text-sm font-bold text-primary tabular-nums flex-shrink-0">
          {fmtAmt(rubro.subtotalCotizado, currency)}
        </span>
        {open
          ? <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          : <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        }
      </button>

      {open && (
        <div className="overflow-x-auto border-t border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/30 border-b border-border">
                {['Sub-rubro', 'Cant.', 'Comp.', 'P. Unitario', 'Total'].map((h, i) => (
                  <th key={h} className={`px-4 py-2 text-xs font-semibold text-muted-foreground ${i > 0 ? 'text-right' : 'text-left'}`}>{h}</th>
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
                return [...groups.entries()].map(([cotName, items]) => (
                  <>
                    {showSubheaders && (
                      <tr key={`hdr-${cotName}`}>
                        <td colSpan={5} className="px-4 py-1 text-[10px] font-semibold text-muted-foreground bg-muted/30">
                          {cotName}
                        </td>
                      </tr>
                    )}
                    {items.map(li => (
                      <tr key={li.id} className="hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-2.5 font-medium">{li.subRubro || '—'}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{li.cantidad}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{li.componentes}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{fmtAmt(li.unitCost, currency)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{fmtAmt(li.total, currency)}</td>
                      </tr>
                    ))}
                  </>
                ));
              })()}
            </tbody>
            <tfoot>
              <tr className="border-t border-border bg-muted/20">
                <td colSpan={4} className="px-4 py-2.5 text-xs font-semibold text-right text-muted-foreground">Subtotal</td>
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
  const [data, setData] = useState<BudgetData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectCode) return;
    setLoading(true);
    getProjectBudget({ projectCode }).then(setData).catch(() => {}).finally(() => setLoading(false));
  }, [projectCode]);

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
    </div>
  );

  const { currency, rubros, totals, canSeeAll } = data;

  return (
    <div className="p-6 space-y-5 max-w-4xl">
      {canSeeAll && (
        <div className="grid grid-cols-2 gap-4">
          <SummaryCard label="Presupuesto cotizado (sin markup)" value={fmtAmt(totals.cotizado, currency)} />
          <SummaryCard label="Total con markup" value={fmtAmt(totals.conMarkup, currency)} sub />
        </div>
      )}

      <div className="space-y-3">
        {rubros.map(rubro => <RubroBlock key={rubro.rubroName} rubro={rubro} currency={currency} />)}
      </div>
    </div>
  );
}
