import { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { fmtCurrency } from '../../lib/format';
import { sendPaymentReceipt, savePayment, GetPaymentsOutputType } from 'zite-endpoints-sdk';
import { uploadFile } from 'zite-file-upload-sdk';
import {
  CreditCard, Paperclip, FileText, Landmark, Receipt,
  Pencil, Trash2, Send, AlertCircle, Upload, Building2, X, CheckCircle, XCircle,
} from 'lucide-react';

type Payment = GetPaymentsOutputType['payments'][0];


function fmtDate(d?: string) {
  if (!d) return '—';
  return new Date(d.split('T')[0] + 'T12:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

function StatusBadge({ status }: { status?: string }) {
  const styles: Record<string, string> = {
    'Programado': 'bg-yellow-100 text-yellow-700 border-yellow-200',
    'Realizado': 'bg-green-100 text-green-700 border-green-200',
    'Cancelado': 'bg-red-100 text-red-700 border-red-200',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${styles[status ?? ''] ?? 'bg-muted text-muted-foreground border-border'}`}>
      {status || '—'}
    </span>
  );
}

interface Props {
  payment: Payment | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  onAttachmentUploaded?: (attachment: { url: string }[]) => void;
  onPaymentUpdated?: (updates: { status?: string; paymentDate?: string }) => void;
}

export function PaymentDetailDialog({ payment, open, onOpenChange, onEdit, onDelete, onAttachmentUploaded, onPaymentUpdated }: Props) {
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [localAttachment, setLocalAttachment] = useState<{ url: string }[] | null>(null);
  const [localStatus, setLocalStatus] = useState<string | null>(null);
  const [localPaymentDate, setLocalPaymentDate] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentAttachment = localAttachment ?? (payment?.attachment ?? []);
  const hasAttachment = currentAttachment.length > 0;
  const displayStatus = localStatus ?? payment?.status;
  const displayPaymentDate = localPaymentDate ?? payment?.paymentDate;

  if (!payment) return null;

  const isProgramado = displayStatus === 'Programado';
  const paidPct = payment.poTotalAmount ? Math.min(100, ((payment.amount ?? 0) / payment.poTotalAmount) * 100) : 0;
  const isOverdue = (() => {
    if (!payment.dueDate || !isProgramado) return false;
    const due = new Date(payment.dueDate.split('T')[0] + 'T12:00:00');
    due.setHours(0, 0, 0, 0);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return due < today;
  })();

  const handleUploadFile = async (file: File) => {
    setUploading(true);
    try {
      const { fileUrl } = await uploadFile({ data: file, filename: file.name });
      const newAttachment = [...currentAttachment, { url: fileUrl }];
      await savePayment({ id: payment.id, attachment: newAttachment });
      setLocalAttachment(newAttachment);
      onAttachmentUploaded?.(newAttachment);
      toast.success('Comprobante subido correctamente');
    } catch {
      toast.error('Error al subir el comprobante');
    }
    setUploading(false);
  };

  const handleRemoveAttachment = async (idx: number) => {
    const newAttachment = currentAttachment.filter((_, i) => i !== idx);
    try {
      await savePayment({ id: payment.id, attachment: newAttachment });
      setLocalAttachment(newAttachment);
      onAttachmentUploaded?.(newAttachment);
      toast.success('Comprobante eliminado');
    } catch {
      toast.error('Error al eliminar el comprobante');
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleUploadFile(file);
  };

  const handleRegisterPayment = async () => {
    if (!hasAttachment) {
      toast.error('Sube un comprobante antes de registrar el pago');
      return;
    }
    setRegistering(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      await savePayment({ id: payment.id, status: 'Realizado', paymentDate: today });
      setLocalStatus('Realizado');
      setLocalPaymentDate(today);
      onPaymentUpdated?.({ status: 'Realizado', paymentDate: today });
      toast.success('Pago registrado como realizado');
    } catch {
      toast.error('Error al registrar el pago');
    }
    setRegistering(false);
  };

  const handleCancelPayment = async () => {
    setCancelConfirmOpen(false);
    setCancelling(true);
    try {
      await savePayment({ id: payment.id, status: 'Cancelado' });
      setLocalStatus('Cancelado');
      onPaymentUpdated?.({ status: 'Cancelado' });
      toast.success('Pago cancelado');
    } catch {
      toast.error('Error al cancelar el pago');
    }
    setCancelling(false);
  };

  const handleSendReceipt = async () => {
    setSending(true);
    try {
      const result = await sendPaymentReceipt({ paymentId: payment.id });
      toast.success(result.message);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Error al enviar comprobante';
      toast.error(msg);
    }
    setSending(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => { if (!v) { setLocalAttachment(null); setLocalStatus(null); setLocalPaymentDate(null); } onOpenChange(v); }}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <CreditCard className="w-5 h-5 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <DialogTitle className="text-base font-bold">{String(payment.paymentId ?? '—')}</DialogTitle>
                  <StatusBadge status={displayStatus} />
                  {payment.currency && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-blue-100 text-blue-700 border-blue-200">{payment.currency}</span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mt-0.5">{payment.supplierName ?? '—'}</p>
              </div>
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            {/* Payment data */}
            <div>
              <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold mb-3 flex items-center gap-1.5">
                <Receipt className="w-3.5 h-3.5" /> Datos del pago
              </p>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Monto</p>
                  <p className="text-xl font-black text-primary">{fmtCurrency(payment.amount, payment.currency)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Método</p>
                  <p className="text-sm font-medium">{payment.method || 'Transferencia'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Fecha comprometida</p>
                  <div className="flex items-center gap-2">
                    <p className={`text-sm font-medium ${isOverdue ? 'text-destructive' : ''}`}>{fmtDate(payment.dueDate)}</p>
                    {isOverdue && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-destructive/10 text-destructive border border-destructive/20 leading-none flex items-center gap-1"><AlertCircle className="w-2.5 h-2.5" />Vencido</span>}
                  </div>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Fecha de pago real</p>
                  <p className="text-sm font-medium">{fmtDate(displayPaymentDate)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Referencia</p>
                  <p className="text-sm font-medium font-mono">{payment.reference ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5"># Factura proveedor</p>
                  <p className="text-sm font-medium">{payment.supplierInvoiceNumber ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">ODC vinculada</p>
                  <p className="text-sm font-medium font-mono">{payment.poNumber ? `ODC-${payment.poNumber}` : '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Proyecto</p>
                  <p className="text-sm font-medium">{payment.projectCode ?? '—'}</p>
                </div>
                {payment.supplierEmail && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Email proveedor</p>
                    <p className="text-sm font-medium">{payment.supplierEmail}</p>
                  </div>
                )}
              </div>
            </div>

            {/* PO */}
            {payment.poId && (
              <>
                <Separator />
                <div>
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold mb-3 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5" /> ODC vinculada
                  </p>
                  <div className="bg-muted/40 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold">ODC-{payment.poNumber}</span>
                      <span className="text-xs text-muted-foreground">{fmtCurrency(payment.poTotalAmount, payment.currency)}</span>
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Saldo pendiente</span>
                        <span className="font-semibold text-foreground">{fmtCurrency(payment.poPendingAmount, payment.currency)}</span>
                      </div>
                      <Progress value={100 - paidPct} className="h-1.5" />
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* Bank / Source info */}
            <Separator />
            <div>
              <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold mb-3 flex items-center gap-1.5">
                <Landmark className="w-3.5 h-3.5" /> Datos bancarios
              </p>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                {(payment.sourceCompany || payment.sourceBank || payment.sourceAccount) && (
                  <>
                    <div className="col-span-2">
                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                        <Building2 className="w-3 h-3" /> Origen del pago
                      </p>
                    </div>
                    {payment.sourceCompany && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-0.5">Empresa pagadora</p>
                        <p className="text-sm font-medium">{payment.sourceCompany}</p>
                      </div>
                    )}
                    {payment.sourceBank && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-0.5">Banco origen</p>
                        <p className="text-sm font-medium">{payment.sourceBank}</p>
                      </div>
                    )}
                    {payment.sourceAccount && (
                      <div className="col-span-2">
                        <p className="text-xs text-muted-foreground mb-0.5">Cuenta origen</p>
                        <p className="text-sm font-medium font-mono">{payment.sourceAccount}</p>
                      </div>
                    )}
                    <div className="col-span-2 border-t border-border/50 pt-3 mt-1" />
                  </>
                )}
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground mb-0.5">Cuenta destino</p>
                  <p className="text-sm font-medium font-mono">{payment.destinationAccount ?? '—'}</p>
                </div>
              </div>
            </div>

            {/* Attachment / Upload */}
            <Separator />
            <div>
              <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold mb-3 flex items-center gap-1.5">
                <Paperclip className="w-3.5 h-3.5" /> Comprobante de pago
              </p>

              {isProgramado && !hasAttachment && (
                <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg bg-yellow-50 border border-yellow-200 text-yellow-700">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <p className="text-xs font-medium">Sube un comprobante antes de registrar el pago</p>
                </div>
              )}

              {hasAttachment && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {currentAttachment.map((a, i) => (
                    <div key={i} className="group flex items-center gap-1 pl-3 pr-1.5 py-1.5 rounded-lg bg-primary/10 text-primary text-sm font-medium">
                      <a href={a.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 hover:underline">
                        <Paperclip className="w-3.5 h-3.5" />
                        Ver comprobante{currentAttachment.length > 1 ? ` ${i + 1}` : ''}
                      </a>
                      <button
                        onClick={() => handleRemoveAttachment(i)}
                        className="ml-1 p-0.5 rounded opacity-50 hover:opacity-100 hover:text-destructive transition-all"
                        title="Eliminar"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div
                className={`relative border-2 border-dashed rounded-xl p-5 text-center transition-colors cursor-pointer ${dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-muted/30'} ${uploading ? 'pointer-events-none opacity-60' : ''}`}
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,application/pdf"
                  className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleUploadFile(f); e.target.value = ''; }}
                />
                {uploading ? (
                  <div className="flex flex-col items-center gap-2">
                    <span className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
                    <p className="text-sm text-muted-foreground">Subiendo comprobante…</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
                      <Upload className="w-5 h-5 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-medium text-foreground">
                      {hasAttachment ? 'Agregar otro comprobante' : 'Subir comprobante'}
                    </p>
                    <p className="text-xs text-muted-foreground">Arrastra un archivo aquí o haz clic para buscar</p>
                    <p className="text-[10px] text-muted-foreground/60">PDF, JPG, PNG · Máx. 10 MB</p>
                  </div>
                )}
              </div>

              {hasAttachment && (
                <div className="pt-3">
                  {payment.supplierEmail ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={sending}
                      className="gap-2 border-primary/40 text-primary hover:bg-primary/5"
                      onClick={handleSendReceipt}
                    >
                      {sending ? (
                        <span className="animate-spin w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full" />
                      ) : (
                        <Send className="w-3.5 h-3.5" />
                      )}
                      {sending ? 'Enviando…' : `Enviar comprobante a ${payment.supplierEmail}`}
                    </Button>
                  ) : (
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5" />
                      No se puede enviar: el proveedor no tiene email registrado
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Notes */}
            {payment.notes && (
              <>
                <Separator />
                <div>
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold mb-2">Notas</p>
                  <div className="bg-muted/40 rounded-lg p-3 text-sm leading-relaxed">{payment.notes}</div>
                </div>
              </>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t shrink-0">
            {isProgramado ? (
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={onEdit}>
                  <Pencil className="w-3.5 h-3.5" /> Editar
                </Button>
                <div className="flex-1" />
                <Button
                  variant="outline"
                  className="gap-2 text-destructive border-destructive/30 hover:bg-destructive/10"
                  onClick={() => setCancelConfirmOpen(true)}
                  disabled={cancelling}
                >
                  <XCircle className="w-4 h-4" /> Cancelar pago
                </Button>
                <Button
                  className="gap-2"
                  onClick={handleRegisterPayment}
                  disabled={registering || uploading}
                  title={!hasAttachment ? 'Sube un comprobante primero' : undefined}
                >
                  {registering ? (
                    <span className="animate-spin w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full" />
                  ) : (
                    <CheckCircle className="w-4 h-4" />
                  )}
                  {registering ? 'Registrando…' : 'Registrar pago'}
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Button variant="outline" className="gap-2 text-destructive border-destructive/30 hover:bg-destructive/10 flex-1" onClick={onDelete}>
                  <Trash2 className="w-4 h-4" /> Eliminar
                </Button>
                <Button className="gap-2 flex-1" onClick={onEdit}>
                  <Pencil className="w-4 h-4" /> Editar pago
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Cancel confirmation dialog */}
      <AlertDialog open={cancelConfirmOpen} onOpenChange={setCancelConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cancelar este pago?</AlertDialogTitle>
            <AlertDialogDescription>
              El pago {String(payment.paymentId ?? '')} quedará marcado como cancelado. Esta acción no se puede revertir.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleCancelPayment}
            >
              Sí, cancelar pago
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
