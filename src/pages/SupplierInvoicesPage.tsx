import { useState, useEffect, useMemo, useRef } from 'react';
import { getSupplierInvoices, getSupplierInvoiceById, reviewSupplierInvoice, getPoLineItems, GetSupplierInvoicesOutputType, GetSupplierInvoiceByIdOutputType, GetPoLineItemsOutputType } from 'zite-endpoints-sdk';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import {
  FileText, CheckCircle2, Clock, XCircle, ExternalLink,
  AlertCircle, FileX, ChevronDown, ChevronRight, Bell,
} from 'lucide-react';

type InvoiceListItem = GetSupplierInvoicesOutputType['invoices'][0];
type InvoiceDetail = NonNullable<GetSupplierInvoiceByIdOutputType['invoice']>;
type Stats = GetSupplierInvoicesOutputType['stats'];

const STATUS_STYLES: Record<string, string> = {
  'Pendiente':   'bg-orange-100 text-orange-700 border-orange-200',
  'En revisión': 'bg-blue-100 text-blue-700 border-blue-200',
  'Validada':    'bg-green-100 text-green-700 border-green-200',
  'Rechazada':   'bg-red-100 text-red-700 border-red-200',
};

function fmtCurrency(amount?: number, currency?: string) {
  if (!amount) return '—';
  return `${currency === 'USD' ? 'USD ' : '$'}${amount.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtDate(s?: string) { if (!s) return '—'; return new Date(s).toLocaleDateString('es-MX'); }

function isNew(uploadDate?: string | null) {
  if (!uploadDate) return false;
  return Date.now() - new Date(uploadDate).getTime() < 48 * 60 * 60 * 1000;
}

// ── Stat card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, icon: Icon, color }: { label: string; value: string | number; icon: React.ElementType; color: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${color}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className="text-xl font-bold">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

// ── File link ────────────────────────────────────────────────────────────────
function FileLink({ label, url }: { label: string; url: string }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border hover:bg-muted/50 transition-colors text-sm">
      <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
      <span className="flex-1 truncate">{label}</span>
      <ExternalLink className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
    </a>
  );
}

// ── Invoice group section ─────────────────────────────────────────────────────
interface GroupProps {
  title: string;
  count: number;
  icon: React.ElementType;
  headerClass: string;
  defaultOpen: boolean;
  invoices: InvoiceListItem[];
  onSelect: (inv: InvoiceListItem) => void;
}

function InvoiceGroup({ title, count, icon: Icon, headerClass, defaultOpen, invoices, onSelect }: GroupProps) {
  const [open, setOpen] = useState(defaultOpen);

  if (count === 0) return null;

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      {/* Section header */}
      <button
        onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${headerClass}`}
      >
        <Icon className="w-4 h-4 shrink-0" />
        <span className="font-semibold text-sm flex-1">{title}</span>
        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-background/60 border border-border/50">{count}</span>
        {open ? <ChevronDown className="w-4 h-4 opacity-60" /> : <ChevronRight className="w-4 h-4 opacity-60" />}
      </button>

      {/* Rows */}
      {open && (
        <div className="bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 border-t border-border">
              <tr>
                <th className="text-left px-4 py-2.5 text-xs font-semibold">Proveedor</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold"># Factura</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold">ODC</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold">Monto</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold">Estado</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold">Fecha</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {invoices.map(inv => (
                <tr key={inv.id}
                  className="hover:bg-muted/30 transition-colors cursor-pointer"
                  onClick={() => onSelect(inv)}>
                  <td className="px-4 py-3 font-medium">
                    <div className="flex items-center gap-2">
                      {inv.supplierName || '—'}
                      {isNew(inv.uploadDate) && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground leading-none">
                          Nueva
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{inv.invoiceNumber || '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground font-mono text-xs">#{inv.poNumber || '—'}</td>
                  <td className="px-4 py-3 font-semibold whitespace-nowrap">{fmtCurrency(inv.amount ?? undefined, inv.currency ?? undefined)}</td>
                  <td className="px-4 py-3">
                    {inv.status && (
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${STATUS_STYLES[inv.status] ?? 'bg-muted text-muted-foreground border-border'}`}>
                        {inv.status}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmtDate(inv.uploadDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Invoice detail dialog ─────────────────────────────────────────────────────
// Parse paymentTerms string → number of days
function paymentTermsToDays(terms?: string | null): number {
  if (!terms) return 30;
  if (terms === 'Contado') return 0;
  const match = terms.match(/(\d+)/);
  return match ? parseInt(match[1]) : 30;
}

function defaultPaymentDate(terms?: string | null): string {
  const days = paymentTermsToDays(terms);
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function InvoiceDetailDialog({ invoiceId, open, onClose, onRefresh }: {
  invoiceId: string | null; open: boolean; onClose: () => void; onRefresh: () => void;
}) {
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [lineItems, setLineItems] = useState<GetPoLineItemsOutputType['lineItems']>([]);
  const [loadingLines, setLoadingLines] = useState(false);
  const [notes, setNotes] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [rejectReasonError, setRejectReasonError] = useState(false);
  const [saving, setSaving] = useState<'validar' | 'rechazar' | null>(null);
  const [confirmingValidation, setConfirmingValidation] = useState(false);
  const [confirmingRejection, setConfirmingRejection] = useState(false);
  const [paymentDate, setPaymentDate] = useState('');

  // Editable tax breakdown
  const [editSubtotal, setEditSubtotal] = useState('');
  const [editIvaEnabled, setEditIvaEnabled] = useState(false);
  const [editIvaMode, setEditIvaMode] = useState<'percent' | 'amount'>('percent');
  const [editIvaRate, setEditIvaRate] = useState('16');
  const [editIvaFixedAmount, setEditIvaFixedAmount] = useState('');
  const [editRetencionIva, setEditRetencionIva] = useState('');
  const [editRetencionIsr, setEditRetencionIsr] = useState('');

  // Derived totals from editable fields
  const eSub    = parseFloat(editSubtotal) || 0;
  const eIvaAmt = !editIvaEnabled ? 0 : editIvaMode === 'percent'
    ? eSub * ((parseFloat(editIvaRate) || 0) / 100)
    : (parseFloat(editIvaFixedAmount) || 0);
  const eRetIva = parseFloat(editRetencionIva) || 0;
  const eRetIsr = parseFloat(editRetencionIsr) || 0;
  const eTotal  = eSub + eIvaAmt - eRetIva - eRetIsr;

  useEffect(() => {
    if (open && invoiceId) {
      setInvoice(null);
      setLineItems([]);
      setLoadingDetail(true);
      getSupplierInvoiceById({ invoiceId })
        .then(r => {
          const inv = r.invoice;
          if (!inv) return;
          setInvoice(inv);
          setNotes(inv.reviewNotes ?? '');
          setRejectReason('');
          setRejectReasonError(false);
          setConfirmingValidation(false);
          setConfirmingRejection(false);
          setPaymentDate(defaultPaymentDate(inv.poPaymentTerms));

          const sub = inv.subtotal ?? inv.amount ?? 0;
          setEditSubtotal(sub > 0 ? String(sub) : '');
          const hasIvaByRate = (inv.ivaRate ?? 0) > 0;
          const hasIvaByAmount = (inv.ivaAmount ?? 0) > 0;
          setEditIvaEnabled(hasIvaByRate || hasIvaByAmount);
          if (hasIvaByRate) {
            setEditIvaMode('percent');
            setEditIvaRate(((inv.ivaRate! * 100)).toFixed(0));
            setEditIvaFixedAmount('');
          } else if (hasIvaByAmount) {
            setEditIvaMode('amount');
            setEditIvaFixedAmount(String(inv.ivaAmount));
            setEditIvaRate('16');
          } else {
            setEditIvaMode('percent');
            setEditIvaRate('16');
            setEditIvaFixedAmount('');
          }
          setEditRetencionIva(inv.retencionIva ? String(inv.retencionIva) : '');
          setEditRetencionIsr(inv.retencionIsr ? String(inv.retencionIsr) : '');

          if (inv.poId) {
            setLoadingLines(true);
            getPoLineItems({ poId: inv.poId })
              .then(lr => setLineItems(lr.lineItems))
              .catch(() => {})
              .finally(() => setLoadingLines(false));
          }
        })
        .catch(() => {})
        .finally(() => setLoadingDetail(false));
    }
  }, [open, invoiceId]);

  const handleValidarClick = () => {
    setPaymentDate(defaultPaymentDate(invoice?.poPaymentTerms));
    setConfirmingValidation(true);
  };

  const handleRejectClick = () => {
    setConfirmingRejection(true);
    setRejectReasonError(false);
  };

  const handleAction = async (action: 'validar' | 'rechazar') => {
    if (!invoice) return;
    if (action === 'rechazar' && !rejectReason.trim()) {
      setRejectReasonError(true);
      return;
    }
    setSaving(action);
    try {
      await reviewSupplierInvoice({
        invoiceId: invoice.id,
        action,
        notes: action === 'rechazar' ? rejectReason : (notes || undefined),
        scheduledPaymentDate: action === 'validar' ? paymentDate : undefined,
        ...(action === 'validar' ? {
          validatedSubtotal: eSub || undefined,
          validatedIvaRate: editIvaEnabled && editIvaMode === 'percent' ? (parseFloat(editIvaRate) || 0) / 100 : undefined,
          validatedIvaAmount: eIvaAmt || undefined,
          validatedRetencionIva: eRetIva || undefined,
          validatedRetencionIsr: eRetIsr || undefined,
          validatedTotal: eTotal || undefined,
        } : {}),
      });
      toast.success(action === 'validar'
        ? `Factura validada ✓ — pago de ${fmtCurrency((eTotal || invoice.amount) ?? undefined, invoice.currency ?? undefined)} programado para ${new Date(paymentDate + 'T12:00:00').toLocaleDateString('es-MX')}`
        : 'Factura rechazada — el proveedor será notificado con el motivo'
      );
      onRefresh();
      onClose();
    } catch {
      toast.error('Error al procesar la factura');
    } finally { setSaving(null); setConfirmingValidation(false); setConfirmingRejection(false); }
  };

  const canReview = invoice ? (invoice.status === 'Pendiente' || invoice.status === 'En revisión') : false;
  const pdfUrl = invoice?.pdfFile?.[0]?.url;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl w-full h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
        {(loadingDetail || !invoice) ? (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-32" />
            <div className="grid grid-cols-2 gap-3 w-64 mt-4">
              <Skeleton className="h-16" /><Skeleton className="h-16" />
              <Skeleton className="h-16" /><Skeleton className="h-16" />
            </div>
          </div>
        ) : (
        <>
        <DialogHeader className="px-6 pt-5 pb-4 border-b shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-primary/10 rounded-xl flex items-center justify-center shrink-0">
              <FileText className="w-4 h-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-base leading-tight">Factura {invoice.invoiceNumber}</DialogTitle>
              <p className="text-sm text-muted-foreground truncate">{invoice.supplierName}</p>
            </div>
            {isNew(invoice.uploadDate) && (
              <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-primary text-primary-foreground">Nueva</span>
            )}
            {invoice.status && (
              <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${STATUS_STYLES[invoice.status] ?? 'bg-muted text-muted-foreground border-border'}`}>
                {invoice.status}
              </span>
            )}
          </div>
        </DialogHeader>

        <div className="flex flex-1 min-h-0">
          {/* LEFT — PDF viewer */}
          <div className="w-[55%] border-r border-border bg-muted/30 flex flex-col min-w-0">
            {pdfUrl ? (
              <iframe src={pdfUrl} className="w-full h-full border-0" title="Vista previa del PDF" />
            ) : (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
                <FileX className="w-14 h-14 opacity-30" />
                <p className="text-sm font-medium">Sin PDF disponible</p>
                <p className="text-xs opacity-60">El proveedor no adjuntó un archivo PDF</p>
              </div>
            )}
          </div>

          {/* RIGHT — Details & actions */}
          <div className="w-[45%] shrink-0 flex flex-col min-h-0">
            <ScrollArea className="flex-1">
              <div className="px-5 py-4 space-y-5">
                <div className="grid grid-cols-2 gap-3">
                  {[
                    ['# Factura', invoice.invoiceNumber],
                    ['Moneda', invoice.currency],
                    ['Subida el', fmtDate(invoice.uploadDate)],
                    ['Subida por', invoice.uploadedBy],
                    ['Proyecto', invoice.projectCode],
                  ].map(([l, v]) => (
                    <div key={l as string}>
                      <p className="text-[11px] text-muted-foreground mb-0.5">{l}</p>
                      <p className="text-sm font-medium break-all">{(v as string) || '—'}</p>
                    </div>
                  ))}
                </div>

                <Separator />

                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">ODC Vinculada</p>
                  <div className="bg-muted/40 rounded-lg p-3 space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-muted-foreground">OC #</span>
                      <span className="text-sm font-mono font-semibold">{invoice.poNumber || '—'}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-muted-foreground">Monto ODC</span>
                      <span className="text-sm font-semibold">{fmtCurrency(invoice.poTotalAmount ?? undefined)}</span>
                    </div>
                    {invoice.poServiceDescription && (
                      <div>
                        <p className="text-xs text-muted-foreground">Servicio</p>
                        <p className="text-xs mt-0.5">{invoice.poServiceDescription}</p>
                      </div>
                    )}
                    {/* Line items */}
                    {loadingLines && (
                      <div className="border-t border-border/60 pt-2 space-y-1.5">
                        <Skeleton className="h-3 w-full" />
                        <Skeleton className="h-3 w-5/6" />
                        <Skeleton className="h-3 w-4/6" />
                      </div>
                    )}
                    {!loadingLines && lineItems.length > 0 && (
                      <div className="border-t border-border/60 pt-2">
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Líneas de la ODC</p>
                        <div className="overflow-x-auto">
                          <table className="w-full text-[11px]">
                            <thead>
                              <tr className="border-b border-border/60">
                                <th className="text-left pb-1 text-muted-foreground font-medium">Descripción</th>
                                <th className="text-left pb-1 text-muted-foreground font-medium">Cat.</th>
                                <th className="text-right pb-1 text-muted-foreground font-medium">Cant.</th>
                                <th className="text-right pb-1 text-muted-foreground font-medium">P.U.</th>
                                <th className="text-right pb-1 text-muted-foreground font-medium">Total</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border/40">
                              {lineItems.map(li => (
                                <tr key={li.id}>
                                  <td className="py-1 pr-1 leading-snug">{li.description || '—'}</td>
                                  <td className="py-1 pr-1 text-muted-foreground whitespace-nowrap">{li.category || '—'}</td>
                                  <td className="py-1 text-right whitespace-nowrap">{li.quantity}</td>
                                  <td className="py-1 pl-1 text-right whitespace-nowrap">{fmtCurrency(li.unitPrice, invoice.currency ?? undefined)}</td>
                                  <td className="py-1 pl-1 text-right font-semibold whitespace-nowrap">{fmtCurrency(li.total, invoice.currency ?? undefined)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* ── Tax breakdown ──────────────────────────── */}
                <Separator />
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Desglose fiscal</p>
                    {canReview && (
                      <span className="text-[10px] text-muted-foreground italic">Verifica con el PDF →</span>
                    )}
                  </div>

                  {canReview ? (
                    /* Editable breakdown for pending/in-review */
                    <div className="space-y-2.5 rounded-lg border border-border bg-muted/20 p-3">
                      {/* Subtotal */}
                      <div className="space-y-1">
                        <Label className="text-xs">Subtotal (sin IVA)</Label>
                        <Input
                          type="number" min={0} placeholder="0.00"
                          value={editSubtotal}
                          onChange={e => setEditSubtotal(e.target.value)}
                          className="h-8 text-sm"
                        />
                      </div>
                      {/* IVA toggle */}
                      <div className="space-y-2">
                        <div className="flex items-center gap-2.5">
                          <Switch id="iva-sw" checked={editIvaEnabled} onCheckedChange={setEditIvaEnabled} />
                          <Label htmlFor="iva-sw" className="text-xs cursor-pointer">Aplica IVA</Label>
                        </div>
                        {editIvaEnabled && (
                          <div className="flex items-center gap-2 ml-1">
                            <div className="flex rounded-md border border-border overflow-hidden shrink-0">
                              <button type="button" onClick={() => setEditIvaMode('percent')}
                                className={`px-2 py-1 text-xs font-semibold transition-colors ${editIvaMode === 'percent' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'}`}>%</button>
                              <button type="button" onClick={() => setEditIvaMode('amount')}
                                className={`px-2 py-1 text-xs font-semibold border-l border-border transition-colors ${editIvaMode === 'amount' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'}`}>$</button>
                            </div>
                            {editIvaMode === 'percent' ? (
                              <div className="flex items-center gap-1.5 flex-1">
                                <Input type="number" min={0} max={100} placeholder="16"
                                  value={editIvaRate} onChange={e => setEditIvaRate(e.target.value)}
                                  className="h-8 text-xs" />
                                <span className="text-xs text-muted-foreground shrink-0">%</span>
                              </div>
                            ) : (
                              <Input type="number" min={0} placeholder="Monto de IVA"
                                value={editIvaFixedAmount} onChange={e => setEditIvaFixedAmount(e.target.value)}
                                className="h-8 text-xs flex-1" />
                            )}
                          </div>
                        )}
                      </div>
                      {/* Retenciones */}
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs">Ret. IVA <span className="text-muted-foreground font-normal text-[10px]">(opc.)</span></Label>
                          <Input type="number" min={0} placeholder="0.00"
                            value={editRetencionIva} onChange={e => setEditRetencionIva(e.target.value)}
                            className="h-8 text-sm" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Ret. ISR <span className="text-muted-foreground font-normal text-[10px]">(opc.)</span></Label>
                          <Input type="number" min={0} placeholder="0.00"
                            value={editRetencionIsr} onChange={e => setEditRetencionIsr(e.target.value)}
                            className="h-8 text-sm" />
                        </div>
                      </div>
                      {/* Running total */}
                      {eSub > 0 && (
                        <div className="rounded-md bg-muted/50 border border-border/60 px-2.5 py-2 space-y-1 text-xs">
                          <div className="flex justify-between text-muted-foreground">
                            <span>Subtotal</span><span>{fmtCurrency(eSub, invoice.currency ?? undefined)}</span>
                          </div>
                          {editIvaEnabled && eIvaAmt > 0 && (
                            <div className="flex justify-between text-muted-foreground">
                              <span>+ IVA{editIvaMode === 'percent' && editIvaRate ? ` (${editIvaRate}%)` : ''}</span>
                              <span>{fmtCurrency(eIvaAmt, invoice.currency ?? undefined)}</span>
                            </div>
                          )}
                          {eRetIva > 0 && (
                            <div className="flex justify-between text-muted-foreground">
                              <span>− Ret. IVA</span><span>−{fmtCurrency(eRetIva, invoice.currency ?? undefined)}</span>
                            </div>
                          )}
                          {eRetIsr > 0 && (
                            <div className="flex justify-between text-muted-foreground">
                              <span>− Ret. ISR</span><span>−{fmtCurrency(eRetIsr, invoice.currency ?? undefined)}</span>
                            </div>
                          )}
                          <div className="flex justify-between font-bold border-t border-border/60 pt-1 mt-1">
                            <span>= Total a pagar</span>
                            <span className="text-primary">{fmtCurrency(eTotal, invoice.currency ?? undefined)}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    /* Read-only breakdown for validated/rejected */
                    <div className="rounded-lg bg-muted/30 border border-border/60 px-3 py-2.5 space-y-1.5 text-xs">
                      {invoice.subtotal ? (
                        <>
                          <div className="flex justify-between text-muted-foreground">
                            <span>Subtotal</span><span>{fmtCurrency(invoice.subtotal, invoice.currency ?? undefined)}</span>
                          </div>
                          {(invoice.ivaAmount ?? 0) > 0 && (
                            <div className="flex justify-between text-muted-foreground">
                              <span>+ IVA{invoice.ivaRate ? ` (${(invoice.ivaRate * 100).toFixed(0)}%)` : ''}</span>
                              <span>{fmtCurrency(invoice.ivaAmount!, invoice.currency ?? undefined)}</span>
                            </div>
                          )}
                          {(invoice.retencionIva ?? 0) > 0 && (
                            <div className="flex justify-between text-muted-foreground">
                              <span>− Ret. IVA</span><span>−{fmtCurrency(invoice.retencionIva!, invoice.currency ?? undefined)}</span>
                            </div>
                          )}
                          {(invoice.retencionIsr ?? 0) > 0 && (
                            <div className="flex justify-between text-muted-foreground">
                              <span>− Ret. ISR</span><span>−{fmtCurrency(invoice.retencionIsr!, invoice.currency ?? undefined)}</span>
                            </div>
                          )}
                          <div className="flex justify-between font-bold border-t border-border/60 pt-1.5 mt-1">
                            <span>Total</span>
                            <span>{fmtCurrency(invoice.amount ?? undefined, invoice.currency ?? undefined)}</span>
                          </div>
                        </>
                      ) : (
                        <div className="flex justify-between font-semibold">
                          <span>Monto total</span>
                          <span>{fmtCurrency(invoice.amount ?? undefined, invoice.currency ?? undefined)}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {(invoice.xmlFile?.[0] || invoice.supportFile?.[0] || pdfUrl) && (
                  <>
                    <Separator />
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Archivos adjuntos</p>
                      <div className="space-y-2">
                        {pdfUrl && <FileLink label="PDF de factura" url={pdfUrl} />}
                        {invoice.xmlFile?.[0] && <FileLink label="XML / CFDI" url={invoice.xmlFile[0].url} />}
                        {invoice.supportFile?.[0] && <FileLink label="Archivo de soporte" url={invoice.supportFile[0].url} />}
                      </div>
                    </div>
                  </>
                )}

                <Separator />

                {/* Supplier comment */}
                {invoice.supplierComment && (
                  <>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Comentario del proveedor</p>
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-900 leading-relaxed whitespace-pre-wrap">
                        {invoice.supplierComment}
                      </div>
                    </div>
                    <Separator />
                  </>
                )}

                {/* Review notes (read-only for already reviewed) */}
                {!canReview && invoice.reviewNotes ? (
                  <div>
                    <p className="text-[11px] text-muted-foreground mb-1">Notas de revisión</p>
                    <div className="bg-muted/40 rounded-lg p-3 text-sm">{invoice.reviewNotes}</div>
                  </div>
                ) : canReview ? (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Notas internas (opcionales)</Label>
                    <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)}
                      placeholder="Notas internas sobre esta factura..." className="text-sm resize-none" />
                  </div>
                ) : null}

                {invoice.reviewedBy && (
                  <p className="text-xs text-muted-foreground">
                    Revisada por <strong>{invoice.reviewedBy}</strong> el {fmtDate(invoice.reviewedAt ?? undefined)}
                  </p>
                )}
              </div>
            </ScrollArea>

            {canReview && (
              <div className="px-5 py-4 border-t shrink-0 space-y-3">
                {confirmingValidation ? (
                  <>
                    <div className="bg-green-50 border border-green-200 rounded-lg p-3 space-y-3">
                      <p className="text-xs font-semibold text-green-800 flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Programar pago
                      </p>

                      {/* Payment terms */}
                      <div className="text-xs text-green-900">
                        <span className="opacity-70">Condiciones de pago de la ODC: </span>
                        <span className="font-semibold">
                          {invoice?.poPaymentTerms
                            ? invoice.poPaymentTerms
                            : 'Sin condiciones definidas — se asumen 30 días'}
                        </span>
                      </div>

                      {/* Calculated date explanation */}
                      <div className="text-xs text-green-900">
                        <span className="opacity-70">Fecha estimada: </span>
                        <span className="font-semibold">
                          {paymentDate
                            ? new Date(paymentDate + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })
                            : '—'}
                        </span>
                        <span className="opacity-60 ml-1">
                          ({paymentTermsToDays(invoice?.poPaymentTerms)} días a partir de hoy)
                        </span>
                      </div>

                      {/* Editable date */}
                      <div className="space-y-1">
                        <Label className="text-xs text-green-700">Ajustar fecha si es necesario</Label>
                        <input
                          type="date"
                          value={paymentDate}
                          onChange={e => setPaymentDate(e.target.value)}
                          className="w-full text-sm border border-green-300 rounded-md px-3 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-green-500"
                        />
                      </div>

                      {/* Validated amount summary */}
                      {eTotal > 0 && (
                        <div className="text-xs text-green-900 bg-green-100/60 rounded-md px-2.5 py-2 flex justify-between font-semibold">
                          <span>Monto del pago</span>
                          <span>{fmtCurrency(eTotal, invoice?.currency ?? undefined)}</span>
                        </div>
                      )}
                      <p className="text-xs text-green-800 font-medium pt-0.5">
                        ¿Estás de acuerdo con esta fecha de pago?
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="flex-1"
                        onClick={() => setConfirmingValidation(false)} disabled={!!saving}>
                        Cancelar
                      </Button>
                      <Button size="sm" className="flex-1 bg-green-600 hover:bg-green-700 text-white text-xs"
                        onClick={() => handleAction('validar')} disabled={!!saving || !paymentDate}>
                        <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                        {saving === 'validar' ? 'Validando...' : 'Confirmar y programar pago'}
                      </Button>
                    </div>
                  </>
                ) : confirmingRejection ? (
                  <>
                    <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-3 space-y-2.5">
                      <p className="text-xs font-semibold text-destructive flex items-center gap-1.5">
                        <XCircle className="w-3.5 h-3.5" />
                        Motivo de rechazo (requerido)
                      </p>
                      <Textarea
                        rows={3}
                        value={rejectReason}
                        onChange={e => { setRejectReason(e.target.value); setRejectReasonError(false); }}
                        placeholder="Describe el motivo del rechazo. El proveedor verá este mensaje en su portal…"
                        className={`text-xs resize-none ${rejectReasonError ? 'border-destructive ring-1 ring-destructive' : ''}`}
                        autoFocus
                      />
                      {rejectReasonError && (
                        <p className="text-[11px] text-destructive">El motivo de rechazo es obligatorio.</p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="flex-1"
                        onClick={() => setConfirmingRejection(false)} disabled={!!saving}>
                        Cancelar
                      </Button>
                      <Button size="sm" variant="destructive" className="flex-1 text-xs"
                        onClick={() => handleAction('rechazar')} disabled={!!saving || !rejectReason.trim()}>
                        <XCircle className="w-3.5 h-3.5 mr-1" />
                        {saving === 'rechazar' ? 'Rechazando...' : 'Confirmar rechazo'}
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm"
                      className="flex-1 border-destructive text-destructive hover:bg-destructive/10"
                      onClick={handleRejectClick} disabled={!!saving}>
                      <XCircle className="w-4 h-4 mr-1.5" />
                      Rechazar
                    </Button>
                    <Button size="sm" className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                      onClick={handleValidarClick} disabled={!!saving}>
                      <CheckCircle2 className="w-4 h-4 mr-1.5" />
                      Validar
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function SupplierInvoicesPage() {
  const [invoices, setInvoices] = useState<InvoiceListItem[]>([]);
  const [stats, setStats] = useState<Stats>({ pending: 0, inReview: 0, validated: 0, rejected: 0, totalAmount: 0 });
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const isInitialLoad = useRef(true);

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await getSupplierInvoices({ status: filterStatus || undefined });
      setInvoices(data.invoices);
      setStats(data.stats);
    } catch { if (!silent) toast.error('Error al cargar facturas'); }
    finally { if (!silent) setLoading(false); }
  };

  useEffect(() => {
    isInitialLoad.current = true;
    load(false);
    isInitialLoad.current = false;
    const interval = setInterval(() => { if (document.visibilityState === 'visible') load(true); }, 120000);
    return () => clearInterval(interval);
  }, [filterStatus]);

  const filtered = useMemo(() => {
    if (!search) return invoices;
    const q = search.toLowerCase();
    return invoices.filter(i =>
      i.supplierName?.toLowerCase().includes(q) ||
      i.invoiceNumber?.toLowerCase().includes(q) ||
      (i.poNumber ?? '').toLowerCase().includes(q)
    );
  }, [invoices, search]);

  const groups = useMemo(() => ({
    pending: filtered.filter(i => i.status === 'Pendiente' || i.status === 'En revisión'),
    validated: filtered.filter(i => i.status === 'Validada'),
    rejected: filtered.filter(i => i.status === 'Rechazada'),
  }), [filtered]);

  const newCount = useMemo(() => groups.pending.filter(i => isNew(i.uploadDate)).length, [groups.pending]);

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold">Facturas de Proveedores</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Revisión y validación de facturas recibidas</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <StatCard label="Pendientes de revisión" value={stats.pending} icon={AlertCircle} color="bg-orange-100 text-orange-600" />
        <StatCard label="En revisión" value={stats.inReview} icon={Clock} color="bg-blue-100 text-blue-600" />
        <StatCard label="Validadas" value={stats.validated} icon={CheckCircle2} color="bg-green-100 text-green-600" />
        <StatCard label="Total validado" value={`$${stats.totalAmount.toLocaleString('es-MX', { maximumFractionDigits: 0 })}`} icon={FileText} color="bg-primary/10 text-primary" />
      </div>

      {/* New invoices alert banner */}
      {newCount > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-primary/30 bg-primary/5 mb-4">
          <Bell className="w-4 h-4 text-primary shrink-0" />
          <p className="text-sm font-medium text-primary">
            {newCount === 1
              ? '1 factura nueva por revisar en las últimas 48 horas'
              : `${newCount} facturas nuevas por revisar en las últimas 48 horas`}
          </p>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-5">
        <Input
          placeholder="Buscar proveedor o # factura..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-56 h-9"
        />
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-44 h-9">
            <SelectValue placeholder="Todos los estados" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Pendiente">Pendiente</SelectItem>
            <SelectItem value="En revisión">En revisión</SelectItem>
            <SelectItem value="Validada">Validada</SelectItem>
            <SelectItem value="Rechazada">Rechazada</SelectItem>
          </SelectContent>
        </Select>
        {filterStatus && <Button variant="ghost" size="sm" onClick={() => setFilterStatus('')} className="h-9">Limpiar</Button>}
      </div>

      {/* Grouped sections */}
      {loading ? (
        <div className="space-y-2">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 bg-card border rounded-xl text-center">
          <FileText className="w-14 h-14 text-muted-foreground/30 mb-4" />
          <p className="font-semibold">No hay facturas</p>
          <p className="text-sm text-muted-foreground mt-1">Las facturas enviadas por proveedores aparecerán aquí.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <InvoiceGroup
            title="Por revisar"
            count={groups.pending.length}
            icon={Clock}
            headerClass="bg-orange-50 hover:bg-orange-100/70 text-orange-800 border-b border-orange-100"
            defaultOpen={true}
            invoices={groups.pending}
            onSelect={inv => setSelectedId(inv.id)}
          />
          <InvoiceGroup
            title="Validadas"
            count={groups.validated.length}
            icon={CheckCircle2}
            headerClass="bg-green-50 hover:bg-green-100/70 text-green-800 border-b border-green-100"
            defaultOpen={false}
            invoices={groups.validated}
            onSelect={inv => setSelectedId(inv.id)}
          />
          <InvoiceGroup
            title="Rechazadas"
            count={groups.rejected.length}
            icon={XCircle}
            headerClass="bg-red-50 hover:bg-red-100/70 text-red-800 border-b border-red-100"
            defaultOpen={false}
            invoices={groups.rejected}
            onSelect={inv => setSelectedId(inv.id)}
          />
        </div>
      )}

      <InvoiceDetailDialog invoiceId={selectedId} open={!!selectedId} onClose={() => setSelectedId(null)} onRefresh={load} />
    </div>
  );
}
