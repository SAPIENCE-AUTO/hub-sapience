import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { getSupplierPortalData, uploadSupplierInvoice, GetSupplierPortalDataOutputType } from 'zite-endpoints-sdk';
import { uploadFile } from 'zite-file-upload-sdk';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { Toaster } from '@/components/ui/sonner';
import {
  Upload, CheckCircle2, Clock, XCircle,
  CalendarDays, List, ChevronLeft, ChevronRight, AlertCircle,
  AlertTriangle, FileCheck, FileX, FileClock, Receipt, Search, Paperclip,
  ShoppingCart, FileText, Wallet, Download, ExternalLink, FileWarning, Ban, Mail,
} from 'lucide-react';

type PortalData = GetSupplierPortalDataOutputType;
type PO = PortalData['purchaseOrders'][0];
type Payment = PortalData['payments'][0];
type TabId = 'ordenes' | 'facturas' | 'pagos';

// Misma marca/paleta que LoginPage.tsx y el correo de OC
// (server/templates/correo-orden-compra.html) — navy #0F3D4C, teal #027495.
const BRAND_LOGO_URL = 'https://qmqtjfhifzxvnhiyifyh.supabase.co/storage/v1/object/public/publico/logo%20sapience%20blanco%2015%20ene%2026.png';

const PO_STATUS_STYLES: Record<string, string> = {
  'Enviada a aprobación':  'bg-blue-100 text-blue-700 border-blue-200',
  'Aprobada':          'bg-emerald-100 text-emerald-700 border-emerald-200',
  'Factura recibida':  'bg-orange-100 text-orange-700 border-orange-200',
  'Factura validada':  'bg-teal-100 text-teal-700 border-teal-200',
  'Pago programado':   'bg-yellow-100 text-yellow-700 border-yellow-200',
  'Pagada':   'bg-purple-100 text-purple-700 border-purple-200',
};
const INV_STATUS_STYLES: Record<string, string> = {
  'Pendiente':   'bg-orange-100 text-orange-700 border-orange-200',
  'En revisión': 'bg-blue-100 text-blue-700 border-blue-200',
  'Validada':    'bg-green-100 text-green-700 border-green-200',
  'Rechazada':   'bg-red-100 text-red-700 border-red-200',
};
const PAYMENT_STATUS_STYLES: Record<string, string> = {
  'Programado': 'bg-yellow-100 text-yellow-700 border-yellow-200',
  'Realizado':  'bg-green-100 text-green-700 border-green-200',
  'Cancelado':  'bg-red-100 text-red-700 border-red-200',
};
const PAYMENT_STATUS_BORDER: Record<string, string> = {
  'Programado': 'border-yellow-400',
  'Realizado':  'border-green-500',
  'Cancelado':  'border-red-400',
};

