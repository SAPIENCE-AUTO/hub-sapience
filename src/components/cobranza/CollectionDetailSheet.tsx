import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { History, Loader2, Save } from 'lucide-react';
import { getCollectionProcessDetail, saveCollectionProcess, getTeamMembers, GetTeamMembersOutputType } from 'zite-endpoints-sdk';
import CollectionAttachmentsSection, { CollectionAttachment } from './CollectionAttachmentsSection';
import { toast } from 'sonner';
import { fmtCurrency } from '../../lib/format';

type TeamMember = GetTeamMembersOutputType['members'][0];

const PHASES = [
  'Por iniciar', 'Proforma creada', 'Proforma enviada', 'Factura creada', 'Factura enviada',
  'Subida al portal', 'GR / Migo', 'Cobranza programada', 'Pagada', 'Atrasada',
];
const STATUSES = ['Al día', 'Atrasado', 'Pagado'];

// Solo las 9 fases "de flujo" entran al stepper — 'Atrasada' se trata como
// badge aparte, mismo tratamiento que PODetailSheet.tsx le da a 'Cancelada'.
const FLOW_PHASES = PHASES.filter(p => p !== 'Atrasada');

const STATUS_STYLES: Record<string, string> = {
  'Al día': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  'Atrasado': 'bg-destructive/10 text-destructive',
  'Pagado': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
};

const ACTION_STYLES: Record<string, string> = {
  'Creado': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  'Fase actualizada': 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
  'Estatus actualizado': 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
  'Fecha programada': 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
  'Marcado como pagado': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  'Editado': 'bg-muted text-muted-foreground',
  'Adjunto agregado': 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  'Adjunto eliminado': 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
};

