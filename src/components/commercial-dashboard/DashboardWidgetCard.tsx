import { WidgetConfig, Deal, DateReference } from '@/lib/commercial-dashboard/types';
import { buildChartData } from '@/lib/commercial-dashboard/chartData';
import ChartRenderer from './ChartRenderer';
import { Button } from '@/components/ui/button';
import { Pencil, Trash2, ClipboardCopy, ArrowUp, ArrowDown, Maximize2, Minimize2 } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  widget: WidgetConfig;
  deals: Deal[];
  dateRef: DateReference;
  editMode: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggleSize: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

export default function DashboardWidgetCard(props: Props) {
  const { widget, deals, dateRef, editMode, onEdit, onDelete, onMoveUp, onMoveDown, onToggleSize, canMoveUp, canMoveDown } = props;

  function handleCopyCSV() {
    const data = buildChartData(deals, widget, dateRef);
    const text = ['Label,Valor', ...data.map(d => `${d.label},${d.value}`)].join('\n');
    navigator.clipboard.writeText(text);
    toast.success('Datos copiados al portapapeles');
  }

  return (
    <div className={`bg-card border rounded-xl flex flex-col overflow-hidden group transition-all ${editMode ? 'border-dashed border-primary/50' : ''}`}>
      <div className="flex items-center justify-between px-4 pt-3 pb-1 gap-2 min-h-[40px]">
        <span className="text-sm font-semibold truncate">{widget.name}</span>
        <div className="flex items-center gap-0.5 shrink-0">
          {editMode ? (
            <>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onMoveUp} disabled={!canMoveUp}><ArrowUp className="w-3.5 h-3.5" /></Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onMoveDown} disabled={!canMoveDown}><ArrowDown className="w-3.5 h-3.5" /></Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onToggleSize}>
                {widget.size === 'full' ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit}><Pencil className="w-3.5 h-3.5" /></Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={onDelete}><Trash2 className="w-3.5 h-3.5" /></Button>
            </>
          ) : (
            <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity" onClick={handleCopyCSV}>
              <ClipboardCopy className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </div>
      <div className="flex-1 px-3 pb-3">
        <ChartRenderer widget={widget} deals={deals} dateRef={dateRef} />
      </div>
    </div>
  );
}
