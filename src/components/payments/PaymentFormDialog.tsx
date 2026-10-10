import { useEffect, useState } from 'react';
import { savePayment, type GetPaymentsOutputType } from 'zite-endpoints-sdk';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { fmtCurrency } from '../../lib/format';
import { motivoDelError } from '../../lib/payments/errores';

type Payment = GetPaymentsOutputType['payments'][0];
type POOption = GetPaymentsOutputType['poOptions'][0];
type BillingEntityOption = GetPaymentsOutputType['billingEntityOptions'][0];

const METHODS = ['Transferencia', 'Cheque', 'Efectivo', 'Otro'] as const;
const BANKS = ['BBVA', 'Banorte', 'Santander', 'HSBC', 'Banamex / Citibanamex', 'Scotiabank', 'Banregio', 'Inbursa', 'Afirme', 'Otro'] as const;

const emptyForm = {
  poId: '', supplierName: '', projectCode: '', amount: '' as string | number,
  currency: 'MXN', dueDate: '', method: 'Transferencia', reference: '',
  status: 'Programado', notes: '', supplierInvoiceNumber: '', destinationAccount: '',
  sourceCompany: '', sourceBank: '', sourceAccount: '',
};

type Errores = { poId?: string; amount?: string; dueDate?: string };

function MensajeError({ texto }: { texto?: string }) {
  return texto ? <p className="text-xs text-destructive">{texto}</p> : null;
}

