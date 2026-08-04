import { useState, useEffect, useRef } from 'react';
import { GetDealsOutputType, saveDeal, deleteDeal, getUsers, GetUsersOutputType, saveProject, approveSelectedCotizaciones } from 'zite-endpoints-sdk';
import ApprovalReviewDialog from './ApprovalReviewDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Trash2, FolderPlus, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { PHASES, CURRENCIES, getCurrencySymbol, fmtMoneyFull } from './dealUtils';
import NumericInput from '@/components/NumericInput';

type Deal = GetDealsOutputType['deals'][0];
type UserItem = GetUsersOutputType['users'][0];
const PHASE_KEYS = PHASES.map(p => p.key);

interface Props {
  deal: Deal;
  onSaved: (updated: Deal) => void;
  onDeleted: () => void;
  existingClients?: string[];
}

const APPROVE_PHASES = ['Cotización enviada', 'Negociación'];

export default function DealGeneralTab({ deal, onSaved, onDeleted, existingClients = [] }: Props) {
  const [form, setForm] = useState({
    dealName: deal.dealName ?? '', phase: deal.phase ?? 'Prospecto',
    client: deal.client ?? '', projectType: deal.projectType ?? '',
    tematica: deal.tematica ?? '', proposalDate: (deal.proposalDate ?? '').slice(0, 10),
    approvalDate: (deal.approvalDate ?? '').slice(0, 10), currency: deal.currency ?? 'MXN 🇲🇽',
    clientPrice: deal.clientPrice?.toString() ?? '', taxesPct: deal.taxesPct?.toString() ?? '',
    retencionesPct: deal.retencionesPct?.toString() ?? '',
    notes: deal.notes ?? '',
  });
  const [owner, setOwner] = useState((Array.isArray(deal.owner) ? deal.owner[0] : deal.owner) ?? '');
  const [users, setUsers] = useState<UserItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [pendingApprove, setPendingApprove] = useState<{ dealId: string; updated: Deal } | null>(null);
  const [approving, setApproving] = useState(false);
  const [approvalReviewOpen, setApprovalReviewOpen] = useState(false);
  const [clientFocused, setClientFocused] = useState(false);
  const clientBlurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dealAny = deal as any;
  const hasLinkedProject = Array.isArray(dealAny.projects)
    ? (dealAny.projects as string[]).length > 0
    : !!dealAny.projects;

  const handleCreateProject = async () => {
    setCreatingProject(true);
    try {
      const code = form.dealName || 'Proyecto ' + Date.now().toString().slice(-4);
      await saveProject({
        projectCode: code,
        fullName: form.dealName || undefined,
        client: form.client || undefined,
        tematica: form.tematica || undefined,
        status: 'Activo',
      });
      toast.success(`Proyecto "${code}" creado exitosamente`);
    } catch { toast.error('Error al crear el proyecto'); }
    setCreatingProject(false);
  };

  const handleApprovalSuccess = (res: { projectCode: string; projectId: string; quotedCost: number; notificationsSent: number }) => {
    const today = new Date().toISOString().split('T')[0];
    const updated: Deal = { ...deal, phase: 'Ganado', approvalDate: today, quotedCost: res.quotedCost };
    (updated as any).projects = [res.projectId];
    setForm(f => ({ ...f, phase: 'Ganado', approvalDate: today }));
    onSaved(updated);
  };

  // Sync form when deal prop changes from outside
  useEffect(() => {
    setForm(f => ({
      ...f,
      clientPrice: deal.clientPrice?.toString() ?? f.clientPrice,
      retencionesPct: deal.retencionesPct?.toString() ?? f.retencionesPct,
      proposalDate: deal.proposalDate ? deal.proposalDate.slice(0, 10) : f.proposalDate,
      approvalDate: deal.approvalDate ? deal.approvalDate.slice(0, 10) : f.approvalDate,
    }));
  }, [deal.clientPrice, deal.retencionesPct, deal.proposalDate, deal.approvalDate]);

  useEffect(() => {
    getUsers({}).then(d => setUsers(d.users));
  }, []);

  const sf = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await saveDeal({
        id: deal.id || undefined, dealName: form.dealName || undefined,
        phase: form.phase, client: form.client || undefined,
        projectType: form.projectType || undefined, tematica: form.tematica || undefined,
        owner: owner ? [owner] : undefined, proposalDate: form.proposalDate || undefined,
        approvalDate: form.approvalDate || undefined, currency: form.currency,
        clientPrice: form.clientPrice ? Number(form.clientPrice) : undefined,
        taxesPct: form.taxesPct ? Number(form.taxesPct) : undefined,
        retencionesPct: form.retencionesPct ? Number(form.retencionesPct) : undefined,
        quotedCost: deal.quotedCost ?? undefined,
        notes: form.notes || undefined,
      });
      const updated: Deal = {
        id: result.id, ...form, owner: owner ? [owner] : undefined,
        clientPrice: form.clientPrice ? Number(form.clientPrice) : undefined,
        taxesPct: form.taxesPct ? Number(form.taxesPct) : undefined,
        retencionesPct: form.retencionesPct ? Number(form.retencionesPct) : undefined,
        quotedCost: deal.quotedCost ?? undefined,
      };
      toast.success('Deal guardado');
      onSaved(updated);
      if (form.phase === 'Ganado' && result.id) {
        setPendingApprove({ dealId: result.id, updated });
      }
    } catch { toast.error('Error al guardar'); }
    setSaving(false);
  };

  const handleDelete = async () => {
    await deleteDeal({ id: deal.id });
    toast.success('Deal eliminado');
    onDeleted();
  };

  const userName = (u: UserItem) => [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || u.id;

  const clientPrice = form.clientPrice ? Number(form.clientPrice) : 0;
  const taxesPct = form.taxesPct ? Number(form.taxesPct) : 0;
  const retencionesPct = form.retencionesPct ? Number(form.retencionesPct) : 0;
  const impuestos = clientPrice * taxesPct / 100;
  const retenciones = clientPrice * retencionesPct / 100;
  const totalACobrar = clientPrice + impuestos - retenciones;
  const sym = getCurrencySymbol(form.currency);

  const clientSuggestions = clientFocused && form.client.length > 0
    ? existingClients.filter(c => c.toLowerCase().includes(form.client.toLowerCase()) && c !== form.client)
    : [];

  const canApprove = deal.id && APPROVE_PHASES.includes(form.phase);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 space-y-1"><Label>Nombre del deal *</Label>
          <Input value={form.dealName} onChange={sf('dealName')} placeholder="Ej: Proyecto Banco Nacional Q1" />
        </div>
        <div className="space-y-1"><Label>Fase</Label>
          <Select value={form.phase} onValueChange={v => setForm(f => ({ ...f, phase: v }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{PHASE_KEYS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1 relative"><Label>Cliente</Label>
          <Input
            value={form.client}
            onChange={sf('client')}
            onFocus={() => {
              if (clientBlurTimer.current) clearTimeout(clientBlurTimer.current);
              setClientFocused(true);
            }}
            onBlur={() => {
              clientBlurTimer.current = setTimeout(() => setClientFocused(false), 150);
            }}
            placeholder="Nombre del cliente..."
          />
          {clientSuggestions.length > 0 && (
            <div className="absolute z-50 mt-1 w-full bg-popover border border-border rounded-lg shadow-lg max-h-40 overflow-y-auto">
              {clientSuggestions.map(c => (
                <button
                  key={c}
                  type="button"
                  className="w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground transition-colors first:rounded-t-lg last:rounded-b-lg"
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => {
                    setForm(f => ({ ...f, client: c }));
                    setClientFocused(false);
                  }}
                >
                  {c}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="space-y-1"><Label>Tipo de proyecto</Label>
          <Input value={form.projectType} onChange={sf('projectType')} placeholder="Cualitativo, Cuantitativo..." />
        </div>
        <div className="space-y-1"><Label>Temática</Label>
          <Input value={form.tematica} onChange={sf('tematica')} placeholder="Ej: Banca digital" />
        </div>
        <div className="space-y-1"><Label>Responsable</Label>
          <Select value={owner || '__none__'} onValueChange={v => setOwner(v === '__none__' ? '' : v)}>
            <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
            <SelectContent>{users.map(u => <SelectItem key={u.id} value={u.id}>{userName(u)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1"><Label>Moneda</Label>
          <Select value={form.currency} onValueChange={v => setForm(f => ({ ...f, currency: v }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{CURRENCIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1"><Label>Precio a cliente</Label>
          <NumericInput
            value={clientPrice}
            onChange={v => setForm(f => ({ ...f, clientPrice: v ? String(v) : '' }))}
            min={0}
            formatDisplay={(v) => fmtMoneyFull(v, sym)}
          />
        </div>
        <div className="space-y-1"><Label>Impuestos (%)</Label>
          <NumericInput
            value={taxesPct}
            onChange={v => setForm(f => ({ ...f, taxesPct: v ? String(v) : '' }))}
            min={0}
            placeholder="16"
          />
        </div>
        <div className="space-y-1"><Label>Retenciones (%)</Label>
          <NumericInput
            value={retencionesPct}
            onChange={v => setForm(f => ({ ...f, retencionesPct: v ? String(v) : '' }))}
            min={0}
            placeholder="0"
          />
        </div>
        <div className="space-y-1"><Label>Fecha envío propuesta</Label>
          <Input type="date" value={form.proposalDate} onChange={sf('proposalDate')} />
        </div>
        <div className="space-y-1"><Label>Fecha aprobación</Label>
          <Input type="date" value={form.approvalDate} onChange={sf('approvalDate')} />
        </div>
      </div>

      {/* Financial summary */}
      {clientPrice > 0 && (
        <div className="bg-muted/20 border rounded-lg p-3 space-y-1.5 text-sm">
          <div className="flex justify-between text-muted-foreground">
            <span>Precio a cliente</span>
            <span>{fmtMoneyFull(clientPrice, sym)}</span>
          </div>
          {taxesPct > 0 && (
            <div className="flex justify-between text-muted-foreground">
              <span>+ Impuestos ({taxesPct}%)</span>
              <span>{fmtMoneyFull(impuestos, sym)}</span>
            </div>
          )}
          {retencionesPct > 0 && (
            <div className="flex justify-between text-muted-foreground">
              <span>− Retenciones ({retencionesPct}%)</span>
              <span>−{fmtMoneyFull(retenciones, sym)}</span>
            </div>
          )}
          <div className="flex justify-between font-bold text-primary border-t pt-1.5 mt-1">
            <span>= Total a cobrar</span>
            <span>{fmtMoneyFull(totalACobrar, sym)}</span>
          </div>
        </div>
      )}

      <div className="space-y-1"><Label>Notas</Label>
        <Textarea rows={2} value={form.notes} onChange={sf('notes')} />
      </div>

      {/* ── Approve Deal banner (for Cotización enviada / Negociación) ── */}
      {canApprove && (
        <div className="border rounded-xl p-4 bg-primary/5 border-primary/20">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-primary flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                Listo para aprobar
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Crea el proyecto, aprueba cotizaciones y notifica a los responsables de cada rubro
              </p>
            </div>
            <Button
              size="sm"
              onClick={() => setApprovalReviewOpen(true)}
              className="gap-1.5 flex-shrink-0"
            >
              <CheckCircle2 className="w-4 h-4" />
              Aprobar Deal
            </Button>
          </div>
        </div>
      )}

      {/* ── Fallback: "Crear Proyecto" when already Ganado but no project linked ── */}
      {form.phase === 'Ganado' && deal.id && !hasLinkedProject && (
        <div className="border rounded-xl p-3 bg-muted/20 border-border flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-foreground flex items-center gap-1.5">
              <FolderPlus className="w-4 h-4" /> Deal ganado
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Crea el proyecto con los datos de este deal
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={handleCreateProject} disabled={creatingProject} className="gap-1.5 flex-shrink-0">
            <FolderPlus className="w-4 h-4" />
            {creatingProject ? 'Creando...' : 'Crear Proyecto'}
          </Button>
        </div>
      )}

      <div className="flex items-center justify-between pt-1">
        {deal.id && (
          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive gap-1" onClick={() => setConfirmDel(true)}>
            <Trash2 className="w-3.5 h-3.5" /> Eliminar
          </Button>
        )}
        <Button onClick={handleSave} disabled={saving} className="ml-auto">{saving ? 'Guardando...' : 'Guardar'}</Button>
      </div>

      {/* ── Aprobar Deal — review dialog ── */}
      <ApprovalReviewDialog
        open={approvalReviewOpen}
        onClose={() => setApprovalReviewOpen(false)}
        deal={deal}
        onApproved={handleApprovalSuccess}
      />

      {/* Approve included cotizaciones dialog (triggered when manually setting phase to Ganado) */}
      <AlertDialog open={!!pendingApprove} onOpenChange={o => !o && setPendingApprove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Aprobar cotizaciones incluidas?</AlertDialogTitle>
            <AlertDialogDescription>
              Las cotizaciones marcadas como "Incluida" se marcarán como <strong>Aprobadas</strong> y el costo cotizado del deal se actualizará automáticamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingApprove(null)}>No por ahora</AlertDialogCancel>
            <AlertDialogAction
              disabled={approving}
              onClick={async () => {
                if (!pendingApprove) return;
                setApproving(true);
                try {
                  const res = await approveSelectedCotizaciones({ dealId: pendingApprove.dealId });
                  toast.success(`${res.approvedCount} cotización${res.approvedCount !== 1 ? 'es' : ''} aprobada${res.approvedCount !== 1 ? 's' : ''}`);
                  onSaved({ ...pendingApprove.updated, quotedCost: res.totalCost });
                } catch { toast.error('Error al aprobar cotizaciones'); }
                setApproving(false);
                setPendingApprove(null);
              }}
            >
              {approving ? 'Aprobando...' : 'Sí, aprobar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDel} onOpenChange={setConfirmDel}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>¿Eliminar deal?</AlertDialogTitle>
            <AlertDialogDescription>Esta acción no se puede deshacer.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
