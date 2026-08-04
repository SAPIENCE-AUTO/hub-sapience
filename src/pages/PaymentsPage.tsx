import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  getPayments, savePayment, deletePayment, bulkUpdatePayments, bulkDeletePayments,
  GetPaymentsOutputType,
} from 'zite-endpoints-sdk';
import { uploadFile } from 'zite-file-upload-sdk';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import { PaymentDetailDialog } from '@/components/payments/PaymentDetailDialog';
import { fmtCurrency } from '../lib/format';
import {
  Plus, Pencil, Trash2, CreditCard, CalendarCheck, Clock, CheckCircle,
  Paperclip, CalendarDays, List, ChevronLeft, ChevronRight, AlertCircle, Upload, X, Search,
} from 'lucide-react';

type Payment = GetPaymentsOutputType['payments'][0];
type POOption = GetPaymentsOutputType['poOptions'][0];
type BillingEntityOption = GetPaymentsOutputType['billingEntityOptions'][0];
type DateFilter = 'all' | 'overdue' | 'today' | 'tomorrow' | 'next3' | 'thisweek' | 'nextweek' | 'thismonth';

const METHODS = ['Transferencia', 'Cheque', 'Efectivo', 'Otro'] as const;
const STATUSES = ['Programado', 'Realizado', 'Cancelado'] as const;
const BANKS = ['BBVA', 'Banorte', 'Santander', 'HSBC', 'Banamex / Citibanamex', 'Scotiabank', 'Banregio', 'Inbursa', 'Afirme', 'Otro'] as const;


function fmtDate(d?: string) {
  if (!d) return '—';
  return new Date(d.split('T')[0] + 'T12:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}
function getToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }

function matchesDateFilter(p: Payment, filter: DateFilter): boolean {
  if (filter === 'all') return true;
  if (!p.dueDate) return false;
  const due = new Date(p.dueDate.split('T')[0] + 'T12:00:00'); due.setHours(0, 0, 0, 0);
  const today = getToday();
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  switch (filter) {
    case 'overdue': return due < today && p.status === 'Programado';
    case 'today': return due.getTime() === today.getTime();
    case 'tomorrow': return due.getTime() === tomorrow.getTime();
    case 'next3': { const end = new Date(today); end.setDate(today.getDate() + 3); return due >= today && due <= end; }
    case 'thisweek': {
      const dow = today.getDay();
      const start = new Date(today); start.setDate(today.getDate() - dow);
      const end = new Date(start); end.setDate(start.getDate() + 6);
      return due >= start && due <= end;
    }
    case 'nextweek': {
      const dow = today.getDay();
      const start = new Date(today); start.setDate(today.getDate() + (7 - dow));
      const end = new Date(start); end.setDate(start.getDate() + 6);
      return due >= start && due <= end;
    }
    case 'thismonth': { const t = getToday(); return due.getMonth() === t.getMonth() && due.getFullYear() === t.getFullYear(); }
    default: return true;
  }
}

const STATUS_STYLES: Record<string, string> = {
  'Programado': 'bg-yellow-100 text-yellow-700 border-yellow-200',
  'Realizado': 'bg-green-100 text-green-700 border-green-200',
  'Cancelado': 'bg-red-100 text-red-700 border-red-200',
};
const STATUS_BORDER: Record<string, string> = {
  'Programado': 'border-yellow-400',
  'Realizado': 'border-green-500',
  'Cancelado': 'border-red-400',
};

function CurrencyBadge({ currency }: { currency?: string }) {
  if (!currency) return null;
  const styles: Record<string, string> = { MXN: 'bg-blue-100 text-blue-700 border-blue-200', USD: 'bg-green-100 text-green-700 border-green-200' };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${styles[currency] ?? 'bg-muted text-muted-foreground border-border'}`}>{currency}</span>;
}

function StatCard({ icon: Icon, label, value, color }: { icon: React.ElementType; label: string; value: string; color?: string }) {
  return (
    <div className="bg-card border rounded-xl p-4 flex items-center gap-4">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${color ?? 'bg-primary/10'}`}>
        <Icon className={`w-5 h-5 ${color ? 'text-white' : 'text-primary'}`} />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-bold mt-0.5">{value}</p>
      </div>
    </div>
  );
}

