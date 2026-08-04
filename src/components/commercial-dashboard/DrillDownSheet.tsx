import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { Deal } from '@/lib/commercial-dashboard/types';
import { useMemo } from 'react';

function fmtCurrency(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function AmountCell({ deal }: { deal: Deal }) {
  const price = deal.clientPrice ?? 0;
  const isUSD = deal.currency?.startsWith('USD');
  const rate = deal.exchangeRate ?? 20;
  const mxnEquiv = price * rate;

  if (!isUSD) {
    return <span className="tabular-nums">{fmtCurrency(price)}</span>;
  }

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="tabular-nums cursor-help inline-flex items-center gap-1.5">
            {fmtCurrency(price)}
            <Badge variant="outline" className="text-[10px] px-1 py-0 font-normal leading-tight">USD 🇺🇸</Badge>
          </span>
        </TooltipTrigger>
        <TooltipContent side="left" className="text-xs">
          <p>≈ {fmtCurrency(mxnEquiv)} MXN</p>
          <p className="text-muted-foreground">TC: {rate.toFixed(4)}{!deal.exchangeRate ? ' (estimado)' : ''}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

const PHASE_COLORS: Record<string, string> = {
  Prospecto: 'bg-muted text-muted-foreground',
  'Brief recibido': 'bg-muted text-muted-foreground',
  'Cotización enviada': 'bg-accent text-accent-foreground',
  Negociación: 'bg-accent text-accent-foreground',
  Ganado: 'bg-primary/15 text-primary',
  Perdido: 'bg-destructive/15 text-destructive',
};

interface Props {
  title: string;
  deals: Deal[];
  open: boolean;
  onClose: () => void;
}

export default function DrillDownSheet({ title, deals, open, onClose }: Props) {
  const sorted = useMemo(() => [...deals].sort((a, b) => (b.clientPrice ?? 0) - (a.clientPrice ?? 0)), [deals]);

  const breakdown = useMemo(() => {
    let mxnNative = 0, usdNative = 0, usdConverted = 0;
    for (const d of sorted) {
      const p = d.clientPrice ?? 0;
      if (d.currency?.startsWith('USD')) {
        usdNative += p;
        usdConverted += p * (d.exchangeRate ?? 20);
      } else {
        mxnNative += p;
      }
    }
    return { mxnNative, usdNative, usdConverted, total: mxnNative + usdConverted };
  }, [sorted]);

  const hasUsd = breakdown.usdNative > 0;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto p-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b sticky top-0 bg-background z-10">
          <DialogTitle className="text-base">{title}</DialogTitle>
          <p className="text-xs text-muted-foreground">{sorted.length} deal{sorted.length !== 1 ? 's' : ''}</p>
        </DialogHeader>

        <div className="divide-y">
          {sorted.map(d => (
            <div key={d.id} className="flex items-center gap-3 px-5 py-2.5 hover:bg-muted/40 transition-colors">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{d.dealName || 'Sin nombre'}</p>
                <p className="text-xs text-muted-foreground truncate">{d.client || '—'}</p>
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-medium">
                  <AmountCell deal={d} />
                </div>
              </div>
              <Badge variant="secondary" className={`shrink-0 text-[10px] ${PHASE_COLORS[d.phase ?? ''] ?? ''}`}>
                {d.phase ?? '—'}
              </Badge>
            </div>
          ))}
          {sorted.length === 0 && (
            <div className="text-center text-sm text-muted-foreground py-12">Sin deals en este segmento</div>
          )}
        </div>

        {sorted.length > 0 && (
          <div className="sticky bottom-0 bg-background border-t px-5 py-3 space-y-1">
            {hasUsd ? (
              <>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>MXN nativo</span>
                  <span className="tabular-nums">{fmtCurrency(breakdown.mxnNative)}</span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>USD convertido</span>
                  <span className="tabular-nums">≈ {fmtCurrency(breakdown.usdConverted)}</span>
                </div>
                <div className="flex justify-between text-sm font-semibold pt-1 border-t">
                  <span>Total MXN</span>
                  <span className="tabular-nums">{fmtCurrency(breakdown.total)}</span>
                </div>
              </>
            ) : (
              <div className="flex justify-between text-sm font-semibold">
                <span>Total</span>
                <span className="tabular-nums">{fmtCurrency(breakdown.total)}</span>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
