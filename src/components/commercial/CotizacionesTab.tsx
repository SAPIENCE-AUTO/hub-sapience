import { useState, useEffect } from 'react';
import { getCotizaciones, GetCotizacionesOutputType, deleteCotizacion, saveCotizacion, saveDeal, duplicateCotizacion } from 'zite-endpoints-sdk';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Plus, Pencil, Trash2, CheckCircle2, Copy, Loader2, ChevronDown } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { COTIZ_STATUS_COLORS, CURRENCIES, getCurrencySymbol, fmtMoney, fmtMoneyFull } from './dealUtils';
import CotizacionModal from './CotizacionModal';
import NumericInput from '@/components/NumericInput';

type Cotizacion = GetCotizacionesOutputType['cotizaciones'][0];

interface Props {
  dealId: string;
  dealCurrency?: string;
  dealClientPrice?: number;
  dealQuotedCost?: number;
  dealTaxesPct?: number;
  dealRetencionesPct?: number;
  onDealFieldUpdated: (fields: { clientPrice?: number; quotedCost?: number; taxesPct?: number; retencionesPct?: number; currency?: string }) => void;
}

export default function CotizacionesTab({ dealId, dealCurrency, dealClientPrice, dealQuotedCost: _dqc, dealTaxesPct, dealRetencionesPct, onDealFieldUpdated }: Props) {
  const [priceOpen, setPriceOpen] = useState(true);
  const [cotizaciones, setCotizaciones] = useState<Cotizacion[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Cotizacion | null>(null);
  const [viewOnly, setViewOnly] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try { const d = await getCotizaciones({ dealId }); setCotizaciones(d.cotizaciones); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [dealId]);

  const calcAndSaveQuotedCost = (list: Cotizacion[]) => {
    const total = list.filter(c => c.included).reduce((s, c) => s + (c.clientPrice ?? c.totalCost ?? 0), 0);
    onDealFieldUpdated({ quotedCost: total });
    saveDeal({ id: dealId, quotedCost: total }).catch(() => {});
  };

  const handleApprove = async (c: Cotizacion) => {
    await saveCotizacion({ id: c.id, status: 'Aprobada' });
    toast.success('Cotización marcada como aprobada');
    load();
  };

  const handleToggleIncluded = (c: Cotizacion, value: boolean) => {
    const updated = cotizaciones.map(x => x.id === c.id ? { ...x, included: value } : x);
    setCotizaciones(updated);
    calcAndSaveQuotedCost(updated);
    saveCotizacion({ id: c.id, included: value }).catch(() => toast.error('Error al actualizar'));
  };

  const handleDuplicate = async (id: string) => {
    setDuplicatingId(id);
    try {
      const result = await duplicateCotizacion({ cotizacionId: id });
      toast.success(`Cotización duplicada · ${result.lineItemsCopied} partida${result.lineItemsCopied !== 1 ? 's' : ''} copiada${result.lineItemsCopied !== 1 ? 's' : ''}`);
      const d = await getCotizaciones({ dealId });
      setCotizaciones(d.cotizaciones);
      calcAndSaveQuotedCost(d.cotizaciones);
    } catch {
      toast.error('Error al duplicar la cotización');
    } finally {
      setDuplicatingId(null);
    }
  };

  const handleDelete = async () => {
    if (!deletingId) return;
    await deleteCotizacion({ id: deletingId });
    toast.success('Cotización eliminada');
    setDeletingId(null);
    const d = await getCotizaciones({ dealId });
    setCotizaciones(d.cotizaciones);
    calcAndSaveQuotedCost(d.cotizaciones);
  };

  const handleClientPriceChange = (val: number) => {
    onDealFieldUpdated({ clientPrice: val });
    saveDeal({ id: dealId, clientPrice: val }).catch(() => {});
  };

  const handleCurrencyChange = (val: string) => {
    onDealFieldUpdated({ currency: val });
    saveDeal({ id: dealId, currency: val }).catch(() => {});
  };

  const handleTaxesPctChange = (val: number) => {
    onDealFieldUpdated({ taxesPct: val });
    saveDeal({ id: dealId, taxesPct: val }).catch(() => {});
  };

  const handleRetencionesPctChange = (val: number) => {
    onDealFieldUpdated({ retencionesPct: val });
    saveDeal({ id: dealId, retencionesPct: val }).catch(() => {});
  };

  const openView = (c: Cotizacion) => { setEditing(c); setViewOnly(true); setShowModal(true); };
  const openEdit = (c: Cotizacion) => { setEditing(c); setViewOnly(false); setShowModal(true); };
  const openNew = () => { setEditing(null); setViewOnly(false); setShowModal(true); };

  if (loading) return <Skeleton className="h-40 w-full" />;

  const included = cotizaciones.filter(c => c.included);
  const includedTotal = included.reduce((s, c) => s + (c.totalCost ?? 0), 0);
  const includedClientTotal = included.reduce((s, c) => s + (c.clientPrice ?? 0), 0);
  const defaultSym = getCurrencySymbol(dealCurrency);
  const cp = dealClientPrice ?? 0;
  const impuestos = cp * (dealTaxesPct ?? 0) / 100;
  const retenciones = cp * (dealRetencionesPct ?? 0) / 100;
  const totalACobrar = cp + impuestos - retenciones;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {cotizaciones.length} cotizacion{cotizaciones.length !== 1 ? 'es' : ''}
          {included.length > 0 && ` · ${included.length} incluida${included.length !== 1 ? 's' : ''}`}
        </span>
        <Button size="sm" onClick={openNew} className="gap-1.5"><Plus className="w-4 h-4" /> Nueva cotización</Button>
      </div>

      {/* Totales + Precio a cliente — colapsable: precio/impuestos/retenciones
          ya no se piden al crear el deal (DealGeneralTab.tsx), se capturan
          aquí cuando ya hay algo que cotizar. */}
      <Collapsible open={priceOpen} onOpenChange={setPriceOpen} className="border rounded-xl overflow-hidden border-primary/20">
        <CollapsibleTrigger asChild>
          <button className="w-full flex items-center gap-3 px-4 py-3 bg-primary/5 hover:bg-primary/10 transition-colors text-left">
            <span className="font-semibold text-sm">Precio a cliente</span>
            {cp > 0 && (
              <span className="text-sm font-bold ml-auto" style={{ color: 'hsl(var(--primary))' }}>
                {fmtMoneyFull(totalACobrar, defaultSym)}
              </span>
            )}
            <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${priceOpen ? 'rotate-180' : ''} ${cp > 0 ? '' : 'ml-auto'}`} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-4 py-3 space-y-3 border-t border-primary/20">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">
                Costo total incluido ({included.length} cotizacion{included.length !== 1 ? 'es' : ''})
              </span>
              <span className="text-base font-bold" style={{ color: 'hsl(var(--primary))' }}>
                {fmtMoneyFull(includedTotal, defaultSym)}
              </span>
            </div>
            {includedClientTotal > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">
                  Costo con mark up
                </span>
                <span className="text-base font-bold text-foreground">
                  {fmtMoneyFull(includedClientTotal, defaultSym)}
                </span>
              </div>
            )}
            <div className="border-t pt-3 grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Precio a cliente</Label>
                <div className="flex items-center gap-1.5">
                  <span className="text-sm text-muted-foreground">{defaultSym}</span>
                  <NumericInput
                    value={dealClientPrice ?? 0}
                    onChange={handleClientPriceChange}
                    min={0}
                    className="flex-1"
                    formatDisplay={(v) => fmtMoneyFull(v, defaultSym)}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Moneda</Label>
                <Select value={dealCurrency ?? 'MXN 🇲🇽'} onValueChange={handleCurrencyChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CURRENCIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Impuestos (%)</Label>
                <NumericInput value={dealTaxesPct ?? 0} onChange={handleTaxesPctChange} min={0} placeholder="16" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Retenciones (%)</Label>
                <NumericInput value={dealRetencionesPct ?? 0} onChange={handleRetencionesPctChange} min={0} placeholder="0" />
              </div>
            </div>
            {cp > 0 && (
              <div className="border-t pt-3 space-y-1 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>Precio a cliente</span>
                  <span>{fmtMoneyFull(cp, defaultSym)}</span>
                </div>
                {(dealTaxesPct ?? 0) > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>+ Impuestos ({dealTaxesPct}%)</span>
                    <span>{fmtMoneyFull(impuestos, defaultSym)}</span>
                  </div>
                )}
                {(dealRetencionesPct ?? 0) > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>− Retenciones ({dealRetencionesPct}%)</span>
                    <span>−{fmtMoneyFull(retenciones, defaultSym)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-primary border-t pt-1">
                  <span>= Total a cobrar</span>
                  <span>{fmtMoneyFull(totalACobrar, defaultSym)}</span>
                </div>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>

      <div className="space-y-2">
        {cotizaciones.map(c => {
          const color = COTIZ_STATUS_COLORS[c.status ?? ''] ?? 'hsl(var(--muted-foreground))';
          const sym = getCurrencySymbol(c.currency ?? dealCurrency);
          const isApproved = c.status === 'Aprobada';
          const isIncluded = c.included ?? false;
          return (
            <div
              key={c.id}
              className={`border rounded-xl p-4 transition-colors cursor-pointer ${
                isIncluded && isApproved ? 'bg-emerald-50 border-emerald-400 dark:bg-emerald-950/30 dark:border-emerald-700 hover:brightness-95' :
                isIncluded ? 'bg-emerald-50/60 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800 hover:brightness-95' :
                isApproved ? 'bg-primary/5 border-primary/30 hover:bg-primary/10' :
                'bg-card hover:bg-muted/20'
              }`}
              onClick={() => openView(c)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    {isApproved && <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: 'hsl(var(--chart-2))' }} />}
                    <span className="font-semibold text-sm">{c.cotizacionName || 'Sin nombre'}</span>
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ backgroundColor: color + '22', color }}>
                      {c.status}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                    {c.totalCost != null && <span>Costo: <strong>{fmtMoney(c.totalCost, sym)}</strong></span>}
                    {c.clientPrice != null && <span>Con markup: <strong>{fmtMoney(c.clientPrice, sym)}</strong></span>}
                    {c.currency && <span className="text-muted-foreground/60">{c.currency}</span>}
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center gap-1.5 mr-1">
                    <span className="text-xs text-muted-foreground">Incluida</span>
                    <Switch
                      checked={isIncluded}
                      onCheckedChange={v => handleToggleIncluded(c, v)}
                    />
                  </div>
                  {!isApproved && (
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => handleApprove(c)}>
                      <CheckCircle2 className="w-3 h-3" /> Aprobar
                    </Button>
                  )}
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(c)}>
                    <Pencil className="w-3 h-3" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" disabled={duplicatingId === c.id} onClick={e => { e.stopPropagation(); handleDuplicate(c.id); }}>
                    {duplicatingId === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Copy className="w-3 h-3" />}
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setDeletingId(c.id)}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
        {cotizaciones.length === 0 && (
          <div className="text-center py-12 text-muted-foreground text-sm border-2 border-dashed rounded-xl">
            Sin cotizaciones. Crea la primera.
          </div>
        )}
      </div>

      <CotizacionModal
        cotizacion={editing}
        dealId={dealId}
        isOpen={showModal}
        viewOnly={viewOnly}
        onClose={() => { setShowModal(false); setEditing(null); }}
        onSaved={async () => {
          setShowModal(false);
          setEditing(null);
          const d = await getCotizaciones({ dealId });
          setCotizaciones(d.cotizaciones);
          calcAndSaveQuotedCost(d.cotizaciones);
        }}
      />

      <AlertDialog open={!!deletingId} onOpenChange={o => !o && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>¿Eliminar cotización?</AlertDialogTitle>
            <AlertDialogDescription>Esta acción no se puede deshacer.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
