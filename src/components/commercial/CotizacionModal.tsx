import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Accordion } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Pencil } from 'lucide-react';
import { getCotizacionLineItems, GetCotizacionesOutputType, saveCotizacion, saveQuotationLineItems } from 'zite-endpoints-sdk';
import { toast } from 'sonner';
import { RUBROS, COTIZ_STATUSES, COTIZ_CURRENCIES, getCurrencySymbol, fmtMoneyFull } from './dealUtils';
import CotizacionRubroSection, { type LineItemLocal, calcFinal, calcBase } from './CotizacionRubroSection';

type Cotizacion = GetCotizacionesOutputType['cotizaciones'][0];

interface Props {
  cotizacion: Cotizacion | null;
  dealId: string;
  isOpen: boolean;
  viewOnly?: boolean;
  onClose: () => void;
  onSaved: () => void;
}

type RubroMap = Record<string, LineItemLocal[]>;

export default function CotizacionModal({ cotizacion, dealId, isOpen, viewOnly = false, onClose, onSaved }: Props) {
  const [form, setForm] = useState({ cotizacionName: '', status: 'Borrador', currency: 'MXN', notes: '' });
  const [rubroItems, setRubroItems] = useState<RubroMap>({});
  const [saving, setSaving] = useState(false);
  const [isViewMode, setIsViewMode] = useState(viewOnly);

  // Reset view mode when modal opens
  useEffect(() => {
    if (isOpen) setIsViewMode(viewOnly);
  }, [isOpen, viewOnly]);

  useEffect(() => {
    if (!isOpen) return;
    if (cotizacion) {
      setForm({
        cotizacionName: cotizacion.cotizacionName ?? '',
        status: cotizacion.status ?? 'Borrador',
        currency: cotizacion.currency ?? 'MXN',
        notes: cotizacion.notes ?? '',
      });
      getCotizacionLineItems({ cotizacionId: cotizacion.id }).then(data => {
        const grouped: RubroMap = {};
        data.lineItems.forEach(li => {
          const r = li.rubro ?? RUBROS[0];
          if (!grouped[r]) grouped[r] = [];
          grouped[r].push({
            localId: li.id, subRubro: li.subRubro ?? '', cantidad: li.cantidad ?? 0,
            componentes: li.componentes ?? 0, unitCost: li.unitCost ?? 0,
            hasMarkup: li.hasMarkup ?? false, markupPct: li.markupPct ?? 0,
          });
        });
        setRubroItems(grouped);
      });
    } else {
      setForm({ cotizacionName: '', status: 'Borrador', currency: 'MXN', notes: '' });
      const mk = (subRubro: string, hasMarkup: boolean, markupPct: number): LineItemLocal => ({
        localId: Math.random().toString(36).slice(2), subRubro, cantidad: 0, componentes: 0, unitCost: 0, hasMarkup, markupPct,
      });
      setRubroItems({
        'Reclutamiento e incentivos': [mk('Reclutamiento', true, 50), mk('Incentivos', true, 50)],
        'Moderación': [mk('Moderación', true, 50)],
        'Management': [mk('Management Cuali', true, 50)],
        'Logística y operación': [mk('Renta de cámaras', false, 0), mk('Traducción', false, 0), mk('Viáticos', false, 0), mk('Transporte', false, 0)],
        'Back office': [mk('Seguimiento', true, 50)],
      });
    }
  }, [isOpen, cotizacion]);

  const allItems = Object.entries(rubroItems).flatMap(([rubro, items]) =>
    items.map(item => ({ ...item, rubro, finalPrice: calcFinal(item) }))
  );
  const totalCost = allItems.reduce((s, i) => s + calcBase(i), 0);
  const totalWithMarkup = allItems.reduce((s, i) => s + i.finalPrice, 0);
  const sym = getCurrencySymbol(form.currency);

  // In view mode, only show rubros that have items with actual data
  const visibleRubros = isViewMode
    ? RUBROS.filter(r => (rubroItems[r] ?? []).some(i => i.cantidad > 0 || i.unitCost > 0))
    : RUBROS;

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await saveCotizacion({
        id: cotizacion?.id,
        cotizacionName: form.cotizacionName || undefined,
        deal: cotizacion?.id ? undefined : [dealId],
        status: form.status,
        currency: form.currency,
        notes: form.notes || undefined,
      });
      const cotizId = cotizacion?.id ?? result.id;
      await saveQuotationLineItems({
        cotizacionId: cotizId,
        lineItems: allItems.map(({ localId: _lid, ...rest }) => rest),
        totalCost: totalWithMarkup,
      });
      toast.success('Cotización guardada');
      onSaved();
      onClose();
    } catch { toast.error('Error al guardar cotización'); }
    setSaving(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 py-4 border-b flex-shrink-0">
          <div className="flex items-center gap-3">
            <DialogTitle>
              {isViewMode
                ? (form.cotizacionName || 'Sin nombre')
                : (cotizacion ? 'Editar cotización' : 'Nueva cotización')}
            </DialogTitle>
            {isViewMode && (
              <Badge variant="outline" className="text-xs font-normal">
                {form.status}
              </Badge>
            )}
          </div>
        </DialogHeader>

        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
          {isViewMode ? (
            /* View mode header */
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span>Moneda: <strong className="text-foreground">{form.currency}</strong></span>
              {form.notes && (
                <span className="flex-1 truncate">Notas: <em>{form.notes}</em></span>
              )}
            </div>
          ) : (
            /* Edit mode header fields */
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1"><Label>Nombre</Label>
                <Input value={form.cotizacionName} onChange={e => setForm(f => ({ ...f, cotizacionName: e.target.value }))} placeholder="Cotización v1" />
              </div>
              <div className="space-y-1"><Label>Status</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{COTIZ_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label>Moneda</Label>
                <Select value={form.currency} onValueChange={v => setForm(f => ({ ...f, currency: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{COTIZ_CURRENCIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* Rubros */}
          {visibleRubros.length > 0 ? (
            <Accordion type="multiple" defaultValue={[...visibleRubros]} className="space-y-0">
              {visibleRubros.map(rubro => (
                <CotizacionRubroSection
                  key={rubro}
                  rubro={rubro}
                  items={rubroItems[rubro] ?? []}
                  currencySymbol={sym}
                  readOnly={isViewMode}
                  onUpdate={items => setRubroItems(prev => ({ ...prev, [rubro]: items }))}
                />
              ))}
            </Accordion>
          ) : isViewMode ? (
            <p className="text-sm text-muted-foreground text-center py-6">Sin rubros con datos.</p>
          ) : null}

          {/* Totals & notes */}
          <div className="border rounded-lg p-4 space-y-3 bg-muted/20">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>Costo base</span>
              <span className="tabular-nums">{fmtMoneyFull(totalCost, sym)}</span>
            </div>
            <div className="flex items-center justify-between border-t pt-2">
              <span className="text-sm font-semibold">Precio con markup</span>
              <span className="text-lg font-bold">{fmtMoneyFull(totalWithMarkup, sym)}</span>
            </div>
            {!isViewMode && (
              <div className="space-y-1"><Label>Notas</Label>
                <Textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
            )}
            {isViewMode && form.notes && (
              <div className="text-sm text-muted-foreground border-t pt-2">
                <span className="font-medium text-foreground">Notas:</span> {form.notes}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="px-6 py-4 border-t flex-shrink-0">
          {isViewMode ? (
            <>
              <Button variant="outline" onClick={onClose}>Cerrar</Button>
              <Button onClick={() => setIsViewMode(false)} className="gap-1.5">
                <Pencil className="w-4 h-4" /> Editar
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>Cancelar</Button>
              <Button onClick={handleSave} disabled={saving}>{saving ? 'Guardando...' : 'Guardar cotización'}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
