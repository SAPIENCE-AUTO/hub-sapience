import { AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import NumericInput from '@/components/NumericInput';
import { Plus, Trash2 } from 'lucide-react';
import { fmtMoneyFull } from './dealUtils';

export type LineItemLocal = {
  localId: string;
  subRubro: string;
  cantidad: number;
  componentes: number;
  unitCost: number;
  hasMarkup: boolean;
  markupPct: number;
};

export function calcBase(item: LineItemLocal): number {
  return item.cantidad * item.componentes * item.unitCost;
}

export function calcFinal(item: LineItemLocal): number {
  const base = calcBase(item);
  return item.hasMarkup ? base * (1 + item.markupPct / 100) : base;
}

interface Props {
  rubro: string;
  items: LineItemLocal[];
  currencySymbol: string;
  readOnly?: boolean;
  onUpdate: (items: LineItemLocal[]) => void;
}

const GRID = 'grid-cols-[1fr_52px_52px_80px_28px_52px_80px_80px_28px]';

export default function CotizacionRubroSection({ rubro, items, currencySymbol, readOnly = false, onUpdate }: Props) {
  const subtotalBase = items.reduce((s, i) => s + calcBase(i), 0);
  const subtotalFinal = items.reduce((s, i) => s + calcFinal(i), 0);

  const addItem = () => onUpdate([...items, {
    localId: Math.random().toString(36).slice(2),
    subRubro: '', cantidad: 0, componentes: 0, unitCost: 0, hasMarkup: false, markupPct: 0,
  }]);

  const update = (localId: string, patch: Partial<LineItemLocal>) =>
    onUpdate(items.map(it => it.localId === localId ? { ...it, ...patch } : it));

  const remove = (localId: string) => onUpdate(items.filter(it => it.localId !== localId));

  const visibleItems = readOnly
    ? items.filter(i => i.cantidad > 0 || i.unitCost > 0)
    : items;

  return (
    <AccordionItem value={rubro} className="border rounded-lg px-3 mb-1">
      <AccordionTrigger className="text-sm font-semibold hover:no-underline py-3">
        <div className="flex items-center gap-3 w-full pr-2">
          <span>{rubro}</span>
          {visibleItems.length > 0 && (
            <span className="ml-auto text-xs font-normal text-muted-foreground">
              {visibleItems.length} ítem{visibleItems.length !== 1 ? 's' : ''} · Costo: {fmtMoneyFull(subtotalBase, currencySymbol)} · Precio: {fmtMoneyFull(subtotalFinal, currencySymbol)}
            </span>
          )}
        </div>
      </AccordionTrigger>
      <AccordionContent>
        <div className="pb-3 space-y-1.5">
          {visibleItems.length > 0 && (
            <div className={`grid ${GRID} gap-1 text-xs text-muted-foreground px-1 mb-1`}>
              <span>Sub-rubro</span>
              <span title="Unidades de cotización">UDC</span>
              <span title="Componentes por UDC">Comp.</span>
              <span>P. unit.</span>
              <span title="Markup">MU</span>
              <span>%</span>
              <span>Costo</span>
              <span>Precio</span>
              <span />
            </div>
          )}
          {visibleItems.map(item => {
            const base = calcBase(item);
            const final = calcFinal(item);
            return (
              <div key={item.localId} className={`grid ${GRID} gap-1 items-center`}>
                {readOnly ? (
                  <span className="text-xs px-1 truncate">{item.subRubro || '—'}</span>
                ) : (
                  <Input
                    value={item.subRubro}
                    onChange={e => update(item.localId, { subRubro: e.target.value })}
                    placeholder="Nombre"
                    className="h-7 text-xs px-2"
                  />
                )}
                {readOnly ? (
                  <span className="text-xs px-1 tabular-nums">{item.cantidad}</span>
                ) : (
                  <NumericInput value={item.cantidad} min={0} onChange={v => update(item.localId, { cantidad: v })} className="h-7 text-xs px-2" title="UDC — unidades de cotización" />
                )}
                {readOnly ? (
                  <span className="text-xs px-1 tabular-nums">{item.componentes}</span>
                ) : (
                  <NumericInput value={item.componentes} min={0} onChange={v => update(item.localId, { componentes: v })} className="h-7 text-xs px-2" title="Componentes por UDC" />
                )}
                {readOnly ? (
                  <span className="text-xs px-1 tabular-nums">{fmtMoneyFull(item.unitCost, currencySymbol)}</span>
                ) : (
                  <NumericInput value={item.unitCost} min={0} onChange={v => update(item.localId, { unitCost: v })} className="h-7 text-xs px-2" title="Precio unitario" />
                )}
                {readOnly ? (
                  <span className="text-xs px-1 text-muted-foreground">{item.hasMarkup ? '✓' : '—'}</span>
                ) : (
                  <Checkbox checked={item.hasMarkup} onCheckedChange={v => update(item.localId, { hasMarkup: Boolean(v) })} />
                )}
                {readOnly ? (
                  <span className="text-xs px-1 tabular-nums text-muted-foreground">{item.hasMarkup ? `${item.markupPct}%` : '—'}</span>
                ) : (
                  <NumericInput value={item.markupPct} min={0} disabled={!item.hasMarkup} onChange={v => update(item.localId, { markupPct: v })} className="h-7 text-xs px-2 disabled:opacity-40" />
                )}
                {/* Costo base (sin markup) */}
                <div className="text-xs text-muted-foreground text-right pr-1 tabular-nums">
                  {fmtMoneyFull(base, currencySymbol)}
                </div>
                {/* Precio final (con markup) */}
                <div className="text-xs font-medium text-right pr-1 tabular-nums">
                  {fmtMoneyFull(final, currencySymbol)}
                </div>
                {readOnly ? (
                  <span />
                ) : (
                  <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => remove(item.localId)}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                )}
              </div>
            );
          })}
          {!readOnly && (
            <Button size="sm" variant="ghost" className="gap-1 text-xs h-7 text-muted-foreground" onClick={addItem}>
              <Plus className="w-3 h-3" /> Sub-rubro
            </Button>
          )}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}
