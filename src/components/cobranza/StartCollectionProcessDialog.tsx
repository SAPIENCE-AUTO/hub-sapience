import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Landmark, Upload, Loader2, FileCheck, ExternalLink } from 'lucide-react';
import { getClientCollectionTerms, startCollectionProcess } from 'zite-endpoints-sdk';
import { uploadFile } from 'zite-file-upload-sdk';
import { toast } from 'sonner';
import { fasesQueAplican } from '@/lib/clientes/fases';
import Pastilla from '@/components/clientes/Pastilla';
import type { Entidad } from '@/components/clientes/tipos';

function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

function fmtDate(iso: string) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

interface Terminos { found: boolean; clientId?: string; clientName?: string; entities: Entidad[] }

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
  const [terminos, setTerminos] = useState<Terminos | null>(null);
  const [errorTerminos, setErrorTerminos] = useState(false);
  const [entidadId, setEntidadId] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const entidades = terminos?.entities ?? [];
  const entidad = entidades.find(e => e.id === entidadId);

  // Al elegir una razón social, sus días de crédito pasan al campo (siguen siendo editables para este proceso).
  const elegir = (e: Entidad) => {
    setEntidadId(e.id);
    if (e.creditDays != null) setCreditDays(String(e.creditDays));
  };

  // Se precarga cada vez que se abre: el cliente sale del proyecto y de él las razones sociales del catálogo de Clientes,
  // de donde vienen los días de crédito, los pasos que aplican y las instrucciones de cobro.
  useEffect(() => {
    if (!open) return;
    setInvoiceNumber('');
    setInvoiceDate(new Date().toISOString().split('T')[0]);
    setCreditDays('30');
    setFileUrl('');
    setFileName('');
    setTerminos(null);
    setErrorTerminos(false);
    setEntidadId('');
    let vigente = true;
    getClientCollectionTerms({ projectCode, client }).then((t: Terminos) => {
      if (!vigente) return;
      setTerminos(t);
      if (t.entities.length === 1) elegir(t.entities[0]);
    }).catch(() => { if (vigente) { setTerminos({ found: false, entities: [] }); setErrorTerminos(true); } });
    return () => { vigente = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectCode, client]);

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
  const faltaRazonSocial = entidades.length > 0 && !entidadId;
  const canSave = invoiceNumber.trim() !== '' && invoiceDate !== '' && Number.isFinite(daysNum) && daysNum >= 0 && !faltaRazonSocial;
  const scheduledPaymentDate = canSave ? addDays(invoiceDate, daysNum) : null;
  const pasos = entidad ? fasesQueAplican(entidad).filter(f => f !== 'Por iniciar') : [];
  const enlaceCatalogo = `/comercial/clientes${terminos?.clientId ? `?cliente=${terminos.clientId}` : ''}`;

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
        clientEntityId: entidadId || undefined,
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
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Landmark className="w-4 h-4 text-primary" />
            Iniciar proceso de cobranza
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {entidades.length > 0 ? (
            <div className="space-y-1.5">
              <label className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Razón social a la que se factura</label>
              <Select value={entidadId} onValueChange={id => { const e = entidades.find(x => x.id === id); if (e) elegir(e); }}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Elige la razón social" /></SelectTrigger>
                <SelectContent>
                  {entidades.map(e => <SelectItem key={e.id} value={e.id}>{e.legalName || 'Sin nombre'}{e.rfc ? ` · ${e.rfc}` : ''}</SelectItem>)}
                </SelectContent>
              </Select>
              {entidad && (
                <div className="rounded-lg bg-muted/40 px-3 py-2.5 space-y-1.5 text-xs">
                  {pasos.length > 0 && <p className="text-muted-foreground"><span className="font-medium text-foreground">Pasos:</span> {pasos.join(' → ')}</p>}
                  {entidad.requiresPo && <p className="text-muted-foreground">Pide orden de compra suya.</p>}
                  {entidad.requiresPortal && entidad.portalUrl && (
                    <a href={entidad.portalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline"><ExternalLink className="w-3 h-3" />Portal del cliente</a>
                  )}
                  {entidad.processNotes && <p className="whitespace-pre-wrap">{entidad.processNotes}</p>}
                </div>
              )}
            </div>
          ) : terminos && (
            <div className="rounded-lg border border-border bg-muted/30 px-3.5 py-3 space-y-1.5">
              <Pastilla tono="alerta">{errorTerminos ? 'Catálogo no disponible' : terminos.found ? 'Sin razón social' : 'Cliente fuera del catálogo'}</Pastilla>
              <p className="text-xs text-muted-foreground">
                {errorTerminos
                  ? 'No se pudo consultar el catálogo de clientes; captura los días de crédito a mano.'
                  : 'Con la razón social registrada, los días de crédito y los pasos vienen solos al iniciar un proceso.'}
                {!errorTerminos && <> <a href={enlaceCatalogo} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">Registrarla en Clientes<ExternalLink className="w-3 h-3" /></a></>}
              </p>
            </div>
          )}

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
              {entidad && entidad.creditDays == null && <p className="text-[11px] text-muted-foreground">La razón social no tiene días de crédito registrados.</p>}
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
