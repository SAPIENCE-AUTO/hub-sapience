import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { Edit2, CheckCircle2, FileText, Mail, ExternalLink, Trash2, CreditCard, Send, XCircle, History, Loader2 } from 'lucide-react';
import PoAttachmentsSection from './PoAttachmentsSection';
import { getPoLineItems, generatePoPdf, sendPoEmail, getPayments, submitPurchaseOrder, rejectPurchaseOrder, cancelPurchaseOrder, getPoAuditLog, preparePoEmail, getPoPdfBase64, GetPoLineItemsOutputType, GetPurchaseOrdersOutputType, GetPaymentsOutputType, GetPoAuditLogOutputType, PreparePoEmailOutputType } from 'zite-endpoints-sdk';
import { toast } from 'sonner';
import { fmtCurrency } from '../../lib/format';

type PO = GetPurchaseOrdersOutputType['pos'][0];
type LineItem = GetPoLineItemsOutputType['lineItems'][0];
type Payment = GetPaymentsOutputType['payments'][0];
type AuditEntry = GetPoAuditLogOutputType['entries'][0];

const PAYMENT_STATUS_STYLES: Record<string, string> = {
  'Programado': 'bg-yellow-100 text-yellow-700',
  'Realizado': 'bg-green-100 text-green-700',
  'Cancelado': 'bg-red-100 text-red-700',
};

const STATUS_STYLES: Record<string, string> = {
  'Borrador': 'bg-muted text-muted-foreground',
  'Enviada a aprobación': 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
  'Aprobada': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  'Factura recibida': 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  'Factura validada': 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
  'Pago programado': 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
  'Pagada': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  'Cancelada': 'bg-destructive/10 text-destructive',
};

const ACTION_STYLES: Record<string, string> = {
  'Creada': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  'Editada': 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
  'Enviada a aprobación': 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  'Aprobada': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  'Rechazada': 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
  'Cancelada': 'bg-muted text-muted-foreground',
  'Eliminada': 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
};

// ── Flow stepper (7 steps including Enviada a aprobación) ────────────────────
const FLOW_STEPS = [
  { key: 'creada', label: 'Creada' },
  { key: 'enviada', label: 'Env. apr.' },
  { key: 'aprobada', label: 'Aprobada' },
  { key: 'factura', label: 'Factura' },
  { key: 'validada', label: 'Validada' },
  { key: 'programado', label: 'Prog. pago' },
  { key: 'pagada', label: 'Pagada' },
];

type StepState = 'done' | 'active' | 'pending';

function getStepIndex(enriched: string, base: string): number {
  if (enriched === 'Pagada') return 6;
  if (enriched === 'Pago programado') return 5;
  if (enriched === 'Factura validada') return 4;
  if (enriched === 'Factura recibida') return 3;
  if (enriched === 'Aprobada') return 2;
  if (base === 'Enviada a aprobación' || enriched === 'Enviada a aprobación') return 1;
  return 0;
}

function getStepStates(enriched: string, base: string): StepState[] {
  const idx = getStepIndex(enriched, base);
  return FLOW_STEPS.map((_, i) => {
    if (idx === FLOW_STEPS.length - 1) return 'done';
    if (i < idx) return 'done';
    if (i === idx) return 'active';
    return 'pending';
  });
}