function fmtCurrency(amount?: number, currency?: string) {
  if (!amount) return '—';
  return `${currency === 'USD' ? 'USD ' : '$'}${amount.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtDate(s?: string) {
  if (!s) return '—';
  const dateOnly = s.split('T')[0];
  return new Date(dateOnly + 'T12:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}
function getToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }

// ── Verify screen ─────────────────────────────────────────────────────────────
function VerifyScreen({ onVerify, error }: { onVerify: (pw: string) => void; error?: string }) {
  const [pw, setPw] = useState('');
  return (
    <div className="min-h-screen bg-[#EEF2F3] flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl shadow-lg w-full max-w-sm overflow-hidden">
        <div className="bg-[#0F3D4C] px-8 pt-8 pb-6 text-center">
          <img src={BRAND_LOGO_URL} alt="Sapience" className="h-8 w-auto mx-auto mb-5" />
          <h1 className="text-lg font-bold text-white">Portal de Proveedores</h1>
          <p className="text-sm text-[#8FB6C0] mt-1">Ingresa tu clave de acceso para continuar</p>
        </div>
        <div className="p-8 space-y-6">
          <div className="space-y-2">
            <Label>Clave de acceso</Label>
            <Input
              type="password" value={pw} onChange={e => setPw(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && pw && onVerify(pw)}
              placeholder="••••••••" autoFocus
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
          <Button
            className="w-full bg-[#0F3D4C] hover:bg-[#0A2F3B] text-white"
            onClick={() => onVerify(pw)} disabled={!pw}
          >
            Acceder
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── PO Detail Dialog ──────────────────────────────────────────────────────────
function PODetailDialog({ po, open, onClose, onUpload }: {
  po: PO | null;
  open: boolean;
  onClose: () => void;
  onUpload: (po: PO) => void;
}) {
  const canUploadInvoice = !po?.invoiceStatus || po?.invoiceStatus === 'Rechazada';
  const hasInvoice = !!po?.invoiceStatus;
  const pdfSrc = po?.pdfUrl
    || (po?.pdfBase64 ? `data:application/pdf;base64,${po.pdfBase64}` : null)
    || (po?.pdfFile && po.pdfFile.length > 0 ? po.pdfFile[0].url : null);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] flex flex-col p-0 gap-0">
        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border shrink-0">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <DialogTitle className="font-mono text-lg font-bold">
                  OC #{po?.poNumber}
                </DialogTitle>
                {po?.status && (
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${PO_STATUS_STYLES[po.status] ?? 'bg-muted text-muted-foreground border-border'}`}>
                    {po.status}
                  </span>
                )}

              </div>
              <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
                {po?.projectCode && <span className="font-medium">{po.projectCode}</span>}
                {po?.issueDate && <span>Fecha: {fmtDate(po.issueDate)}</span>}
                {po?.paymentTerms && <span>Pago: {po.paymentTerms}</span>}
              </div>
              {po?.serviceDescription && (
                <p className="text-sm text-muted-foreground leading-snug mt-1 line-clamp-2">{po.serviceDescription}</p>
              )}
            </div>
            <div className="text-right shrink-0">
              <p className="text-xs text-muted-foreground">Monto total</p>
              <p className="text-xl font-bold">{fmtCurrency(po?.totalAmount, po?.currency ?? undefined)}</p>
            </div>
          </div>
        </DialogHeader>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {/* Invoice status banner */}
          {hasInvoice && (
            <div className="px-6 pt-4">
              <div className={`flex items-center gap-3 p-3 rounded-xl border text-sm ${
                po?.invoiceStatus === 'Rechazada'
                  ? 'bg-destructive/5 border-destructive/20 text-destructive'
                  : po?.invoiceStatus === 'Validada'
                  ? 'bg-green-50 border-green-200 text-green-700'
                  : 'bg-blue-50 border-blue-200 text-blue-700'
              }`}>
                {po?.invoiceStatus === 'Rechazada' ? <XCircle className="w-4 h-4 shrink-0" /> :
                 po?.invoiceStatus === 'Validada' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> :
                 <Clock className="w-4 h-4 shrink-0" />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center flex-wrap gap-x-1">
                    <span className="font-semibold">Factura {po?.invoiceStatus}</span>
                    {po?.invoiceNumber && <span className="opacity-75">— #{po.invoiceNumber}</span>}
                    {po?.invoiceAmount && <span className="font-bold ml-1">{fmtCurrency(po.invoiceAmount, po.invoiceCurrency ?? undefined)}</span>}
                  </div>
                  {po?.invoiceSubtotal && (
                    <div className="mt-1.5 grid grid-cols-[1fr_auto] gap-x-6 text-xs opacity-80 leading-5">
                      <span>Subtotal</span>
                      <span className="text-right font-medium">{fmtCurrency(po.invoiceSubtotal, po.invoiceCurrency ?? undefined)}</span>
                      {(po.invoiceIvaAmount ?? 0) > 0 && <>
                        <span>IVA{po.invoiceIvaRate ? ` (${(po.invoiceIvaRate * 100).toFixed(0)}%)` : ''}</span>
                        <span className="text-right font-medium">{fmtCurrency(po.invoiceIvaAmount!, po.invoiceCurrency ?? undefined)}</span>
                      </>}
                      {(po.invoiceRetencionIva ?? 0) > 0 && <>
                        <span>Ret. IVA</span>
                        <span className="text-right font-medium">− {fmtCurrency(po.invoiceRetencionIva!, po.invoiceCurrency ?? undefined)}</span>
                      </>}
                      {(po.invoiceRetencionIsr ?? 0) > 0 && <>
                        <span>Ret. ISR</span>
                        <span className="text-right font-medium">− {fmtCurrency(po.invoiceRetencionIsr!, po.invoiceCurrency ?? undefined)}</span>
                      </>}
                    </div>
                  )}
                </div>
                {po?.invoiceUploadDate && (
                  <span className="ml-auto text-xs opacity-70 shrink-0">Enviada {fmtDate(po.invoiceUploadDate)}</span>
                )}
              </div>
              {po?.invoiceStatus === 'Rechazada' && po?.invoiceReviewNotes && (
                <div className="mt-2 flex gap-2 p-3 rounded-lg bg-destructive/5 border border-destructive/15">
                  <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-destructive mb-0.5">Motivo de rechazo</p>
                    <p className="text-xs text-destructive/80 leading-relaxed">{po.invoiceReviewNotes}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* PDF viewer */}
          <div className="px-6 py-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Orden de Compra (PDF)</p>
              {pdfSrc && po?.status !== 'Cancelada' && (
                <a href={pdfSrc} target="_blank" rel="noopener noreferrer">
                  <Button size="sm" variant="outline" className="gap-1.5 h-7 text-xs">
                    <Download className="w-3 h-3" /> Descargar PDF
                  </Button>
                </a>
              )}
            </div>

            {pdfSrc ? (
              <div className="rounded-xl border border-border overflow-hidden bg-muted/20">
                <iframe
                  src={`${pdfSrc}#toolbar=0&navpanes=0&scrollbar=1`}
                  className="w-full"
                  style={{ height: '480px' }}
                  title={`OC #${po?.poNumber}`}
                />
                <div className="flex items-center justify-center gap-2 py-2 border-t border-border bg-muted/30">
                  <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">¿No se ve el PDF?</span>
                  <a href={pdfSrc} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline font-medium inline-flex items-center gap-1">
                    Abrirlo en nueva ventana <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 rounded-xl border-2 border-dashed border-border bg-muted/10 text-center gap-2">
                <FileWarning className="w-8 h-8 text-muted-foreground" />
                <p className="text-sm font-medium">PDF no disponible</p>
                <p className="text-xs text-muted-foreground">El PDF de esta orden aún no ha sido generado.</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <DialogFooter className="px-6 py-4 border-t border-border shrink-0 flex-row gap-2 justify-end">
          <Button variant="outline" onClick={onClose}>Cerrar</Button>
          {canUploadInvoice && po && (
            <Button
              onClick={() => { onClose(); onUpload(po); }}
              className={po.invoiceStatus === 'Rechazada' ? 'gap-1.5' : 'gap-1.5 bg-[#0F3D4C] hover:bg-[#0A2F3B] text-white'}
              variant={po.invoiceStatus === 'Rechazada' ? 'destructive' : 'default'}
            >
              <Upload className="w-4 h-4" />
              {po.invoiceStatus === 'Rechazada' ? 'Reenviar factura' : 'Subir factura'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Upload invoice dialog ─────────────────────────────────────────────────────
function UploadInvoiceDialog({ po, token, password, onDone, open, onClose }: {
  po: PO | null; token: string; password: string;
  onDone: () => void; open: boolean; onClose: () => void;
}) {
  const [form, setForm] = useState({ invoiceNumber: '', currency: 'MXN', subtotal: '', ivaEnabled: true, ivaMode: 'percent' as 'percent' | 'amount', ivaRate: '16', ivaFixedAmount: '', retencionIva: '', retencionIsr: '', supplierComment: '' });
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [xmlFile, setXmlFile] = useState<File | null>(null);
  const [supportFile, setSupportFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const isResubmit = !!po?.invoiceStatus;

  // Derived tax values
  const cSub     = parseFloat(form.subtotal) || 0;
  const cIvaRate = form.ivaEnabled && form.ivaMode === 'percent' ? (parseFloat(form.ivaRate) || 0) / 100 : 0;
  const cIvaAmt  = !form.ivaEnabled ? 0 : form.ivaMode === 'percent' ? cSub * cIvaRate : (parseFloat(form.ivaFixedAmount) || 0);
  const cRetIva  = parseFloat(form.retencionIva) || 0;
  const cRetIsr  = parseFloat(form.retencionIsr) || 0;
  const cTotal   = cSub + cIvaAmt - cRetIva - cRetIsr;

  useEffect(() => {
    if (open) { setForm({ invoiceNumber: '', currency: po?.invoiceCurrency ?? 'MXN', subtotal: '', ivaEnabled: true, ivaMode: 'percent', ivaRate: '16', ivaFixedAmount: '', retencionIva: '', retencionIsr: '', supplierComment: '' }); setPdfFile(null); setXmlFile(null); setSupportFile(null); }
  }, [open]);

  const handleSubmit = async () => {
    if (!po || !pdfFile || !form.invoiceNumber || !form.subtotal) {
      toast.error('Completa todos los campos requeridos y adjunta el PDF.');
      return;
    }
    setSaving(true);
    try {
      const { fileUrl: pdfUrl } = await uploadFile({ data: pdfFile, filename: pdfFile.name, folder: 'supplier-invoices', token, password });
      let xmlUrl: string | undefined;
      let supportUrl: string | undefined;
      if (xmlFile) { const r = await uploadFile({ data: xmlFile, filename: xmlFile.name, folder: 'supplier-invoices', token, password }); xmlUrl = r.fileUrl; }
      if (supportFile) { const r = await uploadFile({ data: supportFile, filename: supportFile.name, folder: 'supplier-invoices', token, password }); supportUrl = r.fileUrl; }
      await uploadSupplierInvoice({
        token, password, poId: po.id,
        invoiceNumber: form.invoiceNumber,
        amount: cTotal,
        subtotal: cSub || undefined,
        ivaRate: cIvaRate || undefined,
        ivaAmount: cIvaAmt || undefined,
        retencionIva: cRetIva || undefined,
        retencionIsr: cRetIsr || undefined,
        currency: form.currency,
        pdfFile: [{ url: pdfUrl }],
        xmlFile: xmlUrl ? [{ url: xmlUrl }] : undefined,
        supportFile: supportUrl ? [{ url: supportUrl }] : undefined,
        supplierComment: form.supplierComment || undefined,
      });
      toast.success(isResubmit ? 'Factura corregida y reenviada' : 'Factura enviada correctamente');
      onDone();
      onClose();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error al enviar la factura');
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-5 shrink-0 bg-[#0F3D4C]">
          <DialogTitle className="text-white font-semibold">
            {isResubmit ? 'Reenviar factura' : 'Subir factura'}
            <span className="ml-2 font-mono font-normal text-sm text-[#8FB6C0]">OC #{po?.poNumber}</span>
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-scroll">
          <div className="px-6 py-4 space-y-4">
        {isResubmit && po?.invoiceReviewNotes && (
          <div className="flex gap-2.5 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-xs mb-0.5">Motivo de rechazo</p>
              <p className="text-xs leading-relaxed">{po.invoiceReviewNotes}</p>
            </div>
          </div>
        )}
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Número de factura <span className="text-destructive">*</span></Label>
            <Input value={form.invoiceNumber} onChange={e => setForm(p => ({ ...p, invoiceNumber: e.target.value }))} placeholder="Ej: A-00123" />
          </div>
          <div className="space-y-3 rounded-lg border border-[#027495]/15 bg-[#F2F7F8] p-3">
            <p className="text-[11px] font-semibold text-[#027495] uppercase tracking-wide">Desglose fiscal</p>
            {/* Monto + Moneda */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Monto (sin IVA) <span className="text-destructive">*</span></Label>
                <Input type="number" value={form.subtotal} onChange={e => setForm(p => ({ ...p, subtotal: e.target.value }))} placeholder="0.00" min={0} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Moneda</Label>
                <Select value={form.currency} onValueChange={v => setForm(p => ({ ...p, currency: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MXN">MXN</SelectItem>
                    <SelectItem value="USD">USD</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {/* IVA toggle */}
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <Switch id="iva-switch" checked={form.ivaEnabled} onCheckedChange={v => setForm(p => ({ ...p, ivaEnabled: v }))} />
                <Label htmlFor="iva-switch" className="cursor-pointer text-sm">Aplica IVA</Label>
              </div>
              {form.ivaEnabled && (
                <div className="ml-1 space-y-2">
                  {/* Mode selector + input */}
                  <div className="flex items-center gap-2">
                    {/* % / $ toggle buttons */}
                    <div className="flex rounded-md border border-border overflow-hidden shrink-0">
                      <button
                        type="button"
                        onClick={() => setForm(p => ({ ...p, ivaMode: 'percent' }))}
                        className={`px-2.5 py-1 text-xs font-semibold transition-colors ${form.ivaMode === 'percent' ? 'bg-[#0F3D4C] text-white' : 'bg-card text-muted-foreground hover:bg-muted'}`}
                      >%</button>
                      <button
                        type="button"
                        onClick={() => setForm(p => ({ ...p, ivaMode: 'amount' }))}
                        className={`px-2.5 py-1 text-xs font-semibold border-l border-border transition-colors ${form.ivaMode === 'amount' ? 'bg-[#0F3D4C] text-white' : 'bg-card text-muted-foreground hover:bg-muted'}`}
                      >$</button>
                    </div>
                    {form.ivaMode === 'percent' ? (
                      <div className="flex items-center gap-1.5 flex-1">
                        <Input
                          type="number" value={form.ivaRate}
                          onChange={e => setForm(p => ({ ...p, ivaRate: e.target.value }))}
                          className="h-8 text-xs text-right" min={0} max={100} placeholder="16"
                        />
                        <span className="text-xs text-muted-foreground shrink-0">%</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 flex-1">
                        <Input
                          type="number" value={form.ivaFixedAmount}
                          onChange={e => setForm(p => ({ ...p, ivaFixedAmount: e.target.value }))}
                          className="h-8 text-xs" min={0} placeholder="Monto de IVA"
                        />
                      </div>
                    )}
                  </div>
                  {/* Calculation breakdown */}
                  {cSub > 0 && (
                    <div className="rounded-md bg-muted/50 border border-border/60 px-3 py-2 space-y-1">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Monto</span>
                        <span>{fmtCurrency(cSub, form.currency)}</span>
                      </div>
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>
                          + IVA{form.ivaMode === 'percent' && (parseFloat(form.ivaRate) || 0) > 0 ? ` (${parseFloat(form.ivaRate) || 0}%)` : ''}
                        </span>
                        <span className="font-medium">{fmtCurrency(cIvaAmt, form.currency)}</span>
                      </div>
                      <div className="flex justify-between text-xs font-semibold border-t border-border/60 pt-1 mt-1">
                        <span>= Subtotal con IVA</span>
                        <span>{fmtCurrency(cSub + cIvaAmt, form.currency)}</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            {/* Retenciones */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Retención IVA <span className="text-muted-foreground font-normal text-[10px]">(opcional)</span></Label>
                <Input type="number" value={form.retencionIva} onChange={e => setForm(p => ({ ...p, retencionIva: e.target.value }))} placeholder="0.00" min={0} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Retención ISR <span className="text-muted-foreground font-normal text-[10px]">(opcional)</span></Label>
                <Input type="number" value={form.retencionIsr} onChange={e => setForm(p => ({ ...p, retencionIsr: e.target.value }))} placeholder="0.00" min={0} />
              </div>
            </div>
            {/* Total */}
            <div className="flex items-center justify-between rounded-lg bg-[#027495]/8 border border-[#027495]/25 px-3 py-2.5">
              <span className="text-sm font-semibold text-[#0F3D4C]">Total de la factura</span>
              <span className="text-base font-bold text-[#0F3D4C]">
                {cTotal > 0 ? fmtCurrency(cTotal, form.currency) : '—'}
              </span>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Comentario para el equipo interno <span className="text-muted-foreground font-normal">(opcional)</span></Label>
            <Textarea
              rows={3}
              value={form.supplierComment}
              onChange={e => setForm(p => ({ ...p, supplierComment: e.target.value }))}
              placeholder={isResubmit ? "Explica qué corregiste o agrega contexto adicional…" : "Agrega notas, aclaraciones o información adicional sobre esta factura…"}
              className="text-sm resize-none"
            />
          </div>
          <FileUploadField label="PDF de factura (requerido)" accept=".pdf" file={pdfFile} onChange={setPdfFile} required />
          <FileUploadField label="XML / CFDI (opcional)" accept=".xml" file={xmlFile} onChange={setXmlFile} />
          <FileUploadField label="Archivo de soporte (opcional)" accept=".pdf,.xls,.xlsx,.zip" file={supportFile} onChange={setSupportFile} />
        </div>
          </div>
        </div>
        <DialogFooter className="px-6 py-4 border-t border-border shrink-0">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={saving} className={isResubmit ? 'gap-2' : 'gap-2 bg-[#0F3D4C] hover:bg-[#0A2F3B] text-white'} variant={isResubmit ? 'destructive' : 'default'}>
            <Upload className="w-4 h-4" />{saving ? 'Enviando...' : isResubmit ? 'Reenviar factura' : 'Enviar factura'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FileUploadField({ label, accept, file, onChange, required }: {
  label: string; accept: string; file: File | null; onChange: (f: File | null) => void; required?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}{required && <span className="text-destructive"> *</span>}</Label>
      <div className="flex items-center gap-2">
        <label className="flex-1 cursor-pointer">
          <div className={`border-2 border-dashed rounded-lg px-3 py-2 text-sm text-center transition-colors ${file ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:border-primary/50'}`}>
            {file ? `✓ ${file.name}` : 'Seleccionar archivo...'}
          </div>
          <input type="file" className="hidden" accept={accept} onChange={e => onChange(e.target.files?.[0] ?? null)} />
        </label>
        {file && <Button size="sm" variant="ghost" onClick={() => onChange(null)} className="text-muted-foreground h-8 w-8 p-0">×</Button>}
      </div>
    </div>
  );
}

// ── Cancelled POs ─────────────────────────────────────────────────────────────
function CancelledPOsSection({ pos, onSelect }: { pos: PO[]; onSelect: (po: PO) => void }) {
  const [page, setPage] = useState(1);
  if (pos.length === 0) return null;

  const totalPages = Math.ceil(pos.length / PAGE_SIZE);
  const paginated = pos.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center shrink-0">
          <Ban className="w-3.5 h-3.5 text-muted-foreground" />
        </div>
        <div>
          <h3 className="text-sm font-semibold leading-tight">Órdenes canceladas</h3>
          <p className="text-xs text-muted-foreground">Estas órdenes de compra han sido canceladas</p>
        </div>
        <Badge variant="outline" className="ml-auto shrink-0 text-muted-foreground">{pos.length}</Badge>
      </div>
      <div className="space-y-3">
        {paginated.map(po => (
          <div
            key={po.id}
            className="bg-card border border-border rounded-xl p-4 opacity-80 cursor-pointer hover:opacity-100 transition-opacity"
            onClick={() => onSelect(po)}
          >
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono font-bold text-sm text-muted-foreground">#{po.poNumber}</span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-muted text-muted-foreground border-border">
                    <Ban className="w-2.5 h-2.5" /> Cancelada
                  </span>
                  {po.projectCode && <span className="text-[10px] text-muted-foreground">{po.projectCode}</span>}
                </div>
                {po.serviceDescription && (
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2 leading-snug">{po.serviceDescription}</p>
                )}
              </div>
              <span className="font-bold text-base whitespace-nowrap text-muted-foreground line-through">{fmtCurrency(po.totalAmount, po.currency ?? undefined)}</span>
            </div>

            {po.cancellationReason && (
              <div className="mt-3 flex gap-2.5 p-3 rounded-lg bg-muted/50 border border-border">
                <XCircle className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-0.5">Motivo de cancelación</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{po.cancellationReason}</p>
                </div>
              </div>
            )}

            <div className="mt-3 pt-3 border-t border-border/60 flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>El pago asociado a esta orden ha sido cancelado.</span>
              <a
                href="mailto:compras@sapience.com.mx"
                onClick={e => e.stopPropagation()}
                className="ml-auto inline-flex items-center gap-1 text-primary hover:underline font-medium"
              >
                <Mail className="w-3 h-3" /> compras@sapience.com.mx
              </a>
            </div>
          </div>
        ))}
        {totalPages > 1 && (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <PaginationBar
              page={page} totalPages={totalPages} total={pos.length} pageSize={PAGE_SIZE}
              onPrev={() => setPage(p => p - 1)} onNext={() => setPage(p => p + 1)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Pagination bar ────────────────────────────────────────────────────────────
function PaginationBar({ page, totalPages, total, pageSize, onPrev, onNext }: {
  page: number; totalPages: number; total: number; pageSize: number;
  onPrev: () => void; onNext: () => void;
}) {
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="flex items-center justify-between px-4 py-2.5 border-t border-border bg-muted/20">
      <span className="text-xs text-muted-foreground">Mostrando {from}–{to} de {total}</span>
      <div className="flex items-center gap-1.5">
        <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs gap-1" onClick={onPrev} disabled={page <= 1}>
          <ChevronLeft className="w-3 h-3" /> Anterior
        </Button>
        <span className="text-xs text-muted-foreground px-1">{page} / {totalPages}</span>
        <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs gap-1" onClick={onNext} disabled={page >= totalPages}>
          Siguiente <ChevronRight className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );
}

const PAGE_SIZE = 8;

// ── Pending POs (no invoice yet) ──────────────────────────────────────────────
function PendingPOsSection({ pos, onUpload, onSelect }: { pos: PO[]; onUpload: (po: PO) => void; onSelect: (po: PO) => void }) {
  const [page, setPage] = useState(1);
  if (pos.length === 0) return null;

  const totalPages = Math.ceil(pos.length / PAGE_SIZE);
  const paginated = pos.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-lg bg-orange-100 flex items-center justify-center shrink-0">
          <FileClock className="w-3.5 h-3.5 text-orange-600" />
        </div>
        <div>
          <h3 className="text-sm font-semibold leading-tight">Pendientes de facturar</h3>
          <p className="text-xs text-muted-foreground">Sube tu factura para iniciar el proceso de pago</p>
        </div>
        <Badge variant="outline" className="ml-auto shrink-0">{pos.length}</Badge>
      </div>
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-2.5 text-xs font-semibold"># OC</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold">Proyecto</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold">Servicio</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold">Monto</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold">Fecha</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold">Estado</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {paginated.map(po => (
                <tr
                  key={po.id}
                  className="hover:bg-muted/30 transition-colors cursor-pointer"
                  onClick={() => onSelect(po)}
                >
                  <td className="px-4 py-3 font-mono font-semibold text-primary"># {po.poNumber}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{po.projectCode ?? '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground max-w-[200px]"><span className="line-clamp-2">{po.serviceDescription || '—'}</span></td>
                  <td className="px-4 py-3 font-semibold whitespace-nowrap">{fmtCurrency(po.totalAmount, po.currency ?? undefined)}</td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmtDate(po.issueDate)}</td>
                  <td className="px-4 py-3">
                    {po.status && <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${PO_STATUS_STYLES[po.status] ?? 'bg-muted text-muted-foreground border-border'}`}>{po.status}</span>}
                  </td>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <Button size="sm" variant="outline" className="gap-1.5 h-7 text-xs border-[#027495]/30 text-[#027495] hover:bg-[#027495]/5 hover:text-[#027495]" onClick={() => onUpload(po)}>
                      <Upload className="w-3 h-3" /> Subir factura
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <PaginationBar
            page={page} totalPages={totalPages} total={pos.length} pageSize={PAGE_SIZE}
            onPrev={() => setPage(p => p - 1)} onNext={() => setPage(p => p + 1)}
          />
        )}
      </div>
    </div>
  );
}

// ── History (already resolved by another route — read-only, still consultable) ──
function HistoryPOsSection({ pos, onSelect }: { pos: PO[]; onSelect: (po: PO) => void }) {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>('Todos');
  if (pos.length === 0) return null;

  const statuses = ['Todos', ...Array.from(new Set(pos.map(p => p.status).filter(Boolean) as string[]))];
  const filtered = statusFilter === 'Todos' ? pos : pos.filter(p => p.status === statusFilter);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center shrink-0">
          <List className="w-3.5 h-3.5 text-muted-foreground" />
        </div>
        <div>
          <h3 className="text-sm font-semibold leading-tight">Historial</h3>
          <p className="text-xs text-muted-foreground">Órdenes ya resueltas — consulta, no requieren acción</p>
        </div>
        <Badge variant="outline" className="ml-auto shrink-0 text-muted-foreground">{pos.length}</Badge>
      </div>
      {statuses.length > 2 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {statuses.map(s => (
            <button
              key={s}
              onClick={() => { setStatusFilter(s); setPage(1); }}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${statusFilter === s ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-muted-foreground border-border hover:text-foreground'}`}
            >
              {s}
            </button>
          ))}
        </div>
      )}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-2.5 text-xs font-semibold"># OC</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold">Proyecto</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold">Servicio</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold">Monto</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold">Fecha</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {paginated.map(po => (
                <tr
                  key={po.id}
                  className="hover:bg-muted/30 transition-colors cursor-pointer"
                  onClick={() => onSelect(po)}
                >
                  <td className="px-4 py-3 font-mono font-semibold text-muted-foreground"># {po.poNumber}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{po.projectCode ?? '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground max-w-[200px]"><span className="line-clamp-2">{po.serviceDescription || '—'}</span></td>
                  <td className="px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">{fmtCurrency(po.totalAmount, po.currency ?? undefined)}</td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmtDate(po.issueDate)}</td>
                  <td className="px-4 py-3">
                    {po.status && <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${PO_STATUS_STYLES[po.status] ?? 'bg-muted text-muted-foreground border-border'}`}>{po.status}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <PaginationBar
            page={page} totalPages={totalPages} total={filtered.length} pageSize={PAGE_SIZE}
            onPrev={() => setPage(p => p - 1)} onNext={() => setPage(p => p + 1)}
          />
        )}
      </div>
    </div>
  );
}

// ── Rejected POs (need correction) ───────────────────────────────────────────
function RejectedPOsSection({ pos, onResubmit, onSelect }: { pos: PO[]; onResubmit: (po: PO) => void; onSelect: (po: PO) => void }) {
  const [page, setPage] = useState(1);
  if (pos.length === 0) return null;

  const totalPages = Math.ceil(pos.length / PAGE_SIZE);
  const paginated = pos.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-lg bg-destructive/15 flex items-center justify-center shrink-0">
          <FileX className="w-3.5 h-3.5 text-destructive" />
        </div>
        <div>
          <h3 className="text-sm font-semibold leading-tight">Por corregir</h3>
          <p className="text-xs text-destructive/70">Facturas rechazadas — acción requerida</p>
        </div>
        <Badge variant="destructive" className="ml-auto shrink-0">{pos.length}</Badge>
      </div>
      <div className="space-y-3">
        {paginated.map(po => (
          <div
            key={po.id}
            className="bg-card border-2 border-destructive/30 rounded-xl p-4 cursor-pointer hover:border-destructive/50 transition-colors"
            onClick={() => onSelect(po)}
          >
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono font-bold text-sm text-primary">#{po.poNumber}</span>
                  {po.status && <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${PO_STATUS_STYLES[po.status] ?? 'bg-muted text-muted-foreground border-border'}`}>{po.status}</span>}
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-red-100 text-red-700 border-red-200">
                    <XCircle className="w-2.5 h-2.5" /> Factura rechazada
                  </span>
                  {po.projectCode && <span className="text-[10px] text-muted-foreground">{po.projectCode}</span>}
                </div>
                {po.serviceDescription && (
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2 leading-snug">{po.serviceDescription}</p>
                )}
              </div>
              <span className="font-bold text-base whitespace-nowrap">{fmtCurrency(po.totalAmount, po.currency ?? undefined)}</span>
            </div>
            {po.invoiceReviewNotes && (
              <div className="mt-3 flex gap-2.5 p-3 rounded-lg bg-destructive/5 border border-destructive/20">
                <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-destructive mb-0.5">Motivo de rechazo</p>
                  <p className="text-xs text-destructive/80 leading-relaxed">{po.invoiceReviewNotes}</p>
                </div>
              </div>
            )}
            <div className="mt-3 pt-3 border-t border-border/60 flex items-center justify-between gap-3 flex-wrap" onClick={e => e.stopPropagation()}>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Receipt className="w-3.5 h-3.5" />
                <span>Factura anterior: <span className="font-semibold">{po.invoiceNumber ?? '—'}</span></span>
                <span>·</span>
                <span>Enviada {fmtDate(po.invoiceUploadDate)}</span>
              </div>
              <Button size="sm" variant="destructive" className="gap-1.5 h-8 text-xs" onClick={e => { e.stopPropagation(); onResubmit(po); }}>
                <Upload className="w-3 h-3" /> Reenviar factura
              </Button>
            </div>
          </div>
        ))}
        {totalPages > 1 && (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <PaginationBar
              page={page} totalPages={totalPages} total={pos.length} pageSize={PAGE_SIZE}
              onPrev={() => setPage(p => p - 1)} onNext={() => setPage(p => p + 1)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Invoiced POs ──────────────────────────────────────────────────────────────
const INV_FILTER_STATUSES = ['Todos', 'Pendiente', 'En revisión', 'Validada'] as const;

function InvoicedPOsSection({ pos, onSelect }: { pos: PO[]; onSelect: (po: PO) => void }) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('Todos');
  const [page, setPage] = useState(1);

  const sorted = useMemo(() =>
    [...pos].sort((a, b) => (b.invoiceUploadDate ?? '').localeCompare(a.invoiceUploadDate ?? '')),
    [pos],
  );

  const filtered = useMemo(() => {
    setPage(1);
    return sorted.filter(po => {
      if (statusFilter !== 'Todos' && po.invoiceStatus !== statusFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          String(po.poNumber ?? '').toLowerCase().includes(q) ||
          (po.serviceDescription ?? '').toLowerCase().includes(q) ||
          (po.invoiceNumber ?? '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted, search, statusFilter]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="space-y-4">
      {/* Search + status filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por OC, servicio o factura…"
            className="w-full pl-8 pr-3 h-8 text-xs rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {INV_FILTER_STATUSES.map(s => {
            const count = s === 'Todos' ? pos.length : pos.filter(p => p.invoiceStatus === s).length;
            const active = statusFilter === s;
            return (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors whitespace-nowrap ${
                  active ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-muted-foreground border-border hover:border-primary/50'
                }`}>
                {s}{s !== 'Todos' && ` (${count})`}
              </button>
            );
          })}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8 bg-card border rounded-xl">No hay órdenes que coincidan con la búsqueda.</p>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="divide-y divide-border">
            {paginated.map(po => (
              <div
                key={po.id}
                className="p-4 cursor-pointer hover:bg-muted/30 transition-colors"
                onClick={() => onSelect(po)}
              >
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-bold text-sm text-primary">#{po.poNumber}</span>
                      {po.status && <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${PO_STATUS_STYLES[po.status] ?? 'bg-muted text-muted-foreground border-border'}`}>{po.status}</span>}
                      {po.projectCode && <span className="text-[10px] text-muted-foreground">{po.projectCode}</span>}
                    </div>
                    {po.serviceDescription && (
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2 leading-snug">{po.serviceDescription}</p>
                    )}
                  </div>
                  <span className="font-bold text-base whitespace-nowrap">{fmtCurrency(po.totalAmount, po.currency ?? undefined)}</span>
                </div>
                <div className="mt-3 pt-3 border-t border-border/60 flex items-center gap-3 flex-wrap">
                  <Receipt className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="text-xs font-semibold">{po.invoiceNumber ?? '—'}</span>
                  <span className="text-xs text-muted-foreground">
                    {fmtCurrency(po.invoiceAmount, po.invoiceCurrency ?? undefined)}
                    {po.invoiceSubtotal && po.invoiceSubtotal !== po.invoiceAmount && (
                      <span className="ml-1 text-[10px] opacity-60">(sub: {fmtCurrency(po.invoiceSubtotal, po.invoiceCurrency ?? undefined)})</span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">Enviada {fmtDate(po.invoiceUploadDate)}</span>
                  {po.invoiceStatus && (
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${INV_STATUS_STYLES[po.invoiceStatus] ?? 'bg-muted text-muted-foreground border-border'}`}>
                      {po.invoiceStatus === 'Validada' && <CheckCircle2 className="w-2.5 h-2.5" />}
                      {(po.invoiceStatus === 'En revisión' || po.invoiceStatus === 'Pendiente') && <Clock className="w-2.5 h-2.5" />}
                      {po.invoiceStatus}
                    </span>
                  )}
                  {(po.pdfUrl || (po.pdfFile && po.pdfFile.length > 0)) && (
                    <a
                      href={po.pdfUrl || po.pdfFile![0].url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="ml-auto inline-flex items-center gap-1 text-[11px] text-primary hover:underline font-medium"
                    >
                      <Download className="w-3 h-3" /> Ver OC
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
          {totalPages > 1 && (
            <PaginationBar
              page={page} totalPages={totalPages} total={filtered.length} pageSize={PAGE_SIZE}
              onPrev={() => setPage(p => p - 1)} onNext={() => setPage(p => p + 1)}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ── Payments Calendar ─────────────────────────────────────────────────────────
function PaymentsCalendar({ payments }: { payments: Payment[] }) {
  const [current, setCurrent] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const year = current.getFullYear();
  const month = current.getMonth();
  const today = getToday();

  const paymentsByDay = useMemo(() => {
    const map: Record<string, Payment[]> = {};
    payments.forEach(p => {
      if (!p.dueDate) return;
      const key = p.dueDate.split('T')[0];
      (map[key] ??= []).push(p);
    });
    return map;
  }, [payments]);

  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const dayKey = (d: number) =>
    `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  return (
    <div className="bg-card border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
        <button onClick={() => setCurrent(new Date(year, month - 1, 1))} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <h3 className="text-sm font-semibold capitalize">
          {current.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })}
        </h3>
        <button onClick={() => setCurrent(new Date(year, month + 1, 1))} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
      <div className="flex items-center justify-center gap-4 px-4 py-2 border-b bg-muted/10">
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><span className="w-3 h-1 rounded-full bg-yellow-400" />Programado</span>
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><span className="w-3 h-1 rounded-full bg-green-500" />Realizado</span>
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><span className="w-3 h-1 rounded-full bg-red-400" />Cancelado</span>
      </div>
      <div className="grid grid-cols-7 border-b">
        {['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map(d => (
          <div key={d} className="text-center text-xs font-semibold text-muted-foreground py-2">{d}</div>
        ))}
      </div>
      {weeks.map((week, wi) => (
        <div key={wi} className="grid grid-cols-7 border-b last:border-0 divide-x divide-border">
          {week.map((day, di) => {
            if (!day) return <div key={di} className="min-h-[100px] bg-muted/10" />;
            const key = dayKey(day);
            const dayPayments = paymentsByDay[key] ?? [];
            const cellDate = new Date(year, month, day);
            const isToday = cellDate.getTime() === today.getTime();
            const isPast = cellDate < today;
            const hasOverdue = isPast && dayPayments.some(p => p.status === 'Programado');
            return (
              <div key={di} className={`min-h-[100px] p-1.5 ${isToday ? 'bg-primary/5' : ''}`}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className={`text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full ${isToday ? 'bg-primary text-primary-foreground' : isPast ? 'text-muted-foreground' : 'text-foreground'}`}>
                    {day}
                  </span>
                  {hasOverdue && <AlertCircle className="w-3 h-3 text-destructive" />}
                </div>
                <div className="space-y-0.5">
                  {dayPayments.slice(0, 2).map(p => (
                    <div key={p.id} className={`w-full px-1.5 py-1 rounded border-l-2 bg-muted/50 ${PAYMENT_STATUS_BORDER[p.status ?? ''] ?? 'border-border'}`}>
                      <p className="text-[10px] font-medium truncate leading-tight">{fmtCurrency(p.amount, p.currency)}</p>
                      <p className="text-[10px] text-muted-foreground leading-tight">{p.status ?? '—'}</p>
                    </div>
                  ))}
                  {dayPayments.length > 2 && (
                    <p className="text-[10px] text-muted-foreground pl-1">+{dayPayments.length - 2} más</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ── Payments Table ────────────────────────────────────────────────────────────
function PaymentsTable({ payments }: { payments: Payment[] }) {
  if (payments.length === 0) return <p className="text-sm text-muted-foreground text-center py-8">No hay pagos registrados aún.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="text-left px-4 py-2.5 text-xs font-semibold"># Pago</th>
            <th className="text-left px-4 py-2.5 text-xs font-semibold">ODC</th>
            <th className="text-left px-4 py-2.5 text-xs font-semibold">Monto</th>
            <th className="text-left px-4 py-2.5 text-xs font-semibold">Moneda</th>
            <th className="text-left px-4 py-2.5 text-xs font-semibold">Fecha comprometida</th>
            <th className="text-left px-4 py-2.5 text-xs font-semibold">Status</th>
            <th className="text-left px-4 py-2.5 text-xs font-semibold">Comprobante</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {payments.map(p => (
            <tr key={p.id} className="hover:bg-muted/30 transition-colors">
              <td className="px-4 py-3 font-mono text-xs font-semibold text-primary">{String(p.paymentId ?? '—')}</td>
              <td className="px-4 py-3 text-xs">{p.poNumber ? `ODC-${p.poNumber}` : '—'}</td>
              <td className="px-4 py-3 font-bold whitespace-nowrap">{fmtCurrency(p.amount, p.currency)}</td>
              <td className="px-4 py-3">
                {p.currency && (
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${p.currency === 'USD' ? 'bg-green-100 text-green-700 border-green-200' : 'bg-blue-100 text-blue-700 border-blue-200'}`}>
                    {p.currency}
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-xs whitespace-nowrap">{fmtDate(p.dueDate)}</td>
              <td className="px-4 py-3">
                {p.status && (
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${PAYMENT_STATUS_STYLES[p.status] ?? 'bg-muted text-muted-foreground border-border'}`}>
                    {p.status}
                  </span>
                )}
              </td>
              <td className="px-4 py-3">
                {(p.attachment ?? []).length > 0 ? (
                  <div className="flex flex-col gap-1">
                    {(p.attachment ?? []).map((a, i) => (
                      <a key={i} href={a.url} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline font-medium">
                        <Paperclip className="w-3 h-3 shrink-0" />
                        {(p.attachment ?? []).length > 1 ? `Ver comprobante ${i + 1}` : 'Ver comprobante'}
                      </a>
                    ))}
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Payments tab content ──────────────────────────────────────────────────────
function PaymentsTabContent({ payments }: { payments: Payment[] }) {
  const [view, setView] = useState<'table' | 'calendar'>('table');

  const totalProgramado = useMemo(
    () => payments.filter(p => p.status === 'Programado').reduce((s, p) => s + (p.amount ?? 0), 0),
    [payments],
  );
  const totalRealizado = useMemo(
    () => payments.filter(p => p.status === 'Realizado').reduce((s, p) => s + (p.amount ?? 0), 0),
    [payments],
  );

  if (payments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
        <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center">
          <Wallet className="w-7 h-7 text-muted-foreground" />
        </div>
        <div>
          <p className="font-semibold text-sm">Sin pagos registrados</p>
          <p className="text-xs text-muted-foreground mt-1">Los pagos asociados a tus órdenes de compra aparecerán aquí.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-card border rounded-xl p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-yellow-100 flex items-center justify-center shrink-0">
            <Clock className="w-4 h-4 text-yellow-600" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Por cobrar</p>
            <p className="text-base font-bold">{fmtCurrency(totalProgramado)}</p>
          </div>
        </div>
        <div className="bg-card border rounded-xl p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-green-100 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Total cobrado</p>
            <p className="text-base font-bold">{fmtCurrency(totalRealizado)}</p>
          </div>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/20">
          <span className="text-xs text-muted-foreground font-medium">{payments.length} pago{payments.length !== 1 ? 's' : ''}</span>
          <div className="flex items-center bg-muted rounded-lg p-0.5 gap-0.5">
            <button onClick={() => setView('table')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${view === 'table' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              <List className="w-3 h-3" /> Tabla
            </button>
            <button onClick={() => setView('calendar')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${view === 'calendar' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              <CalendarDays className="w-3 h-3" /> Calendario
            </button>
          </div>
        </div>
        {view === 'table' ? <PaymentsTable payments={payments} /> : (
          <div className="p-3"><PaymentsCalendar payments={payments} /></div>
        )}
      </div>
    </div>
  );
}

// ── Tab bar ───────────────────────────────────────────────────────────────────
interface TabDef {
  id: TabId;
  label: string;
  icon: React.ReactNode;
  count: number;
  urgent?: boolean;
}

function TabBar({ tabs, active, onChange }: { tabs: TabDef[]; active: TabId; onChange: (t: TabId) => void }) {
  return (
    <div className="flex gap-1 bg-[#0A2F3B] px-4 overflow-x-auto">
      {tabs.map(tab => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={`relative flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px ${
              isActive
                ? 'border-[#6FC2DA] text-white'
                : 'border-transparent text-[#8FB6C0] hover:text-white'
            }`}
          >
            {tab.icon}
            {tab.label}
            {tab.count > 0 && (
              <span className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold ${
                isActive ? 'bg-white/15 text-white' : 'bg-white/10 text-[#8FB6C0]'
              }`}>
                {tab.count}
              </span>
            )}
            {tab.urgent && (
              <span className="absolute top-2 right-1 w-2 h-2 rounded-full bg-destructive" />
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Main portal ───────────────────────────────────────────────────────────────
export default function SupplierPortalPage() {
  const { token = '' } = useParams<{ token: string }>();
  const sessionKey = `portal-pw-${token}`;

  const [password, setPassword] = useState(() => sessionStorage.getItem(sessionKey) ?? '');
  const [verified, setVerified] = useState(!!sessionStorage.getItem(sessionKey));
  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [uploadPO, setUploadPO] = useState<PO | null>(null);
  const [selectedPO, setSelectedPO] = useState<PO | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('ordenes');

  const load = useCallback(async (pw: string) => {
    setLoading(true); setError('');
    try {
      const result = await getSupplierPortalData({ token, password: pw });
      setData(result);
      setVerified(true);
      sessionStorage.setItem(sessionKey, pw);
      const hasRejected = result.purchaseOrders.some(p => p.invoiceStatus === 'Rechazada');
      if (hasRejected) setActiveTab('ordenes');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error de acceso');
      setVerified(false);
      sessionStorage.removeItem(sessionKey);
    } finally { setLoading(false); }
  }, [token, sessionKey]);

  useEffect(() => { if (password && verified) load(password); }, []);

  const handleVerify = (pw: string) => { setPassword(pw); load(pw); };

  const pos = data?.purchaseOrders ?? [];
  // Estatus donde la factura ya quedó resuelta por otra vía (casi siempre OCs
  // de antes de que existiera este portal) — sin esto, una OC ya "Pagada" sin
  // invoiceStatus en el portal seguía apareciendo en "Pendientes de facturar"
  // con botón de subir, confundiendo al proveedor.
  const INVOICE_RESOLVED_STATUSES = new Set(['Factura recibida', 'Factura validada', 'Pago programado', 'Pagada']);
  const cancelledPos = pos.filter(p => p.status === 'Cancelada');
  const pendingPos   = pos.filter(p => !p.invoiceStatus && p.status !== 'Cancelada' && !INVOICE_RESOLVED_STATUSES.has(p.status ?? ''));
  // Ya resueltas por otra vía (casi siempre de antes de que existiera este
  // portal) — no van en "Pendientes" (nada que subir) ni en "Facturas" (no
  // hay un registro de invoice del portal que mostrar), pero el proveedor
  // debe poder seguir consultándolas.
  const historyPos   = pos.filter(p => !p.invoiceStatus && p.status !== 'Cancelada' && INVOICE_RESOLVED_STATUSES.has(p.status ?? ''));
  const invoicedPos  = pos.filter(p => p.invoiceStatus && p.invoiceStatus !== 'Rechazada' && p.status !== 'Cancelada');
  const rejectedPos  = pos.filter(p => p.invoiceStatus === 'Rechazada' && p.status !== 'Cancelada');
  const payments     = data?.payments ?? [];

  const tabs: TabDef[] = [
    {
      id: 'ordenes',
      label: 'Órdenes de compra',
      icon: <ShoppingCart className="w-4 h-4" />,
      count: pendingPos.length + rejectedPos.length + cancelledPos.length + historyPos.length,
      urgent: rejectedPos.length > 0,
    },
    {
      id: 'facturas',
      label: 'Facturas',
      icon: <FileText className="w-4 h-4" />,
      count: invoicedPos.length,
    },
    {
      id: 'pagos',
      label: 'Pagos',
      icon: <Wallet className="w-4 h-4" />,
      count: payments.length,
    },
  ];

  const handleSelectPO = (po: PO) => setSelectedPO(po);
  const handleUploadFromDetail = (po: PO) => { setSelectedPO(null); setUploadPO(po); };

  if (!verified && !loading) return <VerifyScreen onVerify={handleVerify} error={error} />;

  if (loading) return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center">
      <div className="space-y-4 w-full max-w-2xl px-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-muted/30">
      <Toaster richColors position="top-right" />

      {/* Header */}
      <header className="bg-[#0F3D4C] border-b border-[#0A2F3B] sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-3">
          <img src={BRAND_LOGO_URL} alt="Sapience" className="h-7 w-auto shrink-0" />
          <div className="w-px h-7 bg-white/15 shrink-0" />
          <div className="min-w-0">
            <h1 className="font-bold text-base leading-tight text-white">Portal de Proveedores</h1>
            {data && <p className="text-xs text-[#8FB6C0] truncate">{data.supplier.name}</p>}
          </div>
        </div>
        <div className="max-w-4xl mx-auto">
          <TabBar tabs={tabs} active={activeTab} onChange={setActiveTab} />
        </div>
      </header>

      {/* Tab content */}
      <main className="max-w-4xl mx-auto px-4 py-6">

        {/* ── Pestaña 1: Órdenes de compra ── */}
        {activeTab === 'ordenes' && (
          <div className="space-y-8">
            {rejectedPos.length === 0 && pendingPos.length === 0 && cancelledPos.length === 0 && historyPos.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
                <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center">
                  <FileCheck className="w-7 h-7 text-muted-foreground" />
                </div>
                <div>
                  <p className="font-semibold text-sm">Todo en orden</p>
                  <p className="text-xs text-muted-foreground mt-1">No tienes órdenes de compra pendientes de facturar.</p>
                </div>
              </div>
            ) : (
              <>
                {rejectedPos.length > 0 && (
                  <RejectedPOsSection pos={rejectedPos} onResubmit={setUploadPO} onSelect={handleSelectPO} />
                )}
                {pendingPos.length > 0 && (
                  <PendingPOsSection pos={pendingPos} onUpload={setUploadPO} onSelect={handleSelectPO} />
                )}
                {cancelledPos.length > 0 && (
                  <CancelledPOsSection pos={cancelledPos} onSelect={handleSelectPO} />
                )}
                {historyPos.length > 0 && (
                  <HistoryPOsSection pos={historyPos} onSelect={handleSelectPO} />
                )}
              </>
            )}
          </div>
        )}

        {/* ── Pestaña 2: Facturas ── */}
        {activeTab === 'facturas' && (
          <div>
            {invoicedPos.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
                <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center">
                  <FileText className="w-7 h-7 text-muted-foreground" />
                </div>
                <div>
                  <p className="font-semibold text-sm">Sin facturas enviadas</p>
                  <p className="text-xs text-muted-foreground mt-1">Las facturas que envíes aparecerán aquí con su estatus de revisión.</p>
                </div>
              </div>
            ) : (
              <InvoicedPOsSection pos={invoicedPos} onSelect={handleSelectPO} />
            )}
          </div>
        )}

        {/* ── Pestaña 3: Pagos ── */}
        {activeTab === 'pagos' && (
          <PaymentsTabContent payments={payments} />
        )}
      </main>

      {/* PO Detail Dialog */}
      <PODetailDialog
        po={selectedPO}
        open={!!selectedPO}
        onClose={() => setSelectedPO(null)}
        onUpload={handleUploadFromDetail}
      />

      <UploadInvoiceDialog
        po={uploadPO}
        open={!!uploadPO}
        onClose={() => setUploadPO(null)}
        token={token}
        password={password}
        onDone={() => load(password)}
      />
    </div>
  );
}
