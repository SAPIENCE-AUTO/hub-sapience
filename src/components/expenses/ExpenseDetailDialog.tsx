import { useState, useEffect, useCallback } from 'react';
import {
  getExpenseAuditLog, getExpenseComments, addExpenseComment,
  approveExpense, rejectExpense, submitExpense, deleteExpense,
  getExpenseLineItems,
  GetExpensesOutputType, GetExpenseAuditLogOutputType, GetExpenseCommentsOutputType,
  GetExpenseLineItemsOutputType,
} from 'zite-endpoints-sdk';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { CheckCircle2, XCircle, Send, Edit2, Trash2, Paperclip, History, MessageSquare, ListOrdered } from 'lucide-react';
import { toast } from 'sonner';

type Expense = GetExpensesOutputType['expenses'][0];
type AuditEntry = GetExpenseAuditLogOutputType['entries'][0];
type ExpComment = GetExpenseCommentsOutputType['comments'][0];
type LineItem = GetExpenseLineItemsOutputType['lineItems'][0];

const STATUS_STYLES: Record<string, string> = {
  'Borrador': 'bg-muted text-muted-foreground',
  'Enviado a aprobación': 'border border-amber-300 bg-amber-50 text-amber-800',
  'Aprobado': 'border border-emerald-300 bg-emerald-50 text-emerald-800',
  'Rechazado': 'border border-rose-300 bg-rose-50 text-rose-800',
};

const ACTION_STYLES: Record<string, string> = {
  'Creado': 'bg-emerald-100 text-emerald-700',
  'Editado': 'bg-sky-100 text-sky-700',
  'Enviado a aprobación': 'bg-blue-100 text-blue-700',
  'Aprobado': 'bg-emerald-100 text-emerald-700',
  'Rechazado': 'bg-rose-100 text-rose-700',
  'Eliminado': 'bg-muted text-muted-foreground',
};

