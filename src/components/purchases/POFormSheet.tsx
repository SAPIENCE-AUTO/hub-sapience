import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import SearchableSelect from '@/components/SearchableSelect';
import { CATEGORIES } from '../../lib/constants';
import { Trash2, Plus, AlertTriangle, Send } from 'lucide-react';
import { savePurchaseOrder, submitPurchaseOrder, getPoLineItems, GetPurchaseOrdersOutputType } from 'zite-endpoints-sdk';
import { toast } from 'sonner';
import { useProject } from '@/context/ProjectContext';

type PO = GetPurchaseOrdersOutputType['pos'][0];
type Supplier = GetPurchaseOrdersOutputType['suppliers'][0];
type BillingEntity = GetPurchaseOrdersOutputType['billingEntities'][0];

interface LineItem { id?: string; description: string; category: string; quantity: number; unitPrice: number; total: number; }



function newLine(): LineItem { return { description: '', category: '', quantity: 0, unitPrice: 0, total: 0 }; }
const fmtNum = (n: number) => n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function detectsAnticipo(form: FormState): boolean {
  const haystack = [form.serviceDescription, form.notes, form.supplierName].join(' ').toLowerCase();
  return haystack.includes('anticipo') && form.orderType !== 'Anticipo';
}

type FormState = {
  projectCode: string; supplierName: string; issueDate: string; category: string;
  paymentTerms: string; currency: string; notes: string;
  serviceDescription: string; billingEntity: string; orderType: string;
};

interface Props {
  open: boolean; onClose: () => void; onSaved: () => void;
  po: PO | null; suppliers: Supplier[]; userCostCenters: string[];
  billingEntities: BillingEntity[];
}

