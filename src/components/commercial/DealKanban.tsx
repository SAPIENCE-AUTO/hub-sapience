import { useRef } from 'react';
import { GetDealsOutputType } from 'zite-endpoints-sdk';
import DealCard from './DealCard';
import { PHASES } from './dealUtils';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Deal = GetDealsOutputType['deals'][0];

interface Props {
  deals: Deal[];
  onDealClick: (deal: Deal) => void;
  onStatusChange: (dealId: string, newPhase: string) => void;
  onNewDeal: (phase: string) => void;
}

export default function DealKanban({ deals, onDealClick, onStatusChange, onNewDeal }: Props) {
  const dragId = useRef<string | null>(null);

  return (
    <div className="flex gap-3 overflow-x-auto pb-4 -mx-1 px-1">
      {PHASES.map(phase => {
        const phaseDeals = deals.filter(d => (d.phase ?? 'Prospecto') === phase.key);
        return (
          <div
            key={phase.key}
            className="flex-shrink-0 w-56 flex flex-col"
            onDragOver={e => e.preventDefault()}
            onDrop={() => {
              if (dragId.current) onStatusChange(dragId.current, phase.key);
              dragId.current = null;
            }}
          >
            {/* Column header */}
            <div className="flex items-center gap-2 mb-2 px-1">
              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: phase.color }} />
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider truncate">
                {phase.key}
              </span>
              <span className="ml-auto text-xs text-muted-foreground bg-muted rounded-full px-1.5 py-0.5">
                {phaseDeals.length}
              </span>
            </div>

            {/* Cards area */}
            <div
              className="flex-1 min-h-24 bg-muted/30 rounded-xl p-2 space-y-2"
              style={{ borderTop: `2px solid ${phase.color}` }}
            >
              {phaseDeals.map(deal => (
                <DealCard
                  key={deal.id}
                  deal={deal}
                  onClick={() => onDealClick(deal)}
                  onDragStart={() => { dragId.current = deal.id; }}
                />
              ))}
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-xs text-muted-foreground h-7 gap-1 opacity-60 hover:opacity-100"
                onClick={() => onNewDeal(phase.key)}
              >
                <Plus className="w-3 h-3" /> Agregar
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
