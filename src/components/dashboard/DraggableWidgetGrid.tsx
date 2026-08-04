import { ReactNode } from 'react';
import { ChevronUp, ChevronDown, Maximize2, Minimize2 } from 'lucide-react';
import { WIDGET_REGISTRY, LayoutItem, WidgetSize } from './widgetConfig';

interface Props {
  layout: LayoutItem[];
  editing: boolean;
  onLayoutChange: (layout: LayoutItem[]) => void;
  renderWidget: (id: string, size: WidgetSize) => ReactNode;
}

export default function DraggableWidgetGrid({ layout, editing, onLayoutChange, renderWidget }: Props) {
  const moveUp = (id: string) => {
    const idx = layout.findIndex(i => i.id === id);
    if (idx <= 0) return;
    const newLayout = [...layout];
    [newLayout[idx - 1], newLayout[idx]] = [newLayout[idx], newLayout[idx - 1]];
    onLayoutChange(newLayout);
  };

  const moveDown = (id: string) => {
    const idx = layout.findIndex(i => i.id === id);
    if (idx < 0 || idx >= layout.length - 1) return;
    const newLayout = [...layout];
    [newLayout[idx], newLayout[idx + 1]] = [newLayout[idx + 1], newLayout[idx]];
    onLayoutChange(newLayout);
  };

  const toggleSize = (id: string) => {
    onLayoutChange(
      layout.map(item => {
        if (item.id !== id) return item;
        const config = WIDGET_REGISTRY.find(w => w.id === id);
        if (!config || config.allowedSizes.length < 2) return item;
        return { ...item, size: item.size === 'full' ? 'half' : ('full' as WidgetSize) };
      })
    );
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {layout.map((item, idx) => {
        const content = renderWidget(item.id, item.size);
        if (content === null) return null;

        const config = WIDGET_REGISTRY.find(w => w.id === item.id);
        const canResize = (config?.allowedSizes.length ?? 0) > 1;
        const isFirst = idx === 0;
        const isLast = idx === layout.length - 1;

        if (!editing) {
          return (
            <div key={item.id} className={item.size === 'full' ? 'lg:col-span-2' : 'lg:col-span-1'}>
              {content}
            </div>
          );
        }

        return (
          <div
            key={item.id}
            className={`relative ${item.size === 'full' ? 'lg:col-span-2' : 'lg:col-span-1'}`}
          >
            {/* Editing outline */}
            <div className="absolute inset-0 border border-dashed border-primary/30 rounded-xl pointer-events-none z-10" />

            {/* Mini toolbar */}
            <div className="absolute top-2 right-2 z-20 bg-card shadow-lg border border-border rounded-lg px-1 py-0.5 flex items-center gap-0.5">
              <button
                onClick={() => moveUp(item.id)}
                disabled={isFirst}
                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                title="Mover arriba"
              >
                <ChevronUp className="w-4 h-4" />
              </button>
              <button
                onClick={() => moveDown(item.id)}
                disabled={isLast}
                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                title="Mover abajo"
              >
                <ChevronDown className="w-4 h-4" />
              </button>
              {canResize && (
                <>
                  <div className="h-4 w-px bg-border mx-0.5" />
                  <button
                    onClick={() => toggleSize(item.id)}
                    className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    title={item.size === 'full' ? 'Reducir a mitad' : 'Ampliar a completo'}
                  >
                    {item.size === 'full'
                      ? <Minimize2 className="w-4 h-4" />
                      : <Maximize2 className="w-4 h-4" />
                    }
                  </button>
                </>
              )}
            </div>

            {/* Widget content — rendered normally, no restrictions */}
            {content}
          </div>
        );
      })}
    </div>
  );
}