export default function POFormSheet({ open, onClose, onSaved, po, suppliers, userCostCenters, billingEntities }: Props) {
  const { projects } = useProject();
  const [saving, setSaving] = useState(false);
  const [savingAndSubmitting, setSavingAndSubmitting] = useState(false);
  const [lineItems, setLineItems] = useState<LineItem[]>([newLine()]);
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const [anticipoWarn, setAnticipo] = useState(false);
  const [form, setForm] = useState<FormState>({
    projectCode: '', supplierName: '', issueDate: '', category: '',
    paymentTerms: '', currency: 'MXN', notes: '',
    serviceDescription: '', billingEntity: '', orderType: 'Normal',
  });

  useEffect(() => {
    if (!open) return;
    const defaultCat = userCostCenters.length === 1 ? userCostCenters[0] : '';
    if (po) {
      setForm({
        projectCode: po.projectCode ?? '', supplierName: po.supplierName ?? '',
        issueDate: po.issueDate ?? '', category: po.category ?? '',
        paymentTerms: po.paymentTerms ?? '', currency: po.currency ?? 'MXN',
        notes: po.notes ?? '', serviceDescription: po.serviceDescription ?? '',
        billingEntity: po.billingEntity ?? '', orderType: po.orderType ?? 'Normal',
      });
      getPoLineItems({ poId: po.id })
        .then(d => setLineItems(d.lineItems.length > 0 ? d.lineItems : [newLine()]))
        .catch(() => setLineItems([newLine()]));
    } else {
      setForm({
        projectCode: '', supplierName: '', issueDate: new Date().toISOString().split('T')[0],
        category: defaultCat, paymentTerms: '', currency: 'MXN', notes: '',
        serviceDescription: '', billingEntity: '', orderType: 'Normal',
      });
      setLineItems([newLine()]);
    }
    setDeletedIds([]);
  }, [open, po?.id]);

  const updateLine = (i: number, field: keyof LineItem, value: string | number) => {
    setLineItems(prev => prev.map((l, idx) => {
      if (idx !== i) return l;
      const updated = { ...l, [field]: value };
      if (field === 'quantity' || field === 'unitPrice') updated.total = Number(updated.quantity) * Number(updated.unitPrice);
      return updated;
    }));
  };

  const removeLine = (i: number) => {
    const item = lineItems[i];
    if (item.id) setDeletedIds(d => [...d, item.id!]);
    setLineItems(prev => prev.filter((_, idx) => idx !== i));
  };

  const total = lineItems.reduce((s, l) => s + (l.total || 0), 0);

  const doSave = async (andSubmit = false) => {
    if (andSubmit) setSavingAndSubmitting(true); else setSaving(true);
    try {
      const result = await savePurchaseOrder({ id: po?.id, ...form, totalAmount: total, lineItems, deletedLineItemIds: deletedIds });
      if (andSubmit && result?.id) {
        await submitPurchaseOrder({ id: result.id });
        toast.success('OC creada y enviada a aprobación');
      } else {
        toast.success(po ? 'OC actualizada' : 'OC guardada como borrador');
      }
      onSaved(); onClose();
    } catch (e: unknown) { toast.error((e as Error).message ?? 'Error al guardar la OC'); }
    if (andSubmit) setSavingAndSubmitting(false); else setSaving(false);
  };

  const [pendingSubmit, setPendingSubmit] = useState(false);

  const handleSave = (andSubmit = false) => {
    if (detectsAnticipo(form)) { setPendingSubmit(andSubmit); setAnticipo(true); return; }
    doSave(andSubmit);
  };

  const handleFixAndSave = () => {
    setAnticipo(false);
    setForm(f => ({ ...f, orderType: 'Anticipo' }));
    setTimeout(() => doSave(pendingSubmit), 0);
  };

  const allowedCats = userCostCenters.length > 0 ? userCostCenters : CATEGORIES;
  const showBanner = detectsAnticipo(form);

  return (
    <>
      <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
        <DialogContent className="max-w-4xl w-full p-0 gap-0 flex flex-col max-h-[90vh]" onInteractOutside={e => e.preventDefault()}>
          <DialogHeader className="px-6 py-4 border-b flex-shrink-0">
            <DialogTitle className="text-base">{po ? `Editar OC #${po.poNumber}` : 'Nueva Orden de Compra'}</DialogTitle>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="px-6 py-5 space-y-5">

              {showBanner && (
                <div className="flex items-start gap-2.5 px-4 py-3 rounded-lg bg-orange-50 border border-orange-300 dark:bg-orange-950/40 dark:border-orange-700 text-orange-800 dark:text-orange-300">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div className="text-sm leading-snug">
                    <span className="font-semibold">¿Es un anticipo?</span> Detectamos la palabra "anticipo" en la descripción o notas,
                    pero el <span className="font-semibold">Tipo de OC</span> está como <span className="font-semibold">"{form.orderType}"</span>.
                    {' '}Cambia el tipo a <button className="underline font-semibold hover:opacity-70 transition-opacity" onClick={() => setForm(f => ({ ...f, orderType: 'Anticipo' }))}>Anticipo</button> si corresponde.
                  </div>
                </div>
              )}

              {po && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 border border-border">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                  <p className="text-xs text-muted-foreground">
                    Solo se pueden editar OCs en estatus <strong>Borrador</strong>. El estatus se cambia mediante el flujo de aprobación.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Proveedor</Label>
                  <SearchableSelect
                    value={form.supplierName}
                    onChange={v => setForm(f => ({ ...f, supplierName: v }))}
                    options={suppliers.map(s => ({ value: s.supplierName, label: s.supplierName }))}
                    placeholder="Seleccionar..."
                    className="w-full h-9 text-sm min-w-0 max-w-none"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Proyecto</Label>
                  <SearchableSelect
                    value={form.projectCode || '__none__'}
                    onChange={v => setForm(f => ({ ...f, projectCode: v === '__none__' ? '' : v }))}
                    options={[{ value: '__none__', label: 'Sin proyecto' }, ...projects.map(p => ({ value: p.projectCode ?? '', label: p.projectCode ?? '', sub: p.fullName ?? '' }))]}
                    placeholder="Sin proyecto"
                    className="w-full h-9 text-sm min-w-0 max-w-none"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Rubro / Centro de costos</Label>
                  <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                    <SelectContent>{allowedCats.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Fecha de emisión</Label>
                  <Input type="date" className="h-9 text-sm" value={form.issueDate} onChange={e => setForm(f => ({ ...f, issueDate: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Moneda</Label>
                  <Select value={form.currency} onValueChange={v => setForm(f => ({ ...f, currency: v }))}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="MXN">MXN</SelectItem><SelectItem value="USD">USD</SelectItem></SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Condiciones de pago</Label>
                  <Input className="h-9 text-sm" placeholder="Ej: 30 días, Contado..." value={form.paymentTerms} onChange={e => setForm(f => ({ ...f, paymentTerms: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Tipo de OC</Label>
                  <Select value={form.orderType} onValueChange={v => setForm(f => ({ ...f, orderType: v }))}>
                    <SelectTrigger className={`h-9 text-sm ${showBanner ? 'border-orange-400 ring-1 ring-orange-300' : ''}`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Normal">Normal</SelectItem>
                      <SelectItem value="Anticipo">Anticipo</SelectItem>
                      <SelectItem value="Cierre">Cierre</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5 col-span-2">
                  <Label className="text-xs font-medium">Facturar a</Label>
                  <Select value={form.billingEntity} onValueChange={v => setForm(f => ({ ...f, billingEntity: v }))}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Seleccionar entidad..." /></SelectTrigger>
                    <SelectContent>
                      {billingEntities.map(b => (
                        <SelectItem key={b.id} value={b.companyName}>
                          <span>{b.companyName}</span>
                          {b.rfc && <span className="text-muted-foreground ml-1.5 text-xs">· {b.rfc}</span>}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Servicio / Descripción</Label>
                <Textarea className="text-sm resize-none" rows={2} value={form.serviceDescription} onChange={e => setForm(f => ({ ...f, serviceDescription: e.target.value }))} placeholder="Ej: Pago de incentivos a 20 participantes..." />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Notas internas</Label>
                <Textarea className="text-sm resize-none" rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Notas opcionales..." />
              </div>

              {/* Line items */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium">Líneas de detalle</Label>
                  <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-primary" onClick={() => setLineItems(p => [...p, newLine()])}>
                    <Plus className="w-3 h-3" /> Agregar línea
                  </Button>
                </div>
                <div className="border border-border rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Descripción</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground w-16">Cant.</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground w-32">Precio unit.</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground w-28">Total</th>
                        <th className="w-8" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {lineItems.map((line, i) => (
                        <tr key={i} className="hover:bg-muted/20">
                          <td className="px-2 py-1.5"><Input className="h-7 text-xs border-0 focus-visible:ring-0 bg-transparent" value={line.description} onChange={e => updateLine(i, 'description', e.target.value)} placeholder="Descripción..." /></td>
                          <td className="px-2 py-1.5"><Input type="number" className="h-7 text-xs border-0 focus-visible:ring-0 bg-transparent text-right w-14" value={line.quantity === 0 ? '' : line.quantity} placeholder="1" onChange={e => updateLine(i, 'quantity', e.target.value === '' ? 0 : Number(e.target.value))} min={1} /></td>
                          <td className="px-2 py-1.5"><Input type="number" className="h-7 text-xs border-0 focus-visible:ring-0 bg-transparent text-right" value={line.unitPrice === 0 ? '' : line.unitPrice} placeholder="0.00" onChange={e => updateLine(i, 'unitPrice', e.target.value === '' ? 0 : Number(e.target.value))} /></td>
                          <td className={`px-3 py-1.5 text-right font-medium ${line.total < 0 ? 'text-destructive' : line.total === 0 ? 'text-muted-foreground/50' : ''}`}>{line.total === 0 ? '—' : fmtNum(line.total)}</td>
                          <td className="px-1 py-1.5 text-center">
                            <button onClick={() => removeLine(i)} disabled={lineItems.length === 1} className="p-1 rounded text-muted-foreground hover:text-destructive disabled:opacity-20 transition-colors">
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-muted/30 border-t border-border">
                      <tr>
                        <td colSpan={3} className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground">Total {form.currency}</td>
                        <td className="px-3 py-2 text-right text-sm font-bold">{fmtNum(total)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="px-6 py-4 border-t flex gap-2 flex-shrink-0">
            <Button variant="ghost" onClick={onClose} disabled={saving || savingAndSubmitting}>Cancelar</Button>
            {po ? (
              <Button onClick={() => handleSave(false)} disabled={saving} className="gap-1.5">
                {saving ? 'Guardando...' : 'Actualizar OC'}
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => handleSave(false)} disabled={saving || savingAndSubmitting} className="gap-1.5">
                  {saving ? 'Guardando...' : 'Guardar borrador'}
                </Button>
                <Button onClick={() => handleSave(true)} disabled={saving || savingAndSubmitting} className="gap-1.5">
                  {savingAndSubmitting ? 'Enviando...' : <><Send className="w-3.5 h-3.5" /> Guardar y enviar a aprobación</>}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={anticipoWarn} onOpenChange={setAnticipo}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-orange-500" /> ¿Esta OC es un anticipo?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>Detectamos la palabra <strong>"anticipo"</strong> en la descripción o notas, pero el <strong>Tipo de OC</strong> está configurado como <strong>"{form.orderType}"</strong>.</p>
                <p>¿Qué deseas hacer?</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <AlertDialogCancel onClick={() => setAnticipo(false)}>Volver y revisar</AlertDialogCancel>
            <AlertDialogAction onClick={handleFixAndSave} className="bg-orange-500 hover:bg-orange-600 text-white">
              Cambiar a "Anticipo" y guardar
            </AlertDialogAction>
            <AlertDialogAction onClick={() => { setAnticipo(false); doSave(pendingSubmit); }}>
              Guardar como "{form.orderType}"
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