function FlowStepper({ po }: { po: PO }) {
  const enriched = po.enrichedStatus ?? po.status ?? 'Borrador';
  const base = po.status ?? 'Borrador';
  if ((base === 'Borrador' && enriched !== 'Enviada a aprobación') || enriched === 'Cancelada') return null;
  const states = getStepStates(enriched, base);
  return (
    <div className="flex items-start w-full overflow-x-auto pb-1">
      {FLOW_STEPS.map((step, i) => {
        const state = states[i];
        const isLast = i === FLOW_STEPS.length - 1;
        return (
          <div key={step.key} className="flex items-start flex-1 min-w-0">
            <div className="flex flex-col items-center flex-shrink-0">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center border-2 text-[11px] font-bold transition-colors ${
                state === 'done' ? 'bg-primary border-primary text-primary-foreground' :
                state === 'active' ? 'bg-background border-primary text-primary' :
                'bg-background border-muted-foreground/25 text-muted-foreground/50'
              }`}>{state === 'done' ? '✓' : i + 1}</div>
              <span className={`text-[10px] mt-1 font-medium text-center leading-tight px-0.5 ${
                state === 'done' ? 'text-primary' :
                state === 'active' ? 'text-foreground font-semibold' : 'text-muted-foreground/60'
              }`}>{step.label}</span>
            </div>
            {!isLast && (
              <div className={`flex-1 h-0.5 mt-3.5 mx-1 rounded-full transition-colors ${
                states[i + 1] === 'pending' ? 'bg-muted-foreground/15' : 'bg-primary'
              }`} />
            )}
          </div>
        );
      })}
    </div>
  );
}


function fmtDate(d?: string) {
  if (!d) return '—';
  return new Date(d.split('T')[0] + 'T12:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtDateTime(d?: string) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">{label}</p>
      <p className="text-sm font-medium">{value || '—'}</p>
    </div>
  );
}

function LinesTable({ lines, currency, loading }: { lines: LineItem[]; currency?: string; loading: boolean }) {
  if (loading) return <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-8 w-full" />)}</div>;
  if (lines.length === 0) return <p className="text-sm text-muted-foreground py-3 text-center">Sin líneas de detalle</p>;
  const total = lines.reduce((s, l) => s + (l.total || 0), 0);
  return (
    <div className="border border-border rounded-lg overflow-hidden text-sm">
      <table className="w-full">
        <thead className="bg-muted/40">
          <tr>
            <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Descripción</th>
            <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground w-14">Cant.</th>
            <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground w-28">P. Unit.</th>
            <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground w-28">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {lines.map((l, i) => (
            <tr key={l.id ?? i} className="hover:bg-muted/20">
              <td className="px-3 py-2">{l.description || '—'}</td>
              <td className="px-3 py-2 text-right tabular-nums">{l.quantity}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtCurrency(l.unitPrice, currency)}</td>
              <td className={`px-3 py-2 text-right tabular-nums font-medium ${(l.total ?? 0) < 0 ? 'text-destructive' : ''}`}>{fmtCurrency(l.total, currency)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-muted/30 border-t border-border">
          <tr>
            <td colSpan={3} className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground">Total {currency ?? 'MXN'}</td>
            <td className="px-3 py-2 text-right font-bold tabular-nums">{fmtCurrency(total, currency)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function AuditLog({ entries, loading }: { entries: AuditEntry[]; loading: boolean }) {
  if (loading) return <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>;
  if (entries.length === 0) return <p className="text-sm text-muted-foreground italic">Sin historial disponible</p>;
  return (
    <div className="relative pl-1">
      <div className="absolute left-3 top-2 bottom-2 w-px bg-border" />
      <div className="space-y-4">
        {entries.map((entry, i) => (
          <div key={entry.id ?? i} className="flex gap-3">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 z-10 text-[10px] font-bold mt-0.5 ${ACTION_STYLES[entry.action ?? ''] ?? 'bg-muted text-muted-foreground'}`}>
              {(entry.action ?? '?')[0]}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${ACTION_STYLES[entry.action ?? ''] ?? 'bg-muted text-muted-foreground'}`}>
                  {entry.action}
                </span>
                <span className="text-xs text-muted-foreground font-medium">{entry.userName || entry.userEmail?.split('@')[0]}</span>
                <span className="text-xs text-muted-foreground">· {fmtDateTime(entry.timestamp)}</span>
              </div>
              {entry.comments && (
                <p className="text-xs text-muted-foreground mt-1 bg-muted/30 rounded px-2 py-1.5 leading-relaxed">{entry.comments}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

type EmailDraft = PreparePoEmailOutputType;

function SendEmailDialog({ po, open, onClose, onSent }: { po: PO; open: boolean; onClose: () => void; onSent: (email: string) => void }) {
  const [draft, setDraft] = useState<EmailDraft | null>(null);
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoadingDraft(true);
    setDraft(null);
    preparePoEmail({ poId: po.id })
      .then(d => {
        setDraft(d);
        setEmail(d.supplierEmail || po.emailSentTo || '');
        setSubject(d.subject);
        setBody(d.body);
      })
      .catch(() => {
        // Fallback if prepare fails
        setEmail(po.emailSentTo ?? '');
        setSubject(`Orden de Compra #${po.poNumber} – ${po.supplierName ?? ''}`);
        setBody('');
      })
      .finally(() => setLoadingDraft(false));
  }, [open, po.id]);

  const handleSend = async () => {
    if (!email.trim()) { toast.error('Ingresa un email destinatario'); return; }
    setSending(true);
    try {
      const res = await sendPoEmail({ poId: po.id, recipientEmail: email.trim(), subject, body });
      toast.success(res.message);
      onSent(email.trim());
      onClose();
    } catch (e: unknown) { toast.error((e as Error).message ?? 'Error al enviar'); }
    setSending(false);
  };

  const hasPdf = draft ? draft.hasPdf : !!(po.pdfUrl || po.hasPdf);

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="px-6 pt-5 pb-4 border-b flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Mail className="w-4 h-4" /> Enviar OC por Outlook
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Status chips */}
          <div className="flex flex-wrap gap-2">
            {hasPdf ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                📎 PDF adjunto: OC-{po.poNumber}.pdf
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300 border border-orange-200 dark:border-orange-800">
                ⚠️ Sin PDF — genera el PDF primero para adjuntarlo
              </span>
            )}
            {draft?.portalUrl && (
              <a
                href={draft.portalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300 border border-sky-200 dark:border-sky-800 hover:opacity-80 transition-opacity"
              >
                🔗 Portal del proveedor
              </a>
            )}
          </div>

          {loadingDraft ? (
            <div className="space-y-3">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-64 w-full" />
            </div>
          ) : (
            <>
              {/* To */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Para *</Label>
                <Input
                  placeholder="email@proveedor.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  type="email"
                />
              </div>

              {/* Subject */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Asunto</Label>
                <Input value={subject} onChange={e => setSubject(e.target.value)} />
              </div>

              {/* Body */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Cuerpo del mensaje</Label>
                <Textarea
                  rows={16}
                  className="resize-y text-sm font-mono leading-relaxed"
                  value={body}
                  onChange={e => setBody(e.target.value)}
                />
                <p className="text-[10px] text-muted-foreground">
                  Puedes editar el texto libremente. El PDF se adjuntará automáticamente si está disponible.
                </p>
              </div>
            </>
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t flex-shrink-0">
          <Button variant="ghost" onClick={onClose} disabled={sending}>Cancelar</Button>
          <Button onClick={handleSend} disabled={sending || loadingDraft} className="gap-1.5">
            <Mail className="w-3.5 h-3.5" />
            {sending ? 'Enviando...' : 'Enviar por Outlook'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface Props {
  po: PO | null;
  open: boolean;
  onClose: () => void;
  canApprove: boolean;
  userLevel: string;
  userEmail: string;
  userCostCenters?: string[];
  onEdit: (po: PO) => void;
  onApprove: (po: PO) => void;
  onDelete: (po: PO) => void;
  onUpdate?: (id: string, changes: Partial<PO>) => void;
}

export default function PODetailSheet({ po, open, onClose, canApprove, userLevel, userEmail, userCostCenters = [], onEdit, onApprove, onDelete, onUpdate }: Props) {
  const [lines, setLines] = useState<LineItem[]>([]);
  const [linesLoading, setLinesLoading] = useState(false);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [pdfBase64Preview, setPdfBase64Preview] = useState<string | null>(null);
  const [pdfPreviewLoading, setPdfPreviewLoading] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectComments, setRejectComments] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelComments, setCancelComments] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [localPdfUrl, setLocalPdfUrl] = useState<string | undefined>();
  const [localEmailSentAt, setLocalEmailSentAt] = useState<string | undefined>();
  const [localEmailSentTo, setLocalEmailSentTo] = useState<string | undefined>();

  useEffect(() => {
    if (!open || !po) return;
    // Mark this PO as seen in localStorage
    try {
      const seen: string[] = JSON.parse(localStorage.getItem('po-seen-ids') ?? '[]');
      if (!seen.includes(po.id)) {
        seen.push(po.id);
        localStorage.setItem('po-seen-ids', JSON.stringify(seen));
      }
      window.dispatchEvent(new Event('po-seen-updated'));
    } catch { /* silent */ }
    setLocalPdfUrl(po.pdfUrl);
    setLocalEmailSentAt(po.emailSentAt);
    setLocalEmailSentTo(po.emailSentTo);
    setPdfBase64Preview(null);
    setLinesLoading(true);
    setAuditLoading(true);

    // Auto-load PDF preview if PO already has a PDF (via URL or stored base64)
    if (po.pdfUrl || po.hasPdf) {
      setPdfPreviewLoading(true);
      getPoPdfBase64({ poId: po.id })
        .then(r => setPdfBase64Preview(r.pdfBase64))
        .catch(() => setPdfBase64Preview(null))
        .finally(() => setPdfPreviewLoading(false));
    }
    getPoLineItems({ poId: po.id })
      .then(d => setLines(d.lineItems))
      .catch(() => setLines([]))
      .finally(() => setLinesLoading(false));
    getPayments({}).then(d => {
      setPayments(d.payments.filter(p => p.poId === po.id));
    }).catch(() => setPayments([]));
    getPoAuditLog({ poId: po.id })
      .then(d => setAuditLog(d.entries))
      .catch(() => setAuditLog([]))
      .finally(() => setAuditLoading(false));
  }, [open, po?.id]);

  const handleGeneratePdf = async () => {
    if (!po) return;
    setGeneratingPdf(true);
    setPdfBase64Preview(null);
    try {
      const res = await generatePoPdf({ id: po.id });
      toast.success(res.message);
      setLocalPdfUrl(res.pdfUrl ?? undefined);
      onUpdate?.(po.id, { pdfUrl: res.pdfUrl ?? undefined });
      if (res.pdfBase64) setPdfBase64Preview(res.pdfBase64);
    } catch (e: unknown) { toast.error((e as Error).message ?? 'Error al generar PDF'); }
    setGeneratingPdf(false);
  };

  const handleSubmit = async () => {
    if (!po) return;
    setSubmitting(true);
    try {
      await submitPurchaseOrder({ id: po.id });
      toast.success('OC enviada a aprobación correctamente');
      onUpdate?.(po.id, { status: 'Enviada a aprobación' });
      setAuditLoading(true);
      getPoAuditLog({ poId: po.id }).then(d => setAuditLog(d.entries)).finally(() => setAuditLoading(false));
    } catch (e: unknown) { toast.error((e as Error).message ?? 'Error al enviar'); }
    setSubmitting(false);
  };

  const handleReject = async () => {
    if (!po || !rejectComments.trim()) return;
    setRejecting(true);
    try {
      await rejectPurchaseOrder({ id: po.id, comments: rejectComments.trim() });
      toast.success('OC rechazada. Volverá a Borrador para revisión del creador.');
      onUpdate?.(po.id, { status: 'Borrador', rejectionReason: rejectComments.trim() });
      setRejectOpen(false);
      setRejectComments('');
      setAuditLoading(true);
      getPoAuditLog({ poId: po.id }).then(d => setAuditLog(d.entries)).finally(() => setAuditLoading(false));
    } catch (e: unknown) { toast.error((e as Error).message ?? 'Error al rechazar'); }
    setRejecting(false);
  };

  const handleCancel = async () => {
    if (!po || !cancelComments.trim()) return;
    setCancelling(true);
    try {
      await cancelPurchaseOrder({ id: po.id, comments: cancelComments.trim() });
      toast.success('OC cancelada correctamente.');
      onUpdate?.(po.id, { status: 'Cancelada' });
      setCancelOpen(false);
      setCancelComments('');
      setAuditLoading(true);
      getPoAuditLog({ poId: po.id }).then(d => setAuditLog(d.entries)).finally(() => setAuditLoading(false));
    } catch (e: unknown) { toast.error((e as Error).message ?? 'Error al cancelar'); }
    setCancelling(false);
  };

  const handleEmailSent = (sentTo: string) => {
    const sentAt = new Date().toISOString();
    setLocalEmailSentAt(sentAt);
    setLocalEmailSentTo(sentTo);
    onUpdate?.(po!.id, { emailSentAt: sentAt, emailSentTo: sentTo });
  };

  if (!po) return null;

  const isReadOnly = po.readOnly ?? false;
  const isCreator = po.createdBy === userEmail;
  const status = po.status ?? 'Borrador';

  const canEdit = !isReadOnly && (status === 'Borrador' || userLevel === 'Socios');
  const canDelete = (isCreator && status === 'Borrador') || (userLevel === 'Finanzas' && status === 'Borrador') || userLevel === 'Socios';
  const canSubmit = status === 'Borrador' && !isReadOnly && (isCreator || userLevel === 'Finanzas' || userLevel === 'Socios');
  const canApproveThis = canApprove && status === 'Enviada a aprobación';
  const canReject = canApprove && status === 'Enviada a aprobación';
  const isSameArea = po.category ? userCostCenters.includes(po.category) : false;
  const isHighLevel = userLevel === 'Finanzas' || userLevel === 'Socios';
  const canCancel = status !== 'Pagada' && status !== 'Cancelada' && (isCreator || isSameArea || isHighLevel);
  const pdfUrl = localPdfUrl;
  const emailSentAt = localEmailSentAt;
  const emailSentTo = localEmailSentTo;

  return (
    <>
      <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden">
          {/* Header */}
          <DialogHeader className="px-6 py-4 border-b flex-shrink-0">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground font-mono mb-0.5">OC #{po.poNumber}</p>
                <DialogTitle className="text-base leading-tight line-clamp-1">{po.supplierName ?? 'Sin proveedor'}</DialogTitle>
                {po.projectCode && <p className="text-xs text-muted-foreground mt-0.5">{po.projectCode}</p>}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 mt-0.5">
                {isReadOnly && (
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">Solo lectura</span>
                )}
                <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${STATUS_STYLES[po.enrichedStatus ?? po.status ?? ''] ?? 'bg-muted text-muted-foreground'}`}>
                  {po.enrichedStatus ?? po.status ?? 'Borrador'}
                </span>
              </div>
            </div>
            <div className="mt-4"><FlowStepper po={po} /></div>
          </DialogHeader>

          {/* Cancelled banner */}
          {status === 'Cancelada' && (
            <div className="px-6 py-3 bg-destructive/10 border-b border-destructive/20 flex items-center gap-2.5">
              <XCircle className="w-4 h-4 text-destructive shrink-0" />
              <p className="text-sm font-semibold text-destructive">Esta orden de compra ha sido cancelada y no puede procesarse.</p>
            </div>
          )}

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
            <div className="grid grid-cols-3 gap-x-6 gap-y-4">
              <InfoRow label="Proveedor" value={po.supplierName} />
              <InfoRow label="Proyecto" value={po.projectCode} />
              <InfoRow label="Rubro / C. Costo" value={po.category} />
              <InfoRow label="Fecha de emisión" value={fmtDate(po.issueDate)} />
              <InfoRow label="Monto total" value={fmtCurrency(po.totalAmount, po.currency)} />
              <InfoRow label="Moneda" value={po.currency} />
              <InfoRow label="Condiciones de pago" value={po.paymentTerms} />
              <InfoRow label="Creado por" value={po.createdBy?.split('@')[0]} />
              <InfoRow label="Aprobado por" value={po.approvedBy?.split('@')[0]} />
              {po.billingEntity && <InfoRow label="Facturar a" value={po.billingEntity} />}
            </div>

            {po.orderType === 'Anticipo' && (
              <div className="flex items-start gap-2.5 px-4 py-3 rounded-lg bg-orange-50 border border-orange-200 dark:bg-orange-950/40 dark:border-orange-800 text-orange-800 dark:text-orange-300">
                <span className="text-base leading-none mt-0.5">⚠️</span>
                <p className="text-sm font-medium leading-snug">Este anticipo deberá descontarse en la OC de cierre del proyecto.</p>
              </div>
            )}

            {/* Rejection notice */}
            {status === 'Borrador' && po.rejectionReason && (
              <div className="flex items-start gap-2.5 px-4 py-3 rounded-lg bg-destructive/5 border border-destructive/20 border-l-4 border-l-destructive">
                <XCircle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-destructive">OC devuelta para corrección</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{po.rejectionReason}</p>
                </div>
              </div>
            )}

            {po.serviceDescription && (
              <div className="space-y-1">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Servicio / Descripción</p>
                <p className="text-sm bg-muted/30 rounded-lg px-3 py-2 leading-relaxed">{po.serviceDescription}</p>
              </div>
            )}

            {po.notes && (
              <div className="space-y-1">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Notas internas</p>
                <p className="text-sm bg-muted/30 rounded-lg px-3 py-2 leading-relaxed">{po.notes}</p>
              </div>
            )}

            {emailSentAt && (
              <div className="flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300 text-xs font-medium border border-blue-200 dark:border-blue-800">
                  <Mail className="w-3.5 h-3.5" /> Email enviado · {emailSentTo} · {fmtDateTime(emailSentAt)}
                </span>
              </div>
            )}

            {/* PDF Preview — shown automatically when PDF is available */}
            {(generatingPdf || pdfPreviewLoading || pdfBase64Preview) && (
              <div className="space-y-2">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5" /> Vista previa del PDF
                </p>
                {generatingPdf || pdfPreviewLoading ? (
                  <div className="relative h-[450px] w-full rounded-lg border border-border overflow-hidden">
                    <Skeleton className="h-full w-full rounded-lg" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        {generatingPdf ? 'Generando PDF...' : 'Cargando preview...'}
                      </div>
                    </div>
                  </div>
                ) : pdfBase64Preview ? (
                  <iframe
                    src={`data:application/pdf;base64,${pdfBase64Preview}#toolbar=0&navpanes=0`}
                    className="h-[450px] w-full rounded-lg border border-border"
                    title={`OC-${po.poNumber}.pdf`}
                  />
                ) : null}
              </div>
            )}

            {/* Payments */}
            {(() => {
              const realized = payments.filter(p => p.status === 'Realizado').reduce((s, p) => s + (p.amount ?? 0), 0);
              const total = po.totalAmount ?? 0;
              const pct = total > 0 ? Math.min(100, (realized / total) * 100) : 0;
              return (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <CreditCard className="w-3.5 h-3.5 text-muted-foreground" />
                    <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Pagos</p>
                  </div>
                  {payments.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic">Sin pagos registrados</p>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-muted-foreground">Pagado: <span className="font-bold text-foreground">{fmtCurrency(realized, po.currency ?? undefined)}</span></span>
                        <span className="text-muted-foreground">Total: {fmtCurrency(total, po.currency ?? undefined)}</span>
                      </div>
                      <Progress value={pct} className="h-1.5 mb-3" />
                      <div className="border rounded-lg divide-y divide-border overflow-hidden">
                        {payments.map(p => (
                          <div key={p.id} className="flex items-center justify-between px-3 py-2 text-xs hover:bg-muted/20">
                            <div className="flex items-center gap-2">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${PAYMENT_STATUS_STYLES[p.status ?? ''] ?? 'bg-muted text-muted-foreground'}`}>{p.status}</span>
                              <span className="text-muted-foreground">{fmtDate(p.paymentDate)}</span>
                              {p.method && <span className="text-muted-foreground">· {p.method}</span>}
                            </div>
                            <span className="font-bold">{fmtCurrency(p.amount, p.currency ?? undefined)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Line items */}
            <div className="space-y-2">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Líneas de detalle</p>
              <LinesTable lines={lines} currency={po.currency ?? undefined} loading={linesLoading} />
            </div>

            {/* Evidencias y adjuntos */}
            <PoAttachmentsSection
              poId={po.id}
              status={status}
              userEmail={userEmail}
              canUpload={isCreator || isSameArea || isHighLevel}
              isHighLevel={isHighLevel}
              open={open}
            />

            {/* Audit Log */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <History className="w-3.5 h-3.5 text-muted-foreground" />
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Historial de cambios</p>
              </div>
              <AuditLog entries={auditLog} loading={auditLoading} />
            </div>
          </div>

          {/* Footer actions */}
          <div className="px-6 py-4 border-t flex-shrink-0 flex items-center gap-2 flex-wrap">
            {canEdit && (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { onClose(); onEdit(po); }}>
                <Edit2 className="w-3.5 h-3.5" /> Editar
              </Button>
            )}
            {canDelete && (
              <Button variant="outline" size="sm" className="gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => onDelete(po)}>
                <Trash2 className="w-3.5 h-3.5" /> Eliminar
              </Button>
            )}
            {canSubmit && (
              <Button variant="outline" size="sm" className="gap-1.5 text-sky-600 border-sky-200 hover:bg-sky-50 dark:text-sky-300 dark:border-sky-800 dark:hover:bg-sky-950" onClick={handleSubmit} disabled={submitting}>
                {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                {submitting ? 'Enviando...' : 'Enviar a aprobación'}
              </Button>
            )}
            {canApproveThis && (
              <Button variant="outline" size="sm" className="gap-1.5 text-emerald-600 border-emerald-200 hover:bg-emerald-50 dark:text-emerald-300 dark:border-emerald-800 dark:hover:bg-emerald-950" onClick={() => onApprove(po)}>
                <CheckCircle2 className="w-3.5 h-3.5" /> Aprobar
              </Button>
            )}
            {canReject && (
              <Button variant="outline" size="sm" className="gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => setRejectOpen(true)}>
                <XCircle className="w-3.5 h-3.5" /> Rechazar
              </Button>
            )}
            {canCancel && (
              <Button variant="outline" size="sm" className="gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => setCancelOpen(true)}>
                <XCircle className="w-3.5 h-3.5" /> Cancelar OC
              </Button>
            )}
            <div className="flex-1" />
            {/* PDF/email buttons: only show post-approval and not cancelled */}
            {status !== 'Cancelada' && ['Aprobada', 'Factura recibida', 'Factura validada', 'Pago programado', 'Pagada'].includes(po.enrichedStatus ?? status) && (
              <div className="flex items-center gap-2">
                {pdfBase64Preview && (
                  <a href={`data:application/pdf;base64,${pdfBase64Preview}`} download={`OC-${po.poNumber}.pdf`}>
                    <Button variant="outline" size="sm" className="gap-1.5 text-emerald-600 border-emerald-200 hover:bg-emerald-50">
                      <ExternalLink className="w-3.5 h-3.5" /> Descargar PDF
                    </Button>
                  </a>
                )}
                <Button variant="outline" size="sm" className="gap-1.5" onClick={handleGeneratePdf} disabled={generatingPdf}>
                  <FileText className="w-3.5 h-3.5" />{generatingPdf ? 'Generando...' : pdfUrl ? 'Regenerar PDF' : 'Generar PDF'}
                </Button>
                <Button size="sm" className="gap-1.5" onClick={() => setEmailOpen(true)}>
                  <Mail className="w-3.5 h-3.5" />{emailSentAt ? 'Reenviar' : 'Enviar email'}
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Reject dialog */}
      <Dialog open={rejectOpen} onOpenChange={v => { if (!v) { setRejectOpen(false); setRejectComments(''); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <XCircle className="w-4 h-4" /> Rechazar orden de compra
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-3">
            <p className="text-sm text-muted-foreground">
              La OC <strong>#{po.poNumber}</strong> volverá a <strong>Borrador</strong> para que el creador la corrija y reenvíe.
            </p>
            <div className="space-y-1.5">
              <Label className="text-xs">Motivo del rechazo <span className="text-destructive">*</span></Label>
              <Textarea rows={4} className="resize-none text-sm" placeholder="Explica el motivo del rechazo para que el creador pueda corregirlo..." value={rejectComments} onChange={e => setRejectComments(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setRejectOpen(false); setRejectComments(''); }} disabled={rejecting}>Cancelar</Button>
            <Button onClick={handleReject} disabled={rejecting || !rejectComments.trim()} className="gap-1.5 bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {rejecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
              {rejecting ? 'Rechazando...' : 'Rechazar OC'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {po && (
        <SendEmailDialog po={po} open={emailOpen} onClose={() => setEmailOpen(false)} onSent={handleEmailSent} />
      )}

      {/* Cancel dialog */}
      <Dialog open={cancelOpen} onOpenChange={v => { if (!v) { setCancelOpen(false); setCancelComments(''); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <XCircle className="w-4 h-4" /> Cancelar orden de compra
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-3">
            <p className="text-sm text-muted-foreground">
              La OC <strong>#{po?.poNumber}</strong> cambiará a estado <strong>Cancelada</strong>. Esta acción quedará registrada en el historial.
            </p>
            <div className="space-y-1.5">
              <Label className="text-xs">Motivo de cancelación <span className="text-destructive">*</span></Label>
              <Textarea rows={4} className="resize-none text-sm" placeholder="Explica el motivo de la cancelación..." value={cancelComments} onChange={e => setCancelComments(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setCancelOpen(false); setCancelComments(''); }} disabled={cancelling}>Cancelar</Button>
            <Button onClick={handleCancel} disabled={cancelling || !cancelComments.trim()} className="gap-1.5 bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {cancelling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
              {cancelling ? 'Cancelando...' : 'Confirmar cancelación'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
