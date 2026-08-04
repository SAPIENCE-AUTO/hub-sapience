import { useState, useEffect } from 'react';
import {
  getApprovalPreview, approveDeal,
  GetApprovalPreviewOutputType, GetDealsOutputType,
} from 'zite-endpoints-sdk';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';

import { CheckCircle2, Loader2, User } from 'lucide-react';
import { toast } from 'sonner';

type Deal = GetDealsOutputType['deals'][0];
type RubroData = GetApprovalPreviewOutputType['rubros'][0];

interface ApprovalResult {
  projectCode?: string;
  projectId?: string;
  quotedCost: number;
  notificationsSent: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  deal: Deal;
  onApproved: (result: ApprovalResult) => void;
}

function fmtAmt(amount: number, currency: string) {
  const sym = currency === 'USD' ? 'USD ' : currency === 'EUR' ? 'EUR ' : '$';
  return `${sym}${amount.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function RubroAccordionItem({
  rubro, currency, selected, onToggleItem, onToggleAll,
}: {
  rubro: RubroData;
  currency: string;
  selected: Set<string>;
  onToggleItem: (id: string) => void;
  onToggleAll: (allSelected: boolean) => void;
}) {
  const allIds = rubro.lineItems.map(li => li.id);
  const allSelected = allIds.length > 0 && allIds.every(id => selected.has(id));
  const someSelected = allIds.some(id => selected.has(id));
  const subtotal = rubro.lineItems.filter(li => selected.has(li.id)).reduce((s, li) => s + li.total, 0);

  return (
    <AccordionItem value={rubro.rubroName} className="border rounded-lg mb-2 overflow-hidden">
      <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/30 transition-colors">
        <div className="flex items-center gap-3 w-full pr-2 min-w-0">
          <div
            className="flex-shrink-0"
            onClick={e => { e.stopPropagation(); onToggleAll(allSelected); }}
          >
            <Checkbox
              checked={allSelected ? true : someSelected ? 'indeterminate' : false}
              onCheckedChange={() => onToggleAll(allSelected)}
            />
          </div>
          <span className="font-semibold text-sm truncate">{rubro.rubroName}</span>
          <div className="flex items-center gap-1 flex-wrap flex-shrink-0">
            {rubro.users.length > 0 ? rubro.users.map(u => (
              <Badge key={u.id} variant="secondary" className="text-[10px] gap-1 py-0 px-1.5">
                <User className="w-2.5 h-2.5" />{u.name}
              </Badge>
            )) : (
              <span className="text-[10px] text-muted-foreground italic">Sin responsable</span>
            )}
          </div>
          <span className="ml-auto text-xs font-semibold tabular-nums flex-shrink-0 text-primary">
            {fmtAmt(subtotal, currency)}
          </span>
        </div>
      </AccordionTrigger>
      <AccordionContent className="px-4 pb-3 pt-0">
        <div className="space-y-0.5">
          <div className="grid grid-cols-[20px_1fr_44px_44px_90px_90px] gap-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide pb-1.5 pt-1 border-b border-border px-1">
            <span />
            <span>Sub-rubro</span>
            <span className="text-right">UDC</span>
            <span className="text-right">Comp.</span>
            <span className="text-right">P. unit.</span>
            <span className="text-right">Total</span>
          </div>
          {(() => {
            // Group line items by cotizacionName
            const groups = new Map<string, typeof rubro.lineItems>();
            for (const li of rubro.lineItems) {
              const key = li.cotizacionName || '—';
              if (!groups.has(key)) groups.set(key, []);
              groups.get(key)!.push(li);
            }
            const showSubheaders = groups.size > 1;
            return [...groups.entries()].map(([cotName, items]) => (
              <div key={cotName}>
                {showSubheaders && (
                  <div className="text-[10px] font-semibold text-muted-foreground bg-muted/40 px-2 py-1 mt-2 mb-0.5 rounded">
                    {cotName}
                  </div>
                )}
                {items.map(li => {
                  const isChecked = selected.has(li.id);
                  return (
                    <div
                      key={li.id}
                      onClick={() => onToggleItem(li.id)}
                      className={`grid grid-cols-[20px_1fr_44px_44px_90px_90px] gap-2 items-center py-1.5 px-1 rounded-md cursor-pointer transition-colors select-none ${
                        isChecked ? 'hover:bg-muted/40' : 'opacity-40 hover:opacity-60'
                      }`}
                    >
                      <Checkbox
                        checked={isChecked}
                        onClick={e => e.stopPropagation()}
                        onCheckedChange={() => onToggleItem(li.id)}
                      />
                      <span className="text-sm truncate">{li.subRubro || '—'}</span>
                      <span className="text-xs text-right tabular-nums text-muted-foreground">{li.cantidad}</span>
                      <span className="text-xs text-right tabular-nums text-muted-foreground">{li.componentes}</span>
                      <span className="text-xs text-right tabular-nums text-muted-foreground">{fmtAmt(li.unitCost, currency)}</span>
                      <span className={`text-xs text-right tabular-nums font-medium ${isChecked ? 'text-foreground' : 'text-muted-foreground'}`}>
                        {fmtAmt(li.total, currency)}
                      </span>
                    </div>
                  );
                })}
              </div>
            ));
          })()}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

export default function ApprovalReviewDialog({ open, onClose, deal, onApproved }: Props) {
  const [loading, setLoading] = useState(false);
  const [approving, setApproving] = useState(false);
  const [rubros, setRubros] = useState<RubroData[]>([]);
  const [currency, setCurrency] = useState('MXN');
  const [selected, setSelected] = useState<Map<string, Set<string>>>(new Map());
  const [createProject, setCreateProject] = useState(true);

  useEffect(() => {
    if (!open || !deal.id) return;
    setLoading(true);
    getApprovalPreview({ dealId: deal.id })
      .then(data => {
        setRubros(data.rubros);
        setCurrency(data.currency);
        const init = new Map<string, Set<string>>();
        for (const r of data.rubros) init.set(r.rubroName, new Set(r.lineItems.map(li => li.id)));
        setSelected(init);
      })
      .catch(() => toast.error('Error al cargar líneas de cotización'))
      .finally(() => setLoading(false));
  }, [open, deal.id]);

  const toggleItem = (rubroName: string, id: string) => {
    setSelected(prev => {
      const next = new Map(prev);
      const s = new Set(next.get(rubroName) ?? []);
      s.has(id) ? s.delete(id) : s.add(id);
      next.set(rubroName, s);
      return next;
    });
  };

  const toggleAll = (rubroName: string, allIds: string[], wasAllSelected: boolean) => {
    setSelected(prev => {
      const next = new Map(prev);
      next.set(rubroName, wasAllSelected ? new Set() : new Set(allIds));
      return next;
    });
  };

  const handleApprove = async () => {
    if (!deal.id) return;
    setApproving(true);
    try {
      const selectedLineItems = rubros.map(r => ({
        rubroName: r.rubroName,
        lineItemIds: [...(selected.get(r.rubroName) ?? new Set<string>())],
      }));
      const res = await approveDeal({ dealId: deal.id, createProject, selectedLineItems });
      const notifMsg = res.notificationsSent > 0
        ? ` · ${res.notificationsSent} notificación${res.notificationsSent !== 1 ? 'es' : ''} enviada${res.notificationsSent !== 1 ? 's' : ''}`
        : '';
      const successMsg = createProject
        ? `✓ Deal aprobado — Proyecto ${res.projectCode} creado${notifMsg}`
        : `✓ Deal aprobado`;
      toast.success(successMsg);
      onApproved({ projectCode: res.projectCode, projectId: res.projectId, quotedCost: res.quotedCost, notificationsSent: res.notificationsSent });
      onClose();
    } catch (e: unknown) {
      toast.error((e as { message?: string })?.message ?? 'Error al aprobar el deal');
    }
    setApproving(false);
  };

  const grandTotal = rubros.reduce((sum, r) => {
    const sel = selected.get(r.rubroName) ?? new Set<string>();
    return sum + r.lineItems.filter(li => sel.has(li.id)).reduce((s, li) => s + li.total, 0);
  }, 0);

  const totalItems = rubros.reduce((s, r) => s + r.lineItems.length, 0);
  const selectedCount = rubros.reduce((s, r) => s + (selected.get(r.rubroName)?.size ?? 0), 0);

  return (
    <Dialog open={open} onOpenChange={v => { if (!v && !approving) onClose(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-4 border-b flex-shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <CheckCircle2 className="w-4 h-4 text-primary" />
            Aprobar deal: {deal.dealName || 'Sin nombre'}
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Selecciona qué líneas de cotización se enviarán a cada responsable. Solo las marcadas aparecerán en los mensajes y en el presupuesto.
          </p>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="px-6 py-4 space-y-2">
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
              </div>
            ) : rubros.length === 0 ? (
              <div className="py-12 text-center space-y-2">
                <p className="text-sm font-medium text-muted-foreground">Sin líneas de cotización</p>
                <p className="text-xs text-muted-foreground">No hay cotizaciones incluidas con líneas de presupuesto en este deal.</p>
                <p className="text-xs text-muted-foreground">Aún puedes aprobar — se creará el proyecto y el proceso de cobranza.</p>
              </div>
            ) : (
              <Accordion type="multiple" defaultValue={rubros.map(r => r.rubroName)}>
                {rubros.map(rubro => (
                  <RubroAccordionItem
                    key={rubro.rubroName}
                    rubro={rubro}
                    currency={currency}
                    selected={selected.get(rubro.rubroName) ?? new Set()}
                    onToggleItem={id => toggleItem(rubro.rubroName, id)}
                    onToggleAll={wasAll => toggleAll(rubro.rubroName, rubro.lineItems.map(li => li.id), wasAll)}
                  />
                ))}
              </Accordion>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t flex-shrink-0 bg-muted/20 space-y-3">
          <div className="flex items-start gap-2">
            <Checkbox
              id="create-project-checkbox"
              checked={createProject}
              onCheckedChange={v => setCreateProject(v === true)}
              className="mt-0.5"
            />
            <div>
              <label htmlFor="create-project-checkbox" className="text-sm font-medium cursor-pointer">
                Crear proyecto automáticamente
              </label>
              <p className="text-xs text-muted-foreground">
                {createProject
                  ? 'Se creará un proyecto con tableros y tareas por defecto'
                  : 'Solo se aprobará el deal, sin crear proyecto ni proceso de cobranza'}
              </p>
            </div>
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              {totalItems > 0 && (
                <p className="text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">{selectedCount}</span> de {totalItems} líneas seleccionadas
                </p>
              )}
              <p className="text-sm font-bold text-foreground">
                Total: {fmtAmt(grandTotal, currency)}
              </p>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <Button variant="ghost" onClick={onClose} disabled={approving}>Cancelar</Button>
              <Button onClick={handleApprove} disabled={approving || loading} className="gap-1.5">
                {approving
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Aprobando...</>
                  : <><CheckCircle2 className="w-4 h-4" /> {createProject ? 'Aprobar y notificar' : 'Aprobar'}</>
                }
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
