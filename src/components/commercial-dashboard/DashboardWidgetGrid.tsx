import { useState } from 'react';
import { WidgetConfig, Deal, DateReference } from '@/lib/commercial-dashboard/types';
import DashboardWidgetCard from './DashboardWidgetCard';
import ChartBuilderModal from './ChartBuilderModal';
import { Button } from '@/components/ui/button';
import { Plus, Settings2, Save } from 'lucide-react';

interface Props {
  widgets: WidgetConfig[];
  deals: Deal[];
  dateRef: DateReference;
  onWidgetsChange: (ws: WidgetConfig[]) => void;
  onSaveRequested?: () => void;
}

export default function DashboardWidgetGrid({ widgets, deals, dateRef, onWidgetsChange, onSaveRequested }: Props) {
  const [editMode, setEditMode] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editing, setEditing] = useState<WidgetConfig | null>(null);

  function move(idx: number, dir: -1 | 1) {
    const next = [...widgets];
    [next[idx], next[idx + dir]] = [next[idx + dir], next[idx]];
    onWidgetsChange(next);
  }

  function toggleSize(idx: number) {
    onWidgetsChange(widgets.map((w, i) => i === idx ? { ...w, size: w.size === 'half' ? 'full' : 'half' } as WidgetConfig : w));
  }

  function del(idx: number) { onWidgetsChange(widgets.filter((_, i) => i !== idx)); }

  function handleSave(w: WidgetConfig) {
    if (editing) onWidgetsChange(widgets.map(x => x.id === w.id ? w : x));
    else onWidgetsChange([...widgets, w]);
    setEditing(null);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{widgets.length} gráfica{widgets.length !== 1 ? 's' : ''}</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-1.5 print:hidden" onClick={() => { setEditing(null); setBuilderOpen(true); }}>
            <Plus className="w-4 h-4" /> Agregar gráfica
          </Button>
          {editMode ? (
            <Button variant="default" size="sm" className="gap-1.5 print:hidden" onClick={() => { setEditMode(false); onSaveRequested?.(); }}>
              <Save className="w-4 h-4" /> Guardar
            </Button>
          ) : (
            <Button variant="outline" size="sm" className="gap-1.5 print:hidden" onClick={() => setEditMode(true)}>
              <Settings2 className="w-4 h-4" /> Personalizar
            </Button>
          )}
        </div>
      </div>

      {widgets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 border-2 border-dashed border-border rounded-xl text-muted-foreground gap-3">
          <p className="text-sm font-medium">Aún no tienes gráficas</p>
          <p className="text-xs">Agrega tu primera gráfica o carga una vista guardada</p>
          <Button size="sm" className="gap-1.5" onClick={() => { setEditing(null); setBuilderOpen(true); }}>
            <Plus className="w-4 h-4" /> Agregar gráfica
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {widgets.map((widget, idx) => (
            <div key={widget.id} className={widget.size === 'full' ? 'col-span-full' : ''}>
              <DashboardWidgetCard
                widget={widget} deals={deals} dateRef={dateRef} editMode={editMode}
                onEdit={() => { setEditing(widget); setBuilderOpen(true); }}
                onDelete={() => del(idx)}
                onMoveUp={() => move(idx, -1)}
                onMoveDown={() => move(idx, 1)}
                onToggleSize={() => toggleSize(idx)}
                canMoveUp={idx > 0}
                canMoveDown={idx < widgets.length - 1}
              />
            </div>
          ))}
        </div>
      )}

      <ChartBuilderModal open={builderOpen} onClose={() => { setBuilderOpen(false); setEditing(null); }}
        initial={editing} deals={deals} dateRef={dateRef} onSave={handleSave} />
    </div>
  );
}
