import { useState, useEffect } from 'react';
import { GetDealsOutputType, saveDeal, deleteDeal, getUsers, GetUsersOutputType, saveProject, getProjectForDeal } from 'zite-endpoints-sdk';
import { useAuth } from 'zite-auth-sdk';
import ApprovalReviewDialog from './ApprovalReviewDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Trash2, FolderPlus, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import ComboboxCreatable from '@/components/ComboboxCreatable';

type Deal = GetDealsOutputType['deals'][0];
type UserItem = GetUsersOutputType['users'][0];

interface Props {
  deal: Deal;
  onSaved: (updated: Deal) => void;
  onDeleted: () => void;
  existingClients?: string[];
}

const APPROVE_PHASES = ['Cotización enviada', 'Negociación'];

export default function DealGeneralTab({ deal, onSaved, onDeleted, existingClients = [] }: Props) {
  const { user } = useAuth();
  const isNew = !deal.id;

  // Al crear, solo se pide lo que de verdad se sabe el día uno (nombre,
  // cliente, tipo, temática, notas) — precio/impuestos/retenciones/moneda
  // viven ahora en la pestaña Cotizaciones (se piden cuando ya hay algo que
  // cotizar, no antes) y la fase es un badge en el header de
  // DealDetailSheet.tsx, no un campo de este formulario. Un deal nuevo nace
  // en "Prospecto" sin preguntar.
  const [form, setForm] = useState({
    dealName: deal.dealName ?? '',
    client: deal.client ?? '',
    projectType: deal.projectType ?? '',
    tematica: deal.tematica ?? '',
    notes: deal.notes ?? '',
  });
  const [owner, setOwner] = useState((Array.isArray(deal.owner) ? deal.owner[0] : deal.owner) ?? '');
  const [users, setUsers] = useState<UserItem[]>([]);

  // Default a "owner" al usuario actual solo al crear. useAuth() hidrata al
  // usuario de forma asíncrona (getMe/getUsers), así que si este formulario
  // monta antes de que resuelva, un default calculado una sola vez en el
  // useState de arriba se queda en '' para siempre — este efecto lo completa
  // en cuanto el perfil llega, sin pisar una elección manual ya hecha.
  useEffect(() => {
    if (isNew && user?.id) setOwner(prev => prev || user.id);
  }, [isNew, user?.id]);
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [approvalReviewOpen, setApprovalReviewOpen] = useState(false);

  // Deals no tiene una columna real de vuelta hacia Projects — solo existe
  // Projects.dealVinculado (ver server/compat/schema-map.ts). Un deal.projects
  // en el objeto Deal siempre viene undefined, así que la única forma
  // confiable de saber si ya existe un proyecto es preguntarle a Projects
  // directamente. checkingProject evita el "flash" del botón "Crear Proyecto"
  // mientras se resuelve — mostrarlo de más, aunque sea un instante, es
  // exactamente el hueco que generaba proyectos duplicados.
  const [linkedProject, setLinkedProject] = useState<{ id: string; projectCode?: string } | null>(null);
  const [checkingProject, setCheckingProject] = useState(true);

  useEffect(() => {
    if (!deal.id) { setLinkedProject(null); setCheckingProject(false); return; }
    setCheckingProject(true);
    getProjectForDeal({ dealId: deal.id })
      .then(d => setLinkedProject(d.project))
      .catch(() => setLinkedProject(null))
      .finally(() => setCheckingProject(false));
  }, [deal.id]);

  const handleCreateProject = async () => {
    if (!deal.id) return;
    setCreatingProject(true);
    try {
      const code = form.dealName || 'Proyecto ' + Date.now().toString().slice(-4);
      const result = await saveProject({
        projectCode: code,
        fullName: form.dealName || undefined,
        client: form.client || undefined,
        tematica: form.tematica || undefined,
        status: 'En curso',
        dealVinculado: deal.id,
      });
      toast.success(`Proyecto "${code}" creado exitosamente`);
      setLinkedProject({ id: result.id, projectCode: code });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al crear el proyecto');
    }
    setCreatingProject(false);
  };

  const handleApprovalSuccess = (res: { projectCode: string; projectId: string; quotedCost: number; notificationsSent: number }) => {
    const today = new Date().toISOString().split('T')[0];
    const updated: Deal = { ...deal, phase: 'Ganado', approvalDate: today, quotedCost: res.quotedCost };
    setLinkedProject({ id: res.projectId, projectCode: res.projectCode });
    onSaved(updated);
  };

  useEffect(() => {
    getUsers({}).then(d => setUsers(d.users));
  }, []);

  const sf = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await saveDeal({
        id: deal.id || undefined,
        dealName: form.dealName || undefined,
        client: form.client || undefined,
        projectType: form.projectType || undefined,
        tematica: form.tematica || undefined,
        owner: owner ? [owner] : undefined,
        notes: form.notes || undefined,
        // Solo al crear: la fase nace en Prospecto sin preguntar (en edición
        // la fase la maneja el badge del header, este form ya no la toca).
        ...(isNew ? { phase: 'Prospecto' } : {}),
      });
      const updated: Deal = {
        ...deal,
        id: result.id,
        ...form,
        owner: owner ? [owner] : undefined,
        ...(isNew ? { phase: 'Prospecto' } : {}),
      };
      toast.success('Deal guardado');
      onSaved(updated);
    } catch { toast.error('Error al guardar'); }
    setSaving(false);
  };

  const handleDelete = async () => {
    await deleteDeal({ id: deal.id });
    toast.success('Deal eliminado');
    onDeleted();
  };

  const userName = (u: UserItem) => [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || u.id;

  const canApprove = !!deal.id && APPROVE_PHASES.includes(deal.phase ?? '');

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 space-y-1"><Label>Nombre del deal *</Label>
          <Input value={form.dealName} onChange={sf('dealName')} placeholder="Ej: Proyecto Banco Nacional Q1" />
        </div>
        <div className="space-y-1"><Label>Cliente</Label>
          <ComboboxCreatable
            value={form.client}
            onChange={v => setForm(f => ({ ...f, client: v }))}
            options={existingClients}
            placeholder="Nombre del cliente..."
          />
        </div>
        <div className="space-y-1"><Label>Tipo de proyecto</Label>
          <Input value={form.projectType} onChange={sf('projectType')} placeholder="Cualitativo, Cuantitativo..." />
        </div>
        <div className="space-y-1"><Label>Temática</Label>
          <Input value={form.tematica} onChange={sf('tematica')} placeholder="Ej: Banca digital" />
        </div>
        {/* Responsable: se pide en edición, no en creación — nace asignado a
            quien lo crea (arriba, owner default = user actual) y se puede
            reasignar después sin que estorbe en el alta. */}
        {!isNew && (
          <div className="space-y-1"><Label>Responsable</Label>
            <Select value={owner || '__none__'} onValueChange={v => setOwner(v === '__none__' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
              <SelectContent>{users.map(u => <SelectItem key={u.id} value={u.id}>{userName(u)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="space-y-1"><Label>Notas</Label>
        <Textarea rows={2} value={form.notes} onChange={sf('notes')} />
      </div>

      {/* ── Approve Deal banner (para Cotización enviada / Negociación) ── */}
      {canApprove && (
        <div className="border rounded-xl p-4 bg-[#027495]/8 border-[#027495]/25">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[#0F3D4C] flex items-center gap-1.5">
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
              className="gap-1.5 flex-shrink-0 bg-[#0F3D4C] hover:bg-[#0A2F3B] text-white"
            >
              <CheckCircle2 className="w-4 h-4" />
              Aprobar Deal
            </Button>
          </div>
        </div>
      )}

      {/* ── Deal ganado + proyecto ya vinculado: confirmación, no botón ── */}
      {deal.phase === 'Ganado' && deal.id && !checkingProject && linkedProject && (
        <div className="border rounded-xl p-3 bg-muted/20 border-border flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-primary flex-shrink-0" />
          <p className="text-sm text-foreground">
            Proyecto ya creado: <span className="font-semibold">{linkedProject.projectCode ?? linkedProject.id}</span>
          </p>
        </div>
      )}

      {/* ── Fallback: "Crear Proyecto" cuando ya está Ganado pero sin proyecto vinculado ── */}
      {deal.phase === 'Ganado' && deal.id && !checkingProject && !linkedProject && (
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
        <Button onClick={handleSave} disabled={saving} className="ml-auto bg-[#0F3D4C] hover:bg-[#0A2F3B] text-white">{saving ? 'Guardando...' : 'Guardar'}</Button>
      </div>

      {/* ── Aprobar Deal — review dialog ── */}
      <ApprovalReviewDialog
        open={approvalReviewOpen}
        onClose={() => setApprovalReviewOpen(false)}
        deal={deal}
        onApproved={handleApprovalSuccess}
      />

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
