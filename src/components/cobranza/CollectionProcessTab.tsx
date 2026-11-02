import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Building2, ExternalLink, History, Loader2, Save, Landmark } from 'lucide-react';
import { getCollectionProcesses, getCollectionProcessDetail, saveCollectionProcess, getTeamMembers, GetTeamMembersOutputType } from 'zite-endpoints-sdk';
import { useAuth } from 'zite-auth-sdk';
import CollectionAttachmentsSection, { CollectionAttachment } from './CollectionAttachmentsSection';
import StartCollectionProcessDialog from './StartCollectionProcessDialog';
import { toast } from 'sonner';
import { fmtCurrency } from '../../lib/format';
import { fasesQueAplican } from '@/lib/clientes/fases';
import { REGIMENES_FISCALES, etiquetaSat } from '@/lib/clientes/catalogos';
import type { Contacto, Entidad } from '@/components/clientes/tipos';

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

function FlowStepper({ phase, applicable }: { phase?: string; applicable?: string[] }) {
  if (!phase || phase === 'Atrasada') return null;
  // Con razón social asignada solo se muestran los pasos que aplican a ese cliente (más el actual, por si el proceso ya iba en otro).
  const pasos = applicable?.length ? FLOW_PHASES.filter(p => applicable.includes(p) || p === phase) : FLOW_PHASES;
  const idx = pasos.indexOf(phase);
  if (idx === -1) return null;
  return (
    <div className="w-full overflow-x-auto pb-1">
      <div className="grid" style={{ gridTemplateColumns: `repeat(${pasos.length}, minmax(0, 1fr))`, minWidth: pasos.length * 72 }}>
        {pasos.map((step, i) => {
          const state = i < idx ? 'done' : i === idx ? 'active' : 'pending';
          return (
            <div key={step} className="relative flex flex-col items-center">
              {/* La línea va del centro del paso anterior al centro de este: no depende del largo del texto de ninguno de los dos. */}
              {i > 0 && <div className={`absolute top-[13px] right-1/2 h-0.5 w-full rounded-full transition-colors ${i <= idx ? 'bg-primary' : 'bg-muted-foreground/15'}`} />}
              <div className={`relative z-10 w-7 h-7 rounded-full flex items-center justify-center border-2 text-[11px] font-bold transition-colors ${
                state === 'done' ? 'bg-primary border-primary text-primary-foreground' :
                state === 'active' ? 'bg-background border-primary text-primary' :
                'bg-background border-muted-foreground/25 text-muted-foreground/50'
              }`}>{state === 'done' ? '✓' : i + 1}</div>
              <span className={`text-[10px] mt-1.5 font-medium text-center leading-tight px-1 ${
                state === 'done' ? 'text-primary' : state === 'active' ? 'text-foreground font-semibold' : 'text-muted-foreground/60'
              }`}>{step}</span>
            </div>
          );
        })}
      </div>
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

function AuditLog({ entries }: { entries: AuditEntry[] }) {
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

function SectionCard({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-border bg-muted/20">
        {icon}
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

interface CatalogoDelCliente { clientId: string; clientName: string; entities: Entidad[]; contacts: Contacto[] }

// Lo que el catálogo de Clientes sabe de este proceso: a quién se le factura, qué pide ese cliente y a quién escribirle.
function ClienteYRazonSocial({ detail, canEdit, saving, onAssign }: { detail: Detail; canEdit: boolean; saving: boolean; onAssign: (id: string) => void }) {
  const cat = detail.clientCatalog as CatalogoDelCliente | undefined;
  const enlace = (id?: string) => `/comercial/clientes${id ? `?cliente=${id}` : ''}`;
  const verCliente = (id?: string, texto = 'Abrir ficha del cliente') => (
    <a href={enlace(id)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">{texto}<ExternalLink className="w-3 h-3" /></a>
  );
  if (!cat) {
    return (
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Este cliente todavía no está en el catálogo de Clientes.</p>
        {verCliente(undefined, 'Abrir Clientes')}
      </div>
    );
  }
  const e = cat.entities.find(x => x.id === detail.clientEntityId);
  const contactos = cat.contacts.filter(c => !c.entityId || c.entityId === e?.id);
  const pasos = e ? fasesQueAplican(e).filter(f => f !== 'Por iniciar') : [];
  const condiciones = e ? [
    e.creditDays != null ? `${e.creditDays} días de crédito` : null,
    e.paymentMethod,
    e.requiresPo ? 'Pide orden de compra' : null,
  ].filter(Boolean).join(' · ') : '';
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <InfoRow label="Cliente" value={cat.clientName} />
        <div className="space-y-1.5">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Razón social</p>
          {cat.entities.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin razón social registrada. {verCliente(cat.clientId, 'Registrarla')}</p>
          ) : (
            <Select value={e?.id ?? ''} onValueChange={onAssign} disabled={!canEdit || saving}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Elige la razón social" /></SelectTrigger>
              <SelectContent>
                {cat.entities.map(x => <SelectItem key={x.id} value={x.id}>{x.legalName || 'Sin nombre'}{x.rfc ? ` · ${x.rfc}` : ''}{x.active ? '' : ' (desactivada)'}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {cat.entities.length > 0 && !e && <p className="text-[11px] text-muted-foreground">Al elegirla se traen sus días de crédito y sus pasos.</p>}
        </div>
      </div>

      {e && (
        <div className="rounded-lg bg-muted/40 px-3.5 py-3 space-y-1.5 text-sm">
          {(e.rfc || e.taxRegime) && <p className="text-muted-foreground"><span className="font-mono">{[e.rfc, e.taxRegime ? etiquetaSat(REGIMENES_FISCALES, e.taxRegime) : null].filter(Boolean).join(' · ')}</span></p>}
          {condiciones && <p>{condiciones}</p>}
          {e.billingEmails && <p className="text-muted-foreground">Facturas a: {e.billingEmails}</p>}
          {pasos.length > 0 && <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Pasos:</span> {pasos.join(' → ')}</p>}
          {e.requiresPortal && e.portalUrl && <a href={e.portalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline"><ExternalLink className="w-3.5 h-3.5" />Portal del cliente</a>}
          {e.processNotes && <p className="whitespace-pre-wrap">{e.processNotes}</p>}
        </div>
      )}

      {contactos.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Contactos de cobranza</p>
          <div className="space-y-1">
            {contactos.map(c => (
              <p key={c.id} className="text-sm">
                <span className="font-medium">{c.name}</span>
                <span className="text-muted-foreground">{[c.role, c.email, c.phone].filter(Boolean).map(t => ` · ${t}`).join('')}</span>
              </p>
            ))}
          </div>
        </div>
      )}
      <div>{verCliente(cat.clientId)}</div>
    </div>
  );
}

type Detail = Awaited<ReturnType<typeof getCollectionProcessDetail>>;

interface Props {
  projectCode: string;
  client?: string;
}

export default function CollectionProcessTab({ projectCode, client }: Props) {
  const { user } = useAuth();
  const canEdit = user?.role === 'Owner' || user?.purchaseLevel === 'Finanzas';

  const [processId, setProcessId] = useState<string | null | undefined>(undefined);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(false);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [saving, setSaving] = useState(false);
  const [startDialogOpen, setStartDialogOpen] = useState(false);

  // Campos editables locales
  const [phase, setPhase] = useState('');
  const [status, setStatus] = useState('');
  const [scheduledPaymentDate, setScheduledPaymentDate] = useState('');
  // true solo cuando la persona edita el campo a mano en esta sesión — si se
  // manda siempre el valor actual (aunque no se haya tocado), saveCollectionProcess.ts
  // lo interpreta como un ajuste manual explícito y nunca vuelve a recalcularlo
  // solo con factura+días de crédito (confirmado en vivo: tras el primer guardado
  // con fecha ya poblada, cambiar los días de crédito dejaba de mover la fecha).
  const [scheduledPaymentDateDirty, setScheduledPaymentDateDirty] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceCreatedAt, setInvoiceCreatedAt] = useState('');
  const [creditDays, setCreditDays] = useState('');
  const [notes, setNotes] = useState('');
  const [responsibleUserId, setResponsibleUserId] = useState('');

  const loadProcessId = useCallback(async () => {
    const d = await getCollectionProcesses({ projectCode });
    setProcessId(d.processes[0]?.id ?? null);
  }, [projectCode]);

  useEffect(() => { loadProcessId(); }, [loadProcessId]);

  // Único punto que sincroniza los campos editables con lo que manda el
  // servidor — se usa tanto en la carga inicial como después de guardar, para
  // que valores calculados del lado del servidor (p.ej. scheduledPaymentDate
  // recalculada por saveCollectionProcess.ts) se reflejen sin recargar la
  // página (confirmado en vivo: sin esto, "Guardar cambios" dejaba la fecha
  // programada en blanco aunque el backend ya la había calculado bien).
  const hydrateFields = (d: Detail) => {
    setDetail(d);
    setPhase(d.phase ?? 'Por iniciar');
    setStatus(d.status ?? 'Al día');
    setScheduledPaymentDate(d.scheduledPaymentDate ? d.scheduledPaymentDate.split('T')[0] : '');
    setScheduledPaymentDateDirty(false);
    setInvoiceNumber(d.invoiceNumber ?? '');
    setInvoiceCreatedAt(d.invoiceCreatedAt ? d.invoiceCreatedAt.split('T')[0] : '');
    setCreditDays(d.creditDays != null ? String(d.creditDays) : '');
    setNotes(d.notes ?? '');
    setResponsibleUserId(d.responsibleUserId ?? '');
  };

  useEffect(() => {
    if (!processId) return;
    setLoading(true);
    Promise.all([getCollectionProcessDetail({ id: processId }), getTeamMembers({})])
      .then(([d, teamRes]) => {
        hydrateFields(d);
        setMembers(teamRes.members);
      })
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [processId]);

  const refreshDetail = async () => {
    if (!processId) return;
    const d = await getCollectionProcessDetail({ id: processId });
    hydrateFields(d);
  };

  const handleSave = async () => {
    if (!processId || !detail) return;
    setSaving(true);
    try {
      await saveCollectionProcess({
        id: processId,
        phase,
        status,
        scheduledPaymentDate: scheduledPaymentDateDirty ? (scheduledPaymentDate || undefined) : undefined,
        invoiceNumber: invoiceNumber || undefined,
        invoiceCreatedAt: invoiceCreatedAt || undefined,
        creditDays: creditDays !== '' ? Number(creditDays) : undefined,
        notes: notes || undefined,
        responsibleUser: responsibleUserId || undefined,
      });
      toast.success('Proceso de cobranza actualizado');
      await refreshDetail();
    } catch (err: unknown) {
      toast.error((err as Error).message ?? 'Error al guardar');
    }
    setSaving(false);
  };

  // Elegir la razón social trae sus días de crédito y sus pasos al proceso (ver saveCollectionProcess.ts); por eso se guarda al momento y se vuelve a leer todo.
  const asignarRazonSocial = async (id: string) => {
    if (!processId) return;
    setSaving(true);
    try {
      await saveCollectionProcess({ id: processId, clientEntityId: id });
      toast.success('Razón social asignada');
      await refreshDetail();
    } catch (err: unknown) {
      toast.error((err as Error).message ?? 'No se pudo asignar la razón social');
    }
    setSaving(false);
  };

  if (processId === undefined) {
    return (
      <div className="p-6 space-y-3 max-w-4xl">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (processId === null) {
    return (
      <div className="p-10 flex flex-col items-center justify-center text-center gap-3 max-w-md mx-auto">
        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
          <Landmark className="w-6 h-6 text-primary" />
        </div>
        <div>
          <p className="text-sm font-medium">Este proyecto todavía no tiene proceso de cobranza</p>
          <p className="text-xs text-muted-foreground mt-1">Arráncalo cuando el proyecto se entregue: número y fecha de factura, días de crédito, y la factura misma.</p>
        </div>
        {canEdit && (
          <Button className="mt-2 gap-1.5" onClick={() => setStartDialogOpen(true)}>
            <Landmark className="w-3.5 h-3.5" />
            Iniciar proceso de cobranza
          </Button>
        )}
        <StartCollectionProcessDialog
          projectCode={projectCode}
          client={client}
          open={startDialogOpen}
          onClose={() => setStartDialogOpen(false)}
          onCreated={loadProcessId}
        />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-6 space-y-5">
        {loading || !detail ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : (
          <>
            {/* Encabezado: cliente / monto / estatus */}
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground font-mono mb-0.5">{detail.projectCode ?? projectCode}</p>
                <h2 className="text-lg font-bold leading-tight">{detail.client ?? detail.dealName ?? 'Sin cliente'}</h2>
                <p className="text-sm text-muted-foreground mt-0.5">{fmtCurrency(detail.collectionAmount, detail.currency)} por cobrar</p>
              </div>
              <span className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold flex-shrink-0 ${STATUS_STYLES[detail.effectiveStatus ?? detail.status ?? ''] ?? 'bg-muted text-muted-foreground'}`}>
                {detail.effectiveStatus ?? detail.status ?? 'Al día'}
              </span>
            </div>

            {/* Stepper */}
            <div className="rounded-xl border border-border bg-card px-5 py-4">
              <FlowStepper phase={detail.phase} applicable={detail.applicablePhases} />
            </div>

            <SectionCard title="Cliente y razón social" icon={<Building2 className="w-3.5 h-3.5 text-muted-foreground" />}>
              <ClienteYRazonSocial detail={detail} canEdit={canEdit} saving={saving} onAssign={asignarRazonSocial} />
            </SectionCard>

            {/* Resumen de solo lectura */}
            <SectionCard title="Resumen">
              <div className="grid grid-cols-3 gap-x-6 gap-y-4">
                <InfoRow label="Deal" value={detail.dealName} />
                <InfoRow label="Monto cotizado" value={fmtCurrency(detail.quotedAmount, detail.currency)} />
                <InfoRow label="Monto a cobrar" value={fmtCurrency(detail.collectionAmount, detail.currency)} />
                <InfoRow label="Proforma creada" value={fmtDate(detail.proformaCreatedAt)} />
                <InfoRow label="Proforma enviada" value={fmtDate(detail.proformaSentAt)} />
                <InfoRow label="Factura enviada" value={fmtDate(detail.invoiceSentAt)} />
                <InfoRow label="Subida al portal" value={fmtDate(detail.portalUploadedAt)} />
                <InfoRow label="GR / Migo" value={fmtDate(detail.grMigoAt)} />
                <InfoRow label="Pagado el" value={fmtDate(detail.paidAt)} />
              </div>
            </SectionCard>

            {/* Datos y edición */}
            <SectionCard title="Datos y edición">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Fase</label>
                  <Select value={phase} onValueChange={setPhase} disabled={!canEdit}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>{PHASES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Estatus</label>
                  <Select value={status} onValueChange={setStatus} disabled={!canEdit}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Folio de factura</label>
                  <Input className="h-9 text-sm" value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} disabled={!canEdit} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Fecha de factura</label>
                  <Input type="date" className="h-9 text-sm" value={invoiceCreatedAt} onChange={e => setInvoiceCreatedAt(e.target.value)} disabled={!canEdit} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Días de crédito</label>
                  <Input type="number" min={0} className="h-9 text-sm" value={creditDays} onChange={e => setCreditDays(e.target.value)} disabled={!canEdit} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Fecha programada de pago</label>
                  <Input type="date" className="h-9 text-sm" value={scheduledPaymentDate} onChange={e => { setScheduledPaymentDate(e.target.value); setScheduledPaymentDateDirty(true); }} disabled={!canEdit} />
                  <p className="text-[10px] text-muted-foreground">Se recalcula sola con factura + días de crédito si la dejas vacía.</p>
                </div>
                <div className="space-y-1.5 col-span-2">
                  <label className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Responsable</label>
                  <Select value={responsibleUserId || '__none__'} onValueChange={v => setResponsibleUserId(v === '__none__' ? '' : v)} disabled={!canEdit}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Sin asignar" /></SelectTrigger>
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
                  <Textarea rows={3} className="text-sm resize-none" value={notes} onChange={e => setNotes(e.target.value)} disabled={!canEdit} />
                </div>
              </div>
              {canEdit && (
                <div className="flex justify-end mt-5 pt-4 border-t border-border">
                  <Button className="gap-1.5" onClick={handleSave} disabled={saving}>
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    {saving ? 'Guardando...' : 'Guardar cambios'}
                  </Button>
                </div>
              )}
            </SectionCard>

            <SectionCard title="Documentos">
              <CollectionAttachmentsSection
                collectionProcessId={processId}
                attachments={detail.attachments as CollectionAttachment[]}
                loading={false}
                canManage={canEdit}
                userEmail={user?.email ?? ''}
                onChange={atts => setDetail(prev => prev ? { ...prev, attachments: atts } : prev)}
              />
            </SectionCard>

            <SectionCard title="Historial de cambios" icon={<History className="w-3.5 h-3.5 text-muted-foreground" />}>
              <AuditLog entries={detail.auditLog} />
            </SectionCard>
          </>
        )}
      </div>
    </div>
  );
}