export function PaymentFormDialog({ open, onOpenChange, editing, poOptions, billingEntityOptions, onSaved }: {
  open: boolean; onOpenChange: (v: boolean) => void; editing: Payment | null;
  poOptions: POOption[]; billingEntityOptions: BillingEntityOption[]; onSaved: () => void;
}) {
  const [form, setForm] = useState({ ...emptyForm });
  const [errores, setErrores] = useState<Errores>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrores({});
    if (editing) {
      setForm({
        poId: editing.poId ?? '', supplierName: editing.supplierName ?? '',
        projectCode: editing.projectCode ?? '', amount: editing.amount ?? '',
        currency: editing.currency ?? 'MXN',
        dueDate: editing.dueDate ?? '', method: editing.method ?? '',
        reference: editing.reference ?? '', status: editing.status ?? 'Programado',
        notes: editing.notes ?? '', supplierInvoiceNumber: editing.supplierInvoiceNumber ?? '',
        destinationAccount: editing.destinationAccount ?? '',
        sourceCompany: editing.sourceCompany ?? '', sourceBank: editing.sourceBank ?? '',
        sourceAccount: editing.sourceAccount ?? '',
      });
    } else {
      // Un pago que apenas se programa no tiene fecha real de pago: esa se pone al registrarlo.
      setForm({ ...emptyForm });
    }
  }, [open, editing]);

  const selectedPO = poOptions.find(p => p.id === form.poId);
  const handlePoSelect = (poId: string) => {
    const po = poOptions.find(p => p.id === poId);
    setErrores(e => ({ ...e, poId: undefined }));
    setForm(f => ({
      ...f,
      poId,
      supplierName: po?.supplierName ?? f.supplierName,
      projectCode: po?.projectCode ?? f.projectCode,
      sourceCompany: f.sourceCompany || po?.billingEntity || f.sourceCompany,
    }));
  };

  // Lo mínimo para que el pago exista de verdad: antes se podía guardar vacío y quedaba un pago sin ODC, monto ni fecha.
  const validar = (): boolean => {
    const e: Errores = {};
    if (!form.poId) e.poId = 'Elige la ODC.';
    if (!(Number(form.amount) > 0)) e.amount = 'Escribe un monto mayor a cero.';
    if (!form.dueDate) e.dueDate = 'Pon la fecha comprometida.';
    setErrores(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    if (!validar()) return;
    setSaving(true);
    try {
      await savePayment({
        id: editing?.id,
        poId: form.poId || undefined,
        supplierName: form.supplierName || undefined,
        projectCode: form.projectCode || undefined,
        amount: Number(form.amount) || undefined,
        currency: form.currency || undefined,
        dueDate: form.dueDate || undefined,
        method: form.method || undefined,
        reference: form.reference || undefined,
        status: form.status || undefined,
        notes: form.notes || undefined,
        supplierInvoiceNumber: form.supplierInvoiceNumber || undefined,
        destinationAccount: form.destinationAccount || undefined,
        sourceCompany: form.sourceCompany || undefined,
        sourceBank: form.sourceBank || undefined,
        sourceAccount: form.sourceAccount || undefined,
      });
      toast.success('Pago guardado');
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(motivoDelError(e, 'No se pudo guardar el pago'));
    }
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{editing ? `Editar ${String(editing.paymentId ?? 'pago')}` : 'Nuevo pago'}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-4 py-2">

          {/* ODC */}
          <div className="col-span-2 space-y-1.5">
            <Label>ODC vinculada</Label>
            <Select value={form.poId} onValueChange={handlePoSelect}>
              <SelectTrigger className={errores.poId ? 'border-destructive' : ''}><SelectValue placeholder="Seleccionar orden de compra…" /></SelectTrigger>
              <SelectContent>{poOptions.map(po => <SelectItem key={po.id} value={po.id}>{po.poNumber} · {po.supplierName} · {fmtCurrency(po.totalAmount)}</SelectItem>)}</SelectContent>
            </Select>
            <MensajeError texto={errores.poId} />
            {selectedPO && <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 rounded-lg text-xs"><span className="text-muted-foreground">Saldo pendiente:</span><span className="font-bold text-primary">{fmtCurrency(selectedPO.pendingAmount)}</span></div>}
          </div>

          {/* Amount / Currency */}
          <div className="space-y-1.5">
            <Label>Monto</Label>
            <Input type="number" value={form.amount} className={errores.amount ? 'border-destructive' : ''} onChange={e => { setErrores(x => ({ ...x, amount: undefined })); setForm(f => ({ ...f, amount: e.target.value })); }} />
            <MensajeError texto={errores.amount} />
          </div>
          <div className="space-y-1.5"><Label>Moneda</Label><Select value={form.currency} onValueChange={v => setForm(f => ({ ...f, currency: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="MXN">MXN</SelectItem><SelectItem value="USD">USD</SelectItem></SelectContent></Select></div>

          {/* Date */}
          <div className="space-y-1.5">
            <Label>Fecha comprometida</Label>
            <Input type="date" value={form.dueDate} className={errores.dueDate ? 'border-destructive' : ''} onChange={e => { setErrores(x => ({ ...x, dueDate: undefined })); setForm(f => ({ ...f, dueDate: e.target.value })); }} />
            <MensajeError texto={errores.dueDate} />
          </div>
          <div className="space-y-1.5"><Label>Método de pago</Label><Select value={form.method} onValueChange={v => setForm(f => ({ ...f, method: v }))}><SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger><SelectContent>{METHODS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent></Select></div>

          {/* Reference / Invoice */}
          <div className="space-y-1.5"><Label>Referencia bancaria</Label><Input value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} /></div>
          <div className="space-y-1.5"><Label># Factura del proveedor</Label><Input value={form.supplierInvoiceNumber} onChange={e => setForm(f => ({ ...f, supplierInvoiceNumber: e.target.value }))} /></div>

          {/* Destination account */}
          <div className="col-span-2 space-y-1.5"><Label>Cuenta bancaria destino</Label><Input value={form.destinationAccount} onChange={e => setForm(f => ({ ...f, destinationAccount: e.target.value }))} /></div>

          {/* Divider: source */}
          <div className="col-span-2 border-t pt-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Origen del pago</p>
          </div>

          {/* Source company */}
          <div className="col-span-2 space-y-1.5">
            <Label>Empresa pagadora</Label>
            <Select value={form.sourceCompany} onValueChange={v => setForm(f => ({ ...f, sourceCompany: v }))}>
              <SelectTrigger><SelectValue placeholder="Seleccionar empresa…" /></SelectTrigger>
              <SelectContent>
                {billingEntityOptions.map(b => <SelectItem key={b.id} value={b.companyName}>{b.companyName}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Source bank */}
          <div className="space-y-1.5">
            <Label>Banco origen</Label>
            <Select value={form.sourceBank} onValueChange={v => setForm(f => ({ ...f, sourceBank: v }))}>
              <SelectTrigger><SelectValue placeholder="Seleccionar banco…" /></SelectTrigger>
              <SelectContent>
                {BANKS.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Source account */}
          <div className="space-y-1.5">
            <Label>Cuenta origen</Label>
            <Input placeholder="Ej. 0123456789" value={form.sourceAccount} onChange={e => setForm(f => ({ ...f, sourceAccount: e.target.value }))} />
          </div>

          {/* Notes */}
          <div className="col-span-2 space-y-1.5"><Label>Notas</Label><Textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Guardando…' : 'Guardar pago'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