function fmt(amount: number | null | undefined, currency = 'MXN') {
  if (amount == null) return '—';
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount);
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  const [y, m, day] = d.split('T')[0].split('-');
  return new Date(Number(y), Number(m) - 1, Number(day)).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDateTime(d: string | null | undefined) {
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

// ── Flow Stepper ──────────────────────────────────────────────────────────────
const STEPS = [{ label: 'Creado' }, { label: 'Env. aprob.' }, { label: 'Aprobado' }];

function FlowStepper({ status }: { status: string | null | undefined }) {
  if (!status || status === 'Borrador') return null;
  const isRejected = status === 'Rechazado';
  const stepIdx = (status === 'Aprobado' || isRejected) ? 2 : status === 'Enviado a aprobación' ? 1 : 0;

  return (
    <div className="flex items-start w-full">
      {STEPS.map((step, i) => {
        const isDone = i < stepIdx || (i === stepIdx && status === 'Aprobado');
        const isActive = i === stepIdx && !isDone;
        const isRejectedStep = isActive && isRejected;
        const isLast = i === STEPS.length - 1;
        return (
          <div key={step.label} className="flex items-start flex-1 min-w-0">
            <div className="flex flex-col items-center flex-shrink-0">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center border-2 text-[11px] font-bold ${
                isRejectedStep ? 'bg-destructive border-destructive text-destructive-foreground' :
                isDone ? 'bg-primary border-primary text-primary-foreground' :
                isActive ? 'bg-background border-primary text-primary' :
                'bg-background border-muted-foreground/25 text-muted-foreground/50'
              }`}>
                {isDone ? '✓' : isRejectedStep ? '✕' : i + 1}
              </div>
              <span className={`text-[10px] mt-1 font-medium text-center leading-tight px-0.5 ${
                isRejectedStep ? 'text-destructive font-semibold' :
                isDone ? 'text-primary' :
                isActive ? 'text-foreground font-semibold' : 'text-muted-foreground/60'
              }`}>
                {isRejectedStep ? 'Rechazado' : step.label}
              </span>
            </div>
            {!isLast && (
              <div className={`flex-1 h-0.5 mt-3.5 mx-1 rounded-full ${i < stepIdx ? 'bg-primary' : 'bg-muted-foreground/15'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  expense: Expense | null;
  open: boolean;
  onClose: () => void;
  canApprove: boolean;
  userEmail: string;
  isFinanceRole: boolean;
  onEdit: (expense: Expense) => void;
  onUpdate: (id: string, changes: Partial<Expense>) => void;
  onRefreshList: () => void;
}

export default function ExpenseDetailDialog({ expense, open, onClose, canApprove, userEmail, isFinanceRole, onEdit, onUpdate, onRefreshList }: Props) {
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [comments, setComments] = useState<ExpComment[]>([]);
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [sendingComment, setSendingComment] = useState(false);
  const [approving, setApproving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadData = useCallback(async (expenseId: string) => {
    setAuditLoading(true);
    setCommentsLoading(true);
    const [auditRes, commentsRes, linesRes] = await Promise.allSettled([
      getExpenseAuditLog({ expenseId }),
      getExpenseComments({ expenseId }),
      getExpenseLineItems({ expenseId }),
    ]);
    if (auditRes.status === 'fulfilled') setAuditLog(auditRes.value.entries);
    if (commentsRes.status === 'fulfilled') setComments(commentsRes.value.comments);
    if (linesRes.status === 'fulfilled') setLineItems(linesRes.value.lineItems);
    setAuditLoading(false);
    setCommentsLoading(false);
  }, []);

  useEffect(() => {
    if (!open || !expense) return;
    setAuditLog([]); setComments([]); setLineItems([]); setNewComment('');
    loadData(expense.id);
  }, [open, expense?.id, loadData]);

  if (!expense) return null;

  const status = expense.status ?? 'Borrador';
  const isCreator = expense.createdBy === userEmail;
  const canEdit = (status === 'Borrador' || status === 'Rechazado') && (isCreator || isFinanceRole);
  const canSubmit = (status === 'Borrador' || status === 'Rechazado') && isCreator;
  const canApproveThis = canApprove && status === 'Enviado a aprobación';
  const canReject = canApprove && status === 'Enviado a aprobación';
  const canDelete = (status === 'Borrador' || status === 'Rechazado') && (isCreator || isFinanceRole);
  const receipts = expense.receipt ?? [];

  const handleApprove = async () => {
    setApproving(true);
    try {
      await approveExpense({ id: expense.id });
      toast.success('Gasto aprobado');
      onUpdate(expense.id, { status: 'Aprobado', approvedBy: userEmail });
      onRefreshList();
      await loadData(expense.id);
    } catch (e: unknown) { toast.error((e as { message?: string })?.message ?? 'Error al aprobar'); }
    setApproving(false);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await submitExpense({ id: expense.id });
      toast.success('Enviado a aprobación');
      onUpdate(expense.id, { status: 'Enviado a aprobación' });
      onRefreshList();
      await loadData(expense.id);
    } catch (e: unknown) { toast.error((e as { message?: string })?.message ?? 'Error al enviar'); }
    setSubmitting(false);
  };

  const handleReject = async () => {
    if (!rejectionReason.trim()) return;
    setRejecting(true);
    try {
      await rejectExpense({ id: expense.id, rejectionReason: rejectionReason.trim() });
      toast.success('Gasto rechazado');
      onUpdate(expense.id, { status: 'Rechazado', rejectionReason: rejectionReason.trim() });
      onRefreshList();
      setRejectOpen(false); setRejectionReason('');
      await loadData(expense.id);
    } catch (e: unknown) { toast.error((e as { message?: string })?.message ?? 'Error al rechazar'); }
    setRejecting(false);
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteExpense({ id: expense.id });
      toast.success('Gasto eliminado');
      onRefreshList(); onClose();
    } catch (e: unknown) { toast.error((e as { message?: string })?.message ?? 'Error al eliminar'); }
    setDeleting(false);
  };

  const handleAddComment = async () => {
    if (!newComment.trim()) return;
    setSendingComment(true);
    try {
      await addExpenseComment({ expenseId: expense.id, comment: newComment.trim() });
      setNewComment('');
      await loadData(expense.id);
    } catch (e: unknown) { toast.error((e as { message?: string })?.message ?? 'Error al enviar'); }
    setSendingComment(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden">
          {/* Header */}
          <DialogHeader className="px-6 py-4 border-b flex-shrink-0">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground font-mono mb-0.5">Gasto #{expense.expenseNumber ?? '—'}</p>
                <DialogTitle className="text-base leading-tight line-clamp-2">{expense.description ?? 'Sin descripción'}</DialogTitle>
                {expense.projectCode && <p className="text-xs text-muted-foreground mt-0.5">{expense.projectCode}</p>}
              </div>
              <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold flex-shrink-0 mt-0.5 ${STATUS_STYLES[status] ?? 'bg-muted text-muted-foreground'}`}>
                {status}
              </span>
            </div>
            <div className="mt-4"><FlowStepper status={status} /></div>
          </DialogHeader>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
            {/* Rejection banner */}
            {status === 'Rechazado' && expense.rejectionReason && (
              <div className="flex items-start gap-2.5 px-4 py-3 rounded-lg bg-destructive/5 border border-destructive/20 border-l-4 border-l-destructive">
                <XCircle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-destructive">Gasto rechazado — requiere corrección</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{expense.rejectionReason}</p>
                </div>
              </div>
            )}

            {/* Info grid */}
            <div className="grid grid-cols-3 gap-x-6 gap-y-4">
              <InfoRow label="Total" value={fmt(expense.amount, expense.currency ?? 'MXN')} />
              <InfoRow label="Moneda" value={expense.currency} />
              <InfoRow label="Método de pago" value={expense.paymentMethod} />
              <InfoRow label="Centro de costos" value={expense.costCenter} />
              <InfoRow label="Proyecto" value={expense.projectCode} />
              <InfoRow label="Creado por" value={expense.createdBy?.split('@')[0]} />
              <InfoRow label="Aprobado por" value={expense.approvedBy?.split('@')[0]} />
              {lineItems.length === 0 && expense.category && (
                <InfoRow label="Categoría" value={expense.category} />
              )}
              {lineItems.length === 0 && expense.expenseDate && (
                <InfoRow label="Fecha del gasto" value={fmtDate(expense.expenseDate)} />
              )}
            </div>

            {/* Notes */}
            {expense.notes && (
              <div className="space-y-1">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Notas</p>
                <p className="text-sm bg-muted/30 rounded-lg px-3 py-2 leading-relaxed">{expense.notes}</p>
              </div>
            )}

            {/* Line items detail (new) */}
            {lineItems.length > 0 ? (
              <div className="space-y-2">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium flex items-center gap-1.5">
                  <ListOrdered className="w-3.5 h-3.5" /> Partidas del gasto ({lineItems.length})
                </p>
                <div className="border border-border rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50 border-b border-border">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Descripción</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground hidden sm:table-cell">Categoría</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground hidden sm:table-cell">Fecha</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">Monto</th>
                        <th className="text-center px-3 py-2 font-medium text-muted-foreground w-16">Comp.</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {lineItems.map((li, i) => {
                        const r = li.receipt?.[0];
                        const isImg = r ? /\.(png|jpg|jpeg|gif|webp)$/i.test(r.url) : false;
                        return (
                          <tr key={li.id ?? i} className="hover:bg-muted/20">
                            <td className="px-3 py-2 font-medium">{li.description || '—'}</td>
                            <td className="px-3 py-2 text-muted-foreground hidden sm:table-cell">{li.category || '—'}</td>
                            <td className="px-3 py-2 text-muted-foreground hidden sm:table-cell">{fmtDate(li.date)}</td>
                            <td className="px-3 py-2 text-right font-semibold">{fmt(li.amount, expense.currency ?? 'MXN')}</td>
                            <td className="px-3 py-2 text-center">
                              {r ? (
                                <a href={r.url} target="_blank" rel="noopener noreferrer" title="Ver comprobante">
                                  {isImg
                                    ? <img src={r.url} alt="comp" className="w-7 h-7 rounded object-cover border border-border mx-auto hover:opacity-80" />
                                    : <Paperclip className="w-4 h-4 text-primary mx-auto" />
                                  }
                                </a>
                              ) : <span className="text-muted-foreground/40">—</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-muted/30 border-t border-border">
                      <tr>
                        <td colSpan={3} className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground hidden sm:table-cell">Total</td>
                        <td colSpan={1} className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground sm:hidden">Total</td>
                        <td className="px-3 py-2 text-right font-bold text-sm">{fmt(expense.amount, expense.currency ?? 'MXN')}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            ) : (
              /* Legacy: show single receipt if no line items */
              <div className="space-y-2">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium flex items-center gap-1.5">
                  <Paperclip className="w-3.5 h-3.5" /> Evidencias / Comprobantes
                </p>
                {receipts.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">Sin comprobantes adjuntos</p>
                ) : (
                  <div className="flex flex-wrap gap-3">
                    {receipts.map((r, i) => {
                      const isImg = /\.(png|jpg|jpeg|gif|webp)$/i.test(r.url);
                      return isImg ? (
                        <a key={i} href={r.url} target="_blank" rel="noopener noreferrer" className="group block">
                          <img src={r.url} alt="evidencia" className="w-24 h-24 rounded-xl object-cover border border-border group-hover:opacity-80 transition-opacity shadow-sm" />
                        </a>
                      ) : (
                        <a key={i} href={r.url} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-2 px-3 py-2.5 border border-border rounded-xl bg-muted text-sm hover:bg-muted/80 transition-colors">
                          <Paperclip className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
                          <span className="truncate max-w-[150px]">{r.url.split('/').pop()}</span>
                        </a>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Comments */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-3.5 h-3.5 text-muted-foreground" />
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Comentarios</p>
              </div>
              {commentsLoading ? (
                <div className="space-y-2">{[1, 2].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
              ) : (
                <div className="space-y-3">
                  {comments.length === 0 && (
                    <p className="text-sm text-muted-foreground italic">Sin comentarios aún. Agrega uno abajo.</p>
                  )}
                  {comments.map((c, i) => (
                    <div key={c.id ?? i} className="flex gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 text-xs font-bold text-primary">
                        {(c.authorName || c.authorEmail || '?')[0].toUpperCase()}
                      </div>
                      <div className="flex-1 bg-muted/30 rounded-xl px-3 py-2">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-xs font-semibold">{c.authorName || c.authorEmail?.split('@')[0] || '—'}</span>
                          <span className="text-[11px] text-muted-foreground">{fmtDateTime(c.createdAt)}</span>
                        </div>
                        <p className="text-sm leading-relaxed">{c.comment}</p>
                      </div>
                    </div>
                  ))}
                  <div className="flex gap-2 pt-1">
                    <Textarea
                      value={newComment}
                      onChange={e => setNewComment(e.target.value)}
                      placeholder="Escribe un comentario... (Ctrl+Enter para enviar)"
                      className="text-sm min-h-[60px] resize-none flex-1"
                      onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) handleAddComment(); }}
                    />
                    <Button size="sm" className="self-end flex-shrink-0 gap-1.5" onClick={handleAddComment}
                      disabled={sendingComment || !newComment.trim()}>
                      <Send className="w-3.5 h-3.5" />
                      {sendingComment ? '...' : 'Enviar'}
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Audit Log */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <History className="w-3.5 h-3.5 text-muted-foreground" />
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Historial de cambios</p>
              </div>
              {auditLoading ? (
                <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : auditLog.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">Sin historial disponible</p>
              ) : (
                <div className="relative pl-1">
                  <div className="absolute left-3 top-2 bottom-2 w-px bg-border" />
                  <div className="space-y-4">
                    {auditLog.map((entry, i) => (
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
              )}
            </div>
          </div>

          {/* Footer actions */}
          <div className="px-6 py-4 border-t flex-shrink-0 flex items-center gap-2 flex-wrap">
            {canEdit && (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { onClose(); onEdit(expense); }}>
                <Edit2 className="w-3.5 h-3.5" /> Editar
              </Button>
            )}
            {canDelete && (
              <Button variant="outline" size="sm" className="gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="w-3.5 h-3.5" /> Eliminar
              </Button>
            )}
            {canSubmit && (
              <Button variant="outline" size="sm" className="gap-1.5 text-sky-600 border-sky-200 hover:bg-sky-50" onClick={handleSubmit} disabled={submitting}>
                <Send className="w-3.5 h-3.5" />
                {submitting ? 'Enviando...' : 'Enviar a aprobación'}
              </Button>
            )}
            {canApproveThis && (
              <Button variant="outline" size="sm" className="gap-1.5 text-emerald-600 border-emerald-200 hover:bg-emerald-50" onClick={handleApprove} disabled={approving}>
                <CheckCircle2 className="w-3.5 h-3.5" />
                {approving ? 'Aprobando...' : 'Aprobar'}
              </Button>
            )}
            {canReject && (
              <Button variant="outline" size="sm" className="gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => setRejectOpen(true)}>
                <XCircle className="w-3.5 h-3.5" /> Rechazar
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Reject sub-dialog */}
      <Dialog open={rejectOpen} onOpenChange={v => { if (!v) { setRejectOpen(false); setRejectionReason(''); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <XCircle className="w-4 h-4" /> Rechazar gasto
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-3">
            <p className="text-sm text-muted-foreground">
              El gasto quedará como <strong>Rechazado</strong>. El creador podrá editarlo y reenviarlo a aprobación.
            </p>
            <div className="space-y-1.5">
              <Label className="text-xs">Motivo del rechazo *</Label>
              <Textarea rows={3} className="resize-none text-sm" placeholder="Explica el motivo para que el creador pueda corregirlo..."
                value={rejectionReason} onChange={e => setRejectionReason(e.target.value)} autoFocus />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={() => { setRejectOpen(false); setRejectionReason(''); }} disabled={rejecting}>Cancelar</Button>
            <Button variant="destructive" size="sm" onClick={handleReject} disabled={rejecting || !rejectionReason.trim()}>
              {rejecting ? 'Rechazando...' : 'Rechazar gasto'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={deleteOpen} onOpenChange={v => { if (!v) setDeleteOpen(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este gasto?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará permanentemente <strong>"{expense.description}"</strong>. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-destructive hover:bg-destructive/90">
              {deleting ? 'Eliminando...' : 'Eliminar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
