import { useState, useEffect } from 'react';
import { GetDealsOutputType, getCotizaciones, GetCotizacionesOutputType, getCotizacionLineItems } from 'zite-endpoints-sdk';
import { Skeleton } from '@/components/ui/skeleton';
import { CheckCircle2, TrendingUp } from 'lucide-react';
import { RUBROS, COTIZ_STATUS_COLORS, getCurrencySymbol, fmtMoneyFull } from './dealUtils';

type Deal = GetDealsOutputType['deals'][0];
type Cotizacion = GetCotizacionesOutputType['cotizaciones'][0];

export default function ResumenTab({ deal }: { deal: Deal }) {
  const [cotizaciones, setCotizaciones] = useState<Cotizacion[]>([]);
  const [rubroTotals, setRubroTotals] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const sym = getCurrencySymbol(deal.currency);
  const fmt = (n?: number) => fmtMoneyFull(n, sym);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const data = await getCotizaciones({ dealId: deal.id });
        setCotizaciones(data.cotizaciones);
        const approved = data.cotizaciones.find(c => c.status === 'Aprobada');
        if (approved) {
          const liData = await getCotizacionLineItems({ cotizacionId: approved.id });
          const totals: Record<string, number> = {};
          liData.lineItems.forEach(li => {
            const r = li.rubro ?? 'Otro';
            totals[r] = (totals[r] ?? 0) + (li.finalPrice ?? 0);
          });
          setRubroTotals(totals);
        }
      } finally { setLoading(false); }
    };
    load();
  }, [deal.id]);

  if (loading) return <Skeleton className="h-60 w-full" />;

  const approved = cotizaciones.find(c => c.status === 'Aprobada');

  return (
    <div className="space-y-5">
      {/* Cotizaciones list */}
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Cotizaciones</h4>
        <div className="space-y-1.5">
          {cotizaciones.map(c => {
            const color = COTIZ_STATUS_COLORS[c.status ?? ''] ?? 'hsl(var(--muted-foreground))';
            const csym = getCurrencySymbol(c.currency ?? deal.currency);
            return (
              <div key={c.id} className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm ${c.status === 'Aprobada' ? 'bg-primary/10 border border-primary/20' : 'bg-muted/30'}`}>
                <div className="flex items-center gap-2">
                  {c.status === 'Aprobada' && <CheckCircle2 className="w-3.5 h-3.5" style={{ color: 'hsl(var(--chart-2))' }} />}
                  <span className="font-medium">{c.cotizacionName || 'Sin nombre'}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ color, backgroundColor: color + '20' }}>{c.status}</span>
                </div>
                <span className="font-semibold">{fmtMoneyFull(c.totalCost, csym)}</span>
              </div>
            );
          })}
          {cotizaciones.length === 0 && <p className="text-sm text-muted-foreground py-2">Sin cotizaciones.</p>}
        </div>
      </div>

      {/* Rubro breakdown */}
      {approved && (
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Desglose por rubro — {approved.cotizacionName}
          </h4>
          <div className="space-y-1.5">
            {RUBROS.map(rubro => (
              <div key={rubro} className="flex items-center justify-between text-sm px-1">
                <span className="text-muted-foreground">{rubro}</span>
                <span className="font-medium">{rubroTotals[rubro] != null ? fmtMoneyFull(rubroTotals[rubro], sym) : '—'}</span>
              </div>
            ))}
            <div className="flex items-center justify-between font-semibold pt-2 border-t text-sm px-1">
              <span>Total costo</span><span>{fmt(approved.totalCost)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Deal financials */}
      <div className="bg-muted/30 rounded-xl p-4 space-y-2">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="w-4 h-4 text-primary" />
          <h4 className="text-sm font-semibold">Resumen financiero del deal</h4>
        </div>
        <Row label="Precio a cliente" value={fmt(deal.clientPrice)} />
        {deal.taxesPct != null && deal.clientPrice != null && <>
          <Row label={`Impuestos (${deal.taxesPct}%)`} value={fmt(deal.clientPrice * deal.taxesPct / 100)} />
          <div className="border-t pt-2">
            <Row label="Total con impuestos" value={fmt(deal.clientPrice * (1 + deal.taxesPct / 100))} bold />
          </div>
        </>}
        {approved?.clientPrice != null && <Row label="Precio cotización aprobada" value={fmt(approved.clientPrice)} />}
      </div>
    </div>
  );
}

function Row({ label, value, bold = false }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex items-center justify-between text-sm ${bold ? 'font-semibold' : ''}`}>
      <span className={bold ? '' : 'text-muted-foreground'}>{label}</span>
      <span>{value}</span>
    </div>
  );
}
