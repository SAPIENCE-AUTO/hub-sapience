import { GetDealsOutputType } from 'zite-endpoints-sdk';
import { Calendar, DollarSign } from 'lucide-react';
import { PHASE_COLOR_MAP, getCurrencySymbol, fmtMoney } from './dealUtils';

type Deal = GetDealsOutputType['deals'][0];

interface Props {
  deal: Deal;
  onClick: () => void;
  onDragStart: () => void;
}

export default function DealCard({ deal, onClick, onDragStart }: Props) {
  const color = PHASE_COLOR_MAP[deal.phase ?? ''] ?? 'hsl(var(--muted-foreground))';
  const sym = getCurrencySymbol(deal.currency);
  const amount = deal.clientPrice ?? deal.quotedCost;

  return (
    <div
      className="bg-card border rounded-lg p-3 cursor-pointer hover:shadow-md transition-all duration-150 space-y-2 select-none"
      style={{ borderLeft: `3px solid ${color}` }}
      onClick={onClick}
      draggable
      onDragStart={onDragStart}
    >
      <div className="font-medium text-sm leading-tight line-clamp-2">
        {deal.dealName || <span className="text-muted-foreground italic">Sin nombre</span>}
      </div>

      {deal.client && (
        <div className="text-xs text-muted-foreground truncate">{deal.client}</div>
      )}

      {deal.tematica && (
        <div className="text-xs px-1.5 py-0.5 bg-muted rounded truncate">{deal.tematica}</div>
      )}

      <div className="flex items-center justify-between">
        {amount != null ? (
          <div className="flex items-center gap-0.5 text-xs font-semibold" style={{ color }}>
            <DollarSign className="w-3 h-3" />
            {fmtMoney(amount, sym)}
          </div>
        ) : <span />}

        {(deal.approvalDate || deal.proposalDate) && (
          <div className={`flex items-center gap-1 text-xs ${deal.approvalDate ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
            <Calendar className="w-3 h-3" />
            {(() => { const raw = deal.approvalDate || deal.proposalDate!; const [y,m,d] = raw.slice(0,10).split('-').map(Number); return new Date(y,m-1,d).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }); })()}
          </div>
        )}
      </div>
    </div>
  );
}