function FlowStepper({ phase }: { phase?: string }) {
  if (!phase || phase === 'Atrasada') return null;
  const idx = FLOW_PHASES.indexOf(phase);
  if (idx === -1) return null;
  return (
    <div className="flex items-start w-full overflow-x-auto pb-1">
      {FLOW_PHASES.map((step, i) => {
        const state = i < idx ? 'done' : i === idx ? 'active' : 'pending';
        const isLast = i === FLOW_PHASES.length - 1;
        return (
          <div key={step} className="flex items-start flex-1 min-w-[64px]">
            <div className="flex flex-col items-center flex-shrink-0">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center border-2 text-[10px] font-bold transition-colors ${
                state === 'done' ? 'bg-primary border-primary text-primary-foreground' :
                state === 'active' ? 'bg-background border-primary text-primary' :
                'bg-background border-muted-foreground/25 text-muted-foreground/50'
              }`}>{state === 'done' ? '✓' : i + 1}</div>
              <span className={`text-[9px] mt-1 font-medium text-center leading-tight px-0.5 ${
                state === 'done' ? 'text-primary' : state === 'active' ? 'text-foreground font-semibold' : 'text-muted-foreground/60'
              }`}>{step}</span>
            </div>
            {!isLast && (
              <div className={`flex-1 h-0.5 mt-3 mx-1 rounded-full transition-colors ${
                i < idx ? 'bg-primary' : 'bg-muted-foreground/15'
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

type AuditEntry = { id: string; timestamp?: string; action: string; userEmail?: string; userName?: string; comments?: string };

function AuditLog({ entries, loading }: { entries: AuditEntry[]; loading: boolean }) {
  if (loading) return <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>;
  if (entries.length === 0) return <p className="text-sm text-muted-foreground italic">Sin historial disponible</p>;
  return (
    <div className="relative pl-1">
      <div className="absolute left-3 top-2 bottom-2 w-px bg-border" />
      <div className="space-y-4">
        {entries.map((entry, i) => (
          <div key={entry.id ?? i} className="flex gap-3">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 z-10 text-[10px] font-bold mt-0.5 ${ACTION_STYLES[entry.action] ?? 'bg-muted text-muted-foreground'}`}>
              {entry.action[0]}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${ACTION_STYLES[entry.action] ?? 'bg-muted text-muted-foreground'}`}>
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

type Detail = Awaited<ReturnType<typeof getCollectionProcessDetail>>;

interface Props {
  id: string | null;
  open: boolean;
  onClose: () => void;
  canEdit: boolean;
  userEmail: string;
  onUpdated?: () => void;
}

export default function CollectionDetailSheet({ id, open, onClose, canEdit, userEmail, onUpdated }: Props) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(false);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [saving, setSaving] = useState(false);

  // Campos editables locales
  const [phase, setPhase] = useState('');
  const [status, setStatus] = useState('');
  const [scheduledPaymentDate, setScheduledPaymentDate] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [responsibleUserId, setResponsibleUserId] = useState('');

  useEffect(() => {
    if (!open || !id) return;
    setLoading(true);
    Promise.all([getCollectionProcessDetail({ id }), getTeamMembers({})])
      .then(([d, teamRes]) => {
        setDetail(d);
        setMembers(teamRes.members);
        setPhase(d.phase ?? 'Por iniciar');
        setStatus(d.status ?? 'Al día');
        setScheduledPaymentDate(d.scheduledPaymentDate ? d.scheduledPaymentDate.split('T')[0] : '');
        setInvoiceNumber(d.invoiceNumber ?? '');
        setNotes(d.notes ?? '');
        setResponsibleUserId(d.responsibleUserId ?? '');
      })
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [open, id]);

  const refreshDetail = async () => {
    if (!id) return;
    const d = await getCollectionProcessDetail({ id });
    setDetail(d);
  };

  const handleSave = async () => {
    if (!id || !detail) return;
    setSaving(true);
    try {
      await saveCollectionProcess({
        id,
        phase,
        status,
        scheduledPaymentDate: scheduledPaymentDate || undefined,
        invoiceNumber: invoiceNumber || undefined,
        notes: notes || undefined,
        responsibleUser: responsibleUserId || undefined,
      });
      toast.success('Proceso de cobranza actualizado');
      await refreshDetail();
      onUpdated?.();
    } catch (err: unknown) {
      toast.error((err as Error).message ?? 'Error al guardar');
    }
    setSaving(false);
  };

  if (!id) return null;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-6 py-4 border-b flex-shrink-0">
          {loading || !detail ? (
            <Skeleton className="h-6 w-64" />
          ) : (
            <>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground font-mono mb-0.5">{detail.projectCode ?? 'Sin proyecto'}</p>
                  <DialogTitle className="text-base leading-tight line-clamp-1">{detail.client ?? detail.dealName ?? 'Sin cliente'}</DialogTitle>
                </div>
                <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold flex-shrink-0 ${STATUS_STYLES[detail.status ?? ''] ?? 'bg-muted text-muted-foreground'}`}>
                  {detail.status ?? 'Al día'}
                </span>
              </div>
              <div className="mt-4"><FlowStepper phase={detail.phase} /></div>
            </>
          )}
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {loading || !detail ? (
            <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-x-6 gap-y-4">
                <InfoRow label="Deal" value={detail.dealName} />
                <InfoRow label="Monto cotizado" value={fmtCurrency(detail.quotedAmount, detail.currency)} />
                <InfoRow label="Monto a cobrar" value={fmtCurrency(detail.collectionAmount, detail.currency)} />
                <InfoRow label="Proforma creada" value={fmtDate(detail.proformaCreatedAt)} />
                <InfoRow label="Proforma enviada" value={fmtDate(detail.proformaSentAt)} />
                <InfoRow label="Factura creada" value={fmtDate(detail.invoiceCreatedAt)} />
                <InfoRow label="Factura enviada" value={fmtDate(detail.invoiceSentAt)} />
                <InfoRow label="Subida al portal" value={fmtDate(detail.portalUploadedAt)} />
                <InfoRow label="GR / Migo" value={fmtDate(detail.grMigoAt)} />
                <InfoRow label="Pagado el" value={fmtDate(detail.paidAt)} />
              </div>

              {/* Campos editables */}
              <div className="grid grid-cols-2 gap-4 bg-muted/20 rounded-lg p-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Fase</label>
                  <Select value={phase} onValueChange={setPhase} disabled={!canEdit}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>{PHASES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Estatus</label>
                  <Select value={status} onValueChange={setStatus} disabled={!canEdit}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Fecha programada de pago</label>
                  <Input type="date" className="h-8 text-sm" value={scheduledPaymentDate} onChange={e => setScheduledPaymentDate(e.target.value)} disabled={!canEdit} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Folio de factura</label>
                  <Input className="h-8 text-sm" value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} disabled={!canEdit} />
                </div>
                <div className="space-y-1.5 col-span-2">
                  <label className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Responsable</label>
                  <Select value={responsibleUserId || '__none__'} onValueChange={v => setResponsibleUserId(v === '__none__' ? '' : v)} disabled={!canEdit}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Sin asignar" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Sin asignar</SelectItem>
                      {members.map(m => (
                        <SelectItem key={m.id} value={m.id}>{[m.firstName, m.lastName].filter(Boolean).join(' ') || m.email}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5 col-span-2">
                  <label className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Notas</label>
                  <Textarea rows={2} className="text-sm resize-none" value={notes} onChange={e => setNotes(e.target.value)} disabled={!canEdit} />
                </div>
                {canEdit && (
                  <div className="col-span-2 flex justify-end">
                    <Button size="sm" className="gap-1.5" onClick={handleSave} disabled={saving}>
                      {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                      {saving ? 'Guardando...' : 'Guardar cambios'}
                    </Button>
                  </div>
                )}
              </div>

              <CollectionAttachmentsSection
                collectionProcessId={id}
                attachments={detail.attachments as CollectionAttachment[]}
                loading={false}
                canManage={canEdit}
                userEmail={userEmail}
                onChange={atts => setDetail(prev => prev ? { ...prev, attachments: atts } : prev)}
              />

              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <History className="w-3.5 h-3.5 text-muted-foreground" />
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Historial de cambios</p>
                </div>
                <AuditLog entries={detail.auditLog} loading={false} />
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