function InlineStatusSelect({ payment, onChanged }: { payment: Payment; onChanged: (id: string, status: string) => Promise<void> }) {
  const [loading, setLoading] = useState(false);
  const handleChange = async (v: string) => {
    setLoading(true);
    await onChanged(payment.id, v);
    setLoading(false);
  };
  return (
    <div onClick={e => e.stopPropagation()}>
      {loading ? (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-muted text-muted-foreground border-border animate-pulse">
          {payment.status ?? '—'}
        </span>
      ) : (
        <Select value={payment.status ?? ''} onValueChange={handleChange}>
          <SelectTrigger className={`h-auto border px-2 py-0.5 rounded-full text-[10px] font-semibold w-auto gap-1 focus:ring-0 ${STATUS_STYLES[payment.status ?? ''] ?? 'bg-muted text-muted-foreground border-border'}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

function InlineUploadButton({ payment, onUploaded }: { payment: Payment; onUploaded: (id: string, url: string) => Promise<void> }) {
  const [loading, setLoading] = useState(false);
  const hasAttachment = (payment.attachment ?? []).length > 0;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (loading) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,application/pdf';
    input.onchange = async (ev) => {
      const file = (ev.target as HTMLInputElement).files?.[0];
      if (!file) return;
      setLoading(true);
      try {
        const { fileUrl } = await uploadFile({ data: file, filename: file.name });
        await onUploaded(payment.id, fileUrl);
        toast.success('Comprobante subido');
      } catch {
        toast.error('Error al subir el archivo');
      }
      setLoading(false);
    };
    input.click();
  };

  return (
    <Button
      size="icon" variant="ghost"
      className={`h-7 w-7 shrink-0 ${hasAttachment ? 'text-green-600 hover:text-green-700' : 'text-muted-foreground'}`}
      onClick={handleClick}
      disabled={loading}
      title={hasAttachment ? 'Reemplazar comprobante' : 'Subir comprobante'}
    >
      {loading ? (
        <span className="animate-spin w-3 h-3 border-2 border-current border-t-transparent rounded-full" />
      ) : hasAttachment ? (
        <Paperclip className="w-3.5 h-3.5" />
      ) : (
        <Upload className="w-3.5 h-3.5" />
      )}
    </Button>
  );
}

// ── Calendar View ─────────────────────────────────────────────────────────────
function CalendarView({ payments, onSelect }: { payments: Payment[]; onSelect: (p: Payment) => void }) {
  const [current, setCurrent] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const year = current.getFullYear();
  const month = current.getMonth();
  const today = getToday();

  const paymentsByDay = useMemo(() => {
    const map: Record<string, Payment[]> = {};
    payments.forEach(p => {
      if (!p.dueDate) return;
      (map[p.dueDate.split('T')[0]] ??= []).push(p);
    });
    return map;
  }, [payments]);

  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  const dayKey = (d: number) => `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  return (
    <div className="bg-card border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
        <button onClick={() => setCurrent(new Date(year, month - 1, 1))} className="p-1.5 rounded-lg hover:bg-muted transition-colors"><ChevronLeft className="w-4 h-4" /></button>
        <h3 className="text-sm font-semibold capitalize">{current.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })}</h3>
        <button onClick={() => setCurrent(new Date(year, month + 1, 1))} className="p-1.5 rounded-lg hover:bg-muted transition-colors"><ChevronRight className="w-4 h-4" /></button>
      </div>
      <div className="flex items-center justify-center gap-4 px-4 py-2 border-b bg-muted/10">
        {[['bg-yellow-400', 'Programado'], ['bg-green-500', 'Realizado'], ['bg-red-400', 'Cancelado']].map(([c, l]) => (
          <span key={l} className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><span className={`w-3 h-1 rounded-full ${c}`} />{l}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 border-b">
        {['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'].map(d => <div key={d} className="text-center text-xs font-semibold text-muted-foreground py-2">{d}</div>)}
      </div>
      {weeks.map((week, wi) => (
        <div key={wi} className="grid grid-cols-7 border-b last:border-0 divide-x divide-border">
          {week.map((day, di) => {
            if (!day) return <div key={di} className="min-h-[110px] bg-muted/10" />;
            const key = dayKey(day);
            const dayPayments = paymentsByDay[key] ?? [];
            const cellDate = new Date(year, month, day);
            const isToday = cellDate.getTime() === today.getTime();
            const isPast = cellDate < today;
            const hasOverdue = isPast && dayPayments.some(p => p.status === 'Programado');
            return (
              <div key={di} className={`min-h-[110px] p-1.5 ${isToday ? 'bg-primary/5' : ''}`}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className={`text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full ${isToday ? 'bg-primary text-primary-foreground' : isPast ? 'text-muted-foreground' : 'text-foreground'}`}>{day}</span>
                  {hasOverdue && <AlertCircle className="w-3 h-3 text-destructive" />}
                </div>
                <div className="space-y-0.5">
                  {dayPayments.slice(0, 3).map(p => (
                    <button key={p.id} onClick={() => onSelect(p)} className={`w-full text-left px-1.5 py-1 rounded border-l-2 bg-muted/50 hover:bg-muted transition-colors ${STATUS_BORDER[p.status ?? ''] ?? 'border-border'}`}>
                      <p className="text-[10px] font-medium truncate leading-tight">{p.supplierName ?? '—'}</p>
                      <p className="text-[10px] text-muted-foreground leading-tight">{fmtCurrency(p.amount, p.currency)}</p>
                    </button>
                  ))}
                  {dayPayments.length > 3 && <p className="text-[10px] text-muted-foreground pl-1">+{dayPayments.length - 3} más</p>}
                </div>
                {dayPayments.length > 0 && (
                  <div className="mt-1.5 pt-1 border-t border-border/40">
                    <p className="text-[10px] font-semibold text-muted-foreground text-right">
                      {fmtCurrency(dayPayments.reduce((s, p) => s + (p.amount ?? 0), 0))}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ── Payment Form Dialog ───────────────────────────────────────────────────────
const emptyForm = {
  poId: '', supplierName: '', projectCode: '', amount: '' as string | number,
  currency: 'MXN', paymentDate: '', dueDate: '', method: 'Transferencia', reference: '',
  status: 'Programado', notes: '', supplierInvoiceNumber: '', destinationAccount: '',
  sourceCompany: '', sourceBank: '', sourceAccount: '',
};

function PaymentFormDialog({ open, onOpenChange, editing, poOptions, billingEntityOptions, onSaved }: {
  open: boolean; onOpenChange: (v: boolean) => void; editing: Payment | null;
  poOptions: POOption[]; billingEntityOptions: BillingEntityOption[]; onSaved: () => void;
}) {
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setForm({
        poId: editing.poId ?? '', supplierName: editing.supplierName ?? '',
        projectCode: editing.projectCode ?? '', amount: editing.amount ?? '',
        currency: editing.currency ?? 'MXN', paymentDate: editing.paymentDate ?? '',
        dueDate: editing.dueDate ?? '', method: editing.method ?? '',
        reference: editing.reference ?? '', status: editing.status ?? 'Programado',
        notes: editing.notes ?? '', supplierInvoiceNumber: editing.supplierInvoiceNumber ?? '',
        destinationAccount: editing.destinationAccount ?? '',
        sourceCompany: editing.sourceCompany ?? '', sourceBank: editing.sourceBank ?? '',
        sourceAccount: editing.sourceAccount ?? '',
      });
    } else {
      setForm({ ...emptyForm, paymentDate: new Date().toISOString().split('T')[0] });
    }
  }, [open, editing]);

  const selectedPO = poOptions.find(p => p.id === form.poId);
  const handlePoSelect = (poId: string) => {
    const po = poOptions.find(p => p.id === poId);
    setForm(f => ({
      ...f,
      poId,
      supplierName: po?.supplierName ?? f.supplierName,
      projectCode: po?.projectCode ?? f.projectCode,
      sourceCompany: f.sourceCompany || po?.billingEntity || f.sourceCompany,
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await savePayment({
        id: editing?.id,
        poId: form.poId || undefined,
        supplierName: form.supplierName || undefined,
        projectCode: form.projectCode || undefined,
        amount: Number(form.amount) || undefined,
        currency: form.currency || undefined,
        paymentDate: form.paymentDate || undefined,
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
    } catch { toast.error('Error al guardar'); }
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
              <SelectTrigger><SelectValue placeholder="Seleccionar orden de compra…" /></SelectTrigger>
              <SelectContent>{poOptions.map(po => <SelectItem key={po.id} value={po.id}>ODC-{po.poNumber} · {po.supplierName} · {fmtCurrency(po.totalAmount)}</SelectItem>)}</SelectContent>
            </Select>
            {selectedPO && <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 rounded-lg text-xs"><span className="text-muted-foreground">Saldo pendiente:</span><span className="font-bold text-primary">{fmtCurrency(selectedPO.pendingAmount)}</span></div>}
          </div>

          {/* Amount / Currency */}
          <div className="space-y-1.5"><Label>Monto</Label><Input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} /></div>
          <div className="space-y-1.5"><Label>Moneda</Label><Select value={form.currency} onValueChange={v => setForm(f => ({ ...f, currency: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="MXN">MXN</SelectItem><SelectItem value="USD">USD</SelectItem></SelectContent></Select></div>

          {/* Dates */}
          <div className="space-y-1.5"><Label>Fecha comprometida</Label><Input type="date" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} /></div>
          <div className="space-y-1.5"><Label>Fecha de pago real</Label><Input type="date" value={form.paymentDate} onChange={e => setForm(f => ({ ...f, paymentDate: e.target.value }))} /></div>

          {/* Method / Reference */}
          <div className="space-y-1.5"><Label>Método de pago</Label><Select value={form.method} onValueChange={v => setForm(f => ({ ...f, method: v }))}><SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger><SelectContent>{METHODS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1.5"><Label>Referencia bancaria</Label><Input value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} /></div>

          {/* Invoice / Destination account */}
          <div className="space-y-1.5"><Label># Factura del proveedor</Label><Input value={form.supplierInvoiceNumber} onChange={e => setForm(f => ({ ...f, supplierInvoiceNumber: e.target.value }))} /></div>
          <div className="space-y-1.5"><Label>Cuenta bancaria destino</Label><Input value={form.destinationAccount} onChange={e => setForm(f => ({ ...f, destinationAccount: e.target.value }))} /></div>

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

// ── Date filter labels ────────────────────────────────────────────────────────
const DATE_FILTER_LABELS: { key: DateFilter; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'overdue', label: 'Vencidos' },
  { key: 'today', label: 'Hoy' },
  { key: 'tomorrow', label: 'Mañana' },
  { key: 'next3', label: 'Próx. 3 días' },
  { key: 'thisweek', label: 'Esta semana' },
  { key: 'nextweek', label: 'Próxima semana' },
  { key: 'thismonth', label: 'Este mes' },
];

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function PaymentsPage() {
  const [data, setData] = useState<GetPaymentsOutputType>({ payments: [], poOptions: [], billingEntityOptions: [] });
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'table' | 'calendar'>('table');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterSupplier, setFilterSupplier] = useState('all');
  const [filterProject, setFilterProject] = useState('all');
  const [search, setSearch] = useState('');

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Detail dialog
  const [viewing, setViewing] = useState<Payment | null>(null);
  const [openDetailDialog, setOpenDetailDialog] = useState(false);

  // Form dialog
  const [editing, setEditing] = useState<Payment | null>(null);
  const [openFormDialog, setOpenFormDialog] = useState(false);

  // Delete confirmations
  const [deleting, setDeleting] = useState<Payment | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkStatusTarget, setBulkStatusTarget] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    getPayments({}).then(d => { setData(d); setLoading(false); });
  }, []);

  useEffect(() => { load(); }, [load]);

  const { payments } = data;
  const suppliers = useMemo(() => [...new Set(payments.map(p => p.supplierName).filter(Boolean))].sort() as string[], [payments]);
  const projects = useMemo(() => [...new Set(payments.map(p => p.projectCode).filter(Boolean))].sort() as string[], [payments]);
  const overdueCount = useMemo(() => payments.filter(p => matchesDateFilter(p, 'overdue')).length, [payments]);

  const filtered = useMemo(() => payments.filter(p => {
    if (!matchesDateFilter(p, dateFilter)) return false;
    if (filterStatus !== 'all' && p.status !== filterStatus) return false;
    if (filterSupplier !== 'all' && p.supplierName !== filterSupplier) return false;
    if (filterProject !== 'all' && p.projectCode !== filterProject) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        String(p.paymentId ?? '').toLowerCase().includes(q) ||
        (p.supplierName ?? '').toLowerCase().includes(q) ||
        (p.reference ?? '').toLowerCase().includes(q) ||
        (p.projectCode ?? '').toLowerCase().includes(q) ||
        (p.poNumber ?? '').toLowerCase().includes(q) ||
        (p.supplierInvoiceNumber ?? '').toLowerCase().includes(q) ||
        (p.sourceCompany ?? '').toLowerCase().includes(q)
      );
    }
    return true;
  }), [payments, dateFilter, filterStatus, filterSupplier, filterProject, search]);

  const totalProgramado = payments.filter(p => p.status === 'Programado').reduce((s, p) => s + (p.amount ?? 0), 0);
  const totalRealizado = payments.filter(p => p.status === 'Realizado').reduce((s, p) => s + (p.amount ?? 0), 0);

  const allFilteredSelected = filtered.length > 0 && filtered.every(p => selectedIds.has(p.id));
  const someSelected = selectedIds.size > 0;

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedIds(prev => { const n = new Set(prev); filtered.forEach(p => n.delete(p.id)); return n; });
    } else {
      setSelectedIds(prev => { const n = new Set(prev); filtered.forEach(p => n.add(p.id)); return n; });
    }
  };
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const handleInlineStatusChange = async (id: string, status: string) => {
    setData(prev => ({ ...prev, payments: prev.payments.map(p => p.id === id ? { ...p, status } : p) }));
    try {
      await savePayment({ id, status });
    } catch {
      toast.error('Error al actualizar status');
      load();
    }
  };

  const handleInlineUpload = async (id: string, url: string) => {
    const payment = payments.find(p => p.id === id);
    const existing = payment?.attachment ?? [];
    const attachment = [...existing, { url }];
    setData(prev => ({ ...prev, payments: prev.payments.map(p => p.id === id ? { ...p, attachment } : p) }));
    try {
      await savePayment({ id, attachment });
      if (viewing?.id === id) setViewing(v => v ? { ...v, attachment } : v);
    } catch {
      toast.error('Error al guardar comprobante');
      load();
    }
  };

  const handleBulkStatus = async (status: string) => {
    setBulkStatusTarget('');
    const ids = [...selectedIds];
    setData(prev => ({ ...prev, payments: prev.payments.map(p => ids.includes(p.id) ? { ...p, status } : p) }));
    try {
      await bulkUpdatePayments({ ids, status });
      toast.success(`${ids.length} pago${ids.length !== 1 ? 's' : ''} actualizados a "${status}"`);
      setSelectedIds(new Set());
    } catch {
      toast.error('Error al actualizar pagos');
      load();
    }
  };

  const handleBulkDelete = async () => {
    setBulkDeleting(false);
    const ids = [...selectedIds];
    try {
      await bulkDeletePayments({ ids });
      toast.success(`${ids.length} pago${ids.length !== 1 ? 's' : ''} eliminados`);
      setSelectedIds(new Set());
      load();
    } catch {
      toast.error('Error al eliminar pagos');
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    await deletePayment({ id: deleting.id });
    toast.success('Pago eliminado');
    setDeleting(null);
    setOpenDetailDialog(false);
    load();
  };

  const openDetail = (p: Payment) => { setViewing(p); setOpenDetailDialog(true); };
  const openEdit = (p: Payment) => { setEditing(p); setOpenDetailDialog(false); setOpenFormDialog(true); };

  const hasFilters = search || filterStatus !== 'all' || filterSupplier !== 'all' || filterProject !== 'all' || dateFilter !== 'all';

  return (
    <div className="p-6 max-w-[1400px] mx-auto pb-24">
      <Toaster />

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">Pagos a proveedores</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {loading ? 'Cargando…' : `${payments.length} pago${payments.length !== 1 ? 's' : ''} registrado${payments.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-muted rounded-lg p-1 gap-0.5">
            <button onClick={() => setViewMode('table')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${viewMode === 'table' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              <List className="w-3.5 h-3.5" /> Tabla
            </button>
            <button onClick={() => setViewMode('calendar')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${viewMode === 'calendar' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              <CalendarDays className="w-3.5 h-3.5" /> Calendario
            </button>
          </div>
          <Button className="gap-2" onClick={() => { setEditing(null); setOpenFormDialog(true); }}>
            <Plus className="w-4 h-4" /> Nuevo pago
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        <StatCard icon={Clock} label="Total programado" value={fmtCurrency(totalProgramado)} />
        <StatCard icon={CheckCircle} label="Total pagado" value={fmtCurrency(totalRealizado)} color="bg-green-500" />
        <StatCard icon={CalendarCheck} label="Por pagar" value={fmtCurrency(Math.max(0, totalProgramado - totalRealizado))} color="bg-orange-500" />
      </div>

      {/* Search bar */}
      {!loading && (
        <div className="flex items-center gap-3 mb-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              className="pl-9 h-9 text-sm"
              placeholder="Buscar por # pago, proveedor, referencia…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          {hasFilters && (
            <Button variant="ghost" size="sm" className="h-9 text-xs gap-1.5" onClick={() => { setSearch(''); setFilterStatus('all'); setFilterSupplier('all'); setFilterProject('all'); setDateFilter('all'); }}>
              <X className="w-3.5 h-3.5" /> Limpiar filtros
            </Button>
          )}
        </div>
      )}

      {/* Date quick filters */}
      {!loading && payments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {DATE_FILTER_LABELS.map(({ key, label }) => {
            const isActive = dateFilter === key;
            const isOverdue = key === 'overdue';
            const count = key === 'all' ? payments.length : payments.filter(p => matchesDateFilter(p, key)).length;
            return (
              <button key={key} onClick={() => setDateFilter(key)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${isActive
                  ? isOverdue ? 'bg-destructive text-destructive-foreground border-destructive' : 'bg-primary text-primary-foreground border-primary'
                  : isOverdue && overdueCount > 0 ? 'bg-destructive/10 text-destructive border-destructive/30 hover:bg-destructive/20' : 'bg-card text-muted-foreground border-border hover:border-primary hover:text-foreground'
                }`}>
                {label}{key !== 'all' && ` (${count})`}
              </button>
            );
          })}
        </div>
      )}

      {/* Status/supplier/project filters */}
      {!loading && payments.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {(['all', 'Programado', 'Realizado', 'Cancelado'] as const).map(s => {
            const count = s === 'all' ? payments.length : payments.filter(p => p.status === s).length;
            const active = filterStatus === s;
            return (
              <button key={s} onClick={() => setFilterStatus(s)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${active ? (s === 'all' ? 'bg-primary text-primary-foreground border-primary' : STATUS_STYLES[s]) : 'bg-card text-muted-foreground border-border hover:border-primary'}`}>
                {s === 'all' ? 'Todos los status' : s} ({count})
              </button>
            );
          })}
          {suppliers.length > 0 && (
            <Select value={filterSupplier} onValueChange={setFilterSupplier}>
              <SelectTrigger className="h-7 text-xs w-auto min-w-[140px]"><SelectValue placeholder="Proveedor" /></SelectTrigger>
              <SelectContent><SelectItem value="all">Todos los proveedores</SelectItem>{suppliers.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          )}
          {projects.length > 0 && (
            <Select value={filterProject} onValueChange={setFilterProject}>
              <SelectTrigger className="h-7 text-xs w-auto min-w-[120px]"><SelectValue placeholder="Proyecto" /></SelectTrigger>
              <SelectContent><SelectItem value="all">Todos los proyectos</SelectItem>{projects.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
            </Select>
          )}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="space-y-2">{[1,2,3,4].map(i => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : viewMode === 'calendar' ? (
        <CalendarView payments={filtered} onSelect={openDetail} />
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center bg-card border rounded-xl">
          <CreditCard className="w-14 h-14 text-muted-foreground/30 mb-4" />
          <p className="text-base font-semibold mb-1">{payments.length === 0 ? 'No hay pagos registrados aún' : 'Sin resultados para este filtro'}</p>
          <p className="text-sm text-muted-foreground mb-5">{payments.length === 0 ? 'Registra el primer pago.' : 'Ajusta los filtros o la búsqueda.'}</p>
          {payments.length === 0 && <Button onClick={() => { setEditing(null); setOpenFormDialog(true); }} className="gap-2"><Plus className="w-4 h-4" /> Nuevo pago</Button>}
        </div>
      ) : (
        <div className="bg-card border rounded-xl overflow-hidden">
          <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-380px)]">
          <table className="w-full text-sm">
            <thead className="bg-muted sticky top-0 z-10">
              <tr>
                <th className="px-4 py-3 w-10">
                  <Checkbox checked={allFilteredSelected} onCheckedChange={toggleSelectAll} aria-label="Seleccionar todos" />
                </th>
                {['# Pago','ODC','Proveedor','Empresa origen','Proyecto','Monto','Moneda','Fecha comprometida','Pago real','Método','Status','Referencia',''].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map(p => {
                const isSelected = selectedIds.has(p.id);
                const isOverdue = matchesDateFilter(p, 'overdue');
                return (
                  <tr
                    key={p.id}
                    className={`hover:bg-muted/30 transition-colors cursor-pointer ${isSelected ? 'bg-primary/5' : ''}`}
                    onClick={() => openDetail(p)}
                  >
                    <td className="px-4 py-3 w-10" onClick={e => { e.stopPropagation(); toggleSelect(p.id); }}>
                      <Checkbox checked={isSelected} onCheckedChange={() => toggleSelect(p.id)} aria-label="Seleccionar fila" />
                    </td>
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-primary whitespace-nowrap">{String(p.paymentId ?? '—')}</td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap">{p.poNumber ? `ODC-${p.poNumber}` : '—'}</td>
                    <td className="px-4 py-3 font-medium whitespace-nowrap max-w-[140px] truncate">{p.supplierName ?? '—'}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap max-w-[130px] truncate">{p.sourceCompany ?? '—'}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{p.projectCode ?? '—'}</td>
                    <td className="px-4 py-3 font-bold whitespace-nowrap">{fmtCurrency(p.amount, p.currency)}</td>
                    <td className="px-4 py-3"><CurrencyBadge currency={p.currency} /></td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap">
                      {isOverdue ? (
                        <span className="flex items-center gap-1.5">
                          <span className="text-destructive font-semibold">{fmtDate(p.dueDate)}</span>
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-destructive/10 text-destructive border border-destructive/20 leading-none">Vencido</span>
                        </span>
                      ) : <span>{fmtDate(p.dueDate)}</span>}
                    </td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap text-muted-foreground">{fmtDate(p.paymentDate)}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{p.method || 'Transferencia'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${STATUS_STYLES[p.status ?? ''] ?? 'bg-muted text-muted-foreground border-border'}`}>
                        {p.status ?? '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground font-mono whitespace-nowrap">{p.reference ?? '—'}</td>
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-0.5">
                        <InlineUploadButton payment={p} onUploaded={handleInlineUpload} />
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(p)}><Pencil className="w-3 h-3" /></Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* Bulk action bar */}
      {someSelected && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-card border shadow-2xl rounded-2xl px-5 py-3 flex items-center gap-3 flex-wrap">
          <span className="text-sm font-semibold shrink-0">{selectedIds.size} seleccionado{selectedIds.size !== 1 ? 's' : ''}</span>
          <div className="w-px h-5 bg-border" />
          <Button variant="destructive" size="sm" className="gap-1.5 h-8" onClick={() => setBulkDeleting(true)}>
            <Trash2 className="w-3.5 h-3.5" /> Eliminar
          </Button>
          <Button variant="ghost" size="sm" className="gap-1.5 h-8" onClick={() => setSelectedIds(new Set())}>
            <X className="w-3.5 h-3.5" /> Deseleccionar
          </Button>
        </div>
      )}

      {/* Modals */}
      <PaymentDetailDialog
        payment={viewing}
        open={openDetailDialog}
        onOpenChange={setOpenDetailDialog}
        onEdit={() => viewing && openEdit(viewing)}
        onDelete={() => setDeleting(viewing)}
        onAttachmentUploaded={(attachment) => {
          if (!viewing) return;
          const updated = { ...viewing, attachment };
          setViewing(updated);
          setData(prev => ({ ...prev, payments: prev.payments.map(p => p.id === viewing.id ? updated : p) }));
        }}
        onPaymentUpdated={(updates) => {
          if (!viewing) return;
          const updated = { ...viewing, ...updates };
          setViewing(updated);
          setData(prev => ({ ...prev, payments: prev.payments.map(p => p.id === viewing.id ? updated : p) }));
        }}
      />
      <PaymentFormDialog
        open={openFormDialog}
        onOpenChange={setOpenFormDialog}
        editing={editing}
        poOptions={data.poOptions}
        billingEntityOptions={data.billingEntityOptions}
        onSaved={load}
      />

      {/* Single delete */}
      <AlertDialog open={!!deleting} onOpenChange={o => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar pago?</AlertDialogTitle>
            <AlertDialogDescription>Esta acción no se puede deshacer.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk delete */}
      <AlertDialog open={bulkDeleting} onOpenChange={setBulkDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar {selectedIds.size} pago{selectedIds.size !== 1 ? 's' : ''}?</AlertDialogTitle>
            <AlertDialogDescription>Esta acción no se puede deshacer.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleBulkDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
