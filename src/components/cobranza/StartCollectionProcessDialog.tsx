import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Landmark, Upload, Loader2, FileCheck } from 'lucide-react';
import { getClientCreditDays, startCollectionProcess } from 'zite-endpoints-sdk';
import { uploadFile } from 'zite-file-upload-sdk';
import { toast } from 'sonner';

function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

function fmtDate(iso: string) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

interface Props {
  projectCode: string;
  client?: string;
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export default function StartCollectionProcessDialog({ projectCode, client, open, onClose, onCreated }: Props) {
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [creditDays, setCreditDays] = useState('30');
  const [fileUrl, setFileUrl] = useState('');
  const [fileName, setFileName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Se precarga cada vez que se abre, con el cliente del proyecto — mismo
  // registro que startCollectionProcess.ts actualiza al guardar (por eso la
  // próxima vez que se arranque un proceso para el mismo cliente ya viene
  // resuelto solo).
  useEffect(() => {
    if (!open) return;
    setInvoiceNumber('');
    setInvoiceDate(new Date().toISOString().split('T')[0]);
    setCreditDays('30');
    setFileUrl('');
    setFileName('');
    if (client) {
      getClientCreditDays({ client }).then(d => {
        if (d.creditDays != null) setCreditDays(String(d.creditDays));
      }).catch(() => {});
    }
  }, [open, client]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      toast.error('El archivo no puede superar 25 MB');
      return;
    }
    setUploading(true);
    try {
      const { fileUrl: url } = await uploadFile({ data: file, filename: file.name, folder: 'collection-processes' });
      setFileUrl(url);
      setFileName(file.name);
    } catch (err: unknown) {
      toast.error((err as Error).message ?? 'Error al subir el archivo');
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const daysNum = Number(creditDays);
  const canSave = invoiceNumber.trim() !== '' && invoiceDate !== '' && Number.isFinite(daysNum) && daysNum >= 0;
  const scheduledPaymentDate = canSave ? addDays(invoiceDate, daysNum) : null;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await startCollectionProcess({
        projectCode,
        invoiceNumber: invoiceNumber.trim(),
        invoiceDate,
        creditDays: daysNum,
        fileUrl: fileUrl || undefined,
        fileName: fileName || undefined,
      });
      toast.success('Proceso de cobranza iniciado');
      onCreated();
      onClose();
    } catch (err: unknown) {
      toast.error((err as Error).message ?? 'Error al iniciar el proceso');
    }
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Landmark className="w-4 h-4 text-primary" />
            Iniciar proceso de cobranza
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <label className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Número de factura</label>
            <Input value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} placeholder="Ej. A-1032" className="h-9" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Fecha de subida de factura</label>
              <Input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Días de crédito</label>
              <Input type="number" min={0} value={creditDays} onChange={e => setCreditDays(e.target.value)} className="h-9" />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Subir factura</label>
            {fileName ? (
              <div className="flex items-center gap-2 h-9 px-3 rounded-md border border-border bg-muted/20 text-sm">
                <FileCheck className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                <span className="truncate">{fileName}</span>
              </div>
            ) : (
              <Button type="button" variant="outline" className="h-9 w-full gap-1.5 text-sm" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
                {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                {uploading ? 'Subiendo...' : 'Elegir archivo'}
              </Button>
            )}
            <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChange} />
          </div>

          <div className="rounded-lg bg-primary/5 border border-primary/20 px-3.5 py-3 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Fecha tentativa de pago</span>
            <span className="text-sm font-semibold text-primary">{scheduledPaymentDate ? fmtDate(scheduledPaymentDate) : '—'}</span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSave} disabled={!canSave || saving || uploading} className="gap-1.5">
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {saving ? 'Iniciando...' : 'Iniciar proceso'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
