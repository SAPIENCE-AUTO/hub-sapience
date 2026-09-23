import { useState, useEffect, useRef } from 'react';
import { GetDealsOutputType, saveDeal, deleteDeal, getUsers, GetUsersOutputType } from 'zite-endpoints-sdk';
import { useAuth } from 'zite-auth-sdk';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Trash2, CheckCircle2, Check } from 'lucide-react';
import { toast } from 'sonner';
import ComboboxCreatable from '@/components/ComboboxCreatable';

type Deal = GetDealsOutputType['deals'][0];
type UserItem = GetUsersOutputType['users'][0];

interface Props {
  deal: Deal;
  onSaved: (updated: Deal) => void;
  onDeleted: () => void;
  existingClients?: string[];
  linkedProject: { id: string; projectCode?: string } | null;
  checkingProject: boolean;
}

type FormField = 'dealName' | 'client' | 'projectType' | 'tematica' | 'notes' | 'approvalDate';

// Chip chiquito "Guardado" que aparece junto a un campo un par de segundos
// después de un autoguardado exitoso — sin esto, un guardado silencioso por
// campo (sin botón "Guardar" ya) no da ninguna señal de que sí funcionó.
function SavedTick({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span className="inline-flex items-center gap-0.5 text-[11px] text-emerald-600 font-medium">
      <Check className="w-3 h-3" /> Guardado
    </span>
  );
}

export default function DealGeneralTab({ deal, onSaved, onDeleted, existingClients = [], linkedProject, checkingProject }: Props) {
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
    approvalDate: deal.approvalDate ? deal.approvalDate.slice(0, 10) : '',
  });
  // Últimos valores ya guardados — para no reguardar en un blur donde no
  // cambió nada (p.ej. entrar y salir de un campo sin tocarlo).
  const savedValues = useRef(form);
  const [owner, setOwner] = useState((Array.isArray(deal.owner) ? deal.owner[0] : deal.owner) ?? '');
  const [users, setUsers] = useState<UserItem[]>([]);
  const [savedField, setSavedField] = useState<FormField | 'owner' | null>(null);

  // Default a "owner" al usuario actual solo al crear. useAuth() hidrata al
  // usuario de forma asíncrona (getMe/getUsers), así que si este formulario
  // monta antes de que resuelva, un default calculado una sola vez en el
  // useState de arriba se queda en '' para siempre — este efecto lo completa
  // en cuanto el perfil llega, sin pisar una elección manual ya hecha.
  useEffect(() => {
    if (isNew && user?.id) setOwner(prev => prev || user.id);
  }, [isNew, user?.id]);
  const [confirmDel, setConfirmDel] = useState(false);

  useEffect(() => {
    getUsers({}).then(d => setUsers(d.users));
  }, []);

  const sf = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  // Autoguardado por campo — reemplaza el botón "Guardar" central de antes,
  // que solo vivía en esta pestaña y dejaba las otras 4 del deal sin forma de
  // guardar cambios propios. Mismo patrón que ya usa el resto de la app
  // (edición inline en ProjectsPage.tsx, celdas de Reclutamiento). saveDeal
  // ya soporta updates parciales (server/api/saveDeal.ts solo toca los campos
  // que de verdad vienen en el input), así que no hace falta mandar el form
  // completo cada vez — solo el campo que cambió.
  const commitField = async (field: FormField, value: string) => {
    if (savedValues.current[field] === value) return; // sin cambios reales
    try {
      const result = await saveDeal({
        id: deal.id || undefined,
        [field]: value || undefined,
        // Solo al crear: la fase nace en Prospecto sin preguntar (en edición
        // la fase la maneja el badge del header, este form ya no la toca).
        ...(deal.id ? {} : { phase: 'Prospecto' }),
      });
      savedValues.current = { ...savedValues.current, [field]: value };
      onSaved({ ...deal, id: result.id, [field]: value });
      setSavedField(field);
      setTimeout(() => setSavedField(f => (f === field ? null : f)), 1800);
    } catch {
      toast.error('Error al guardar');
    }
  };

  const commitOwner = async (newOwner: string) => {
    setOwner(newOwner);
    if (!deal.id) return; // el responsable solo se pide en edición, ver abajo
    try {
      await saveDeal({ id: deal.id, owner: newOwner ? [newOwner] : undefined });
      onSaved({ ...deal, owner: newOwner ? [newOwner] : undefined });
      setSavedField('owner');
      setTimeout(() => setSavedField(f => (f === 'owner' ? null : f)), 1800);
    } catch {
      toast.error('Error al guardar');
    }
  };

  const handleDelete = async () => {
    await deleteDeal({ id: deal.id });
    toast.success('Deal eliminado');
    onDeleted();
  };

  const userName = (u: UserItem) => [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || u.id;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 space-y-1">
          <div className="flex items-center gap-2"><Label>Nombre del deal *</Label><SavedTick show={savedField === 'dealName'} /></div>
          <Input value={form.dealName} onChange={sf('dealName')} onBlur={() => commitField('dealName', form.dealName)} placeholder="Ej: Proyecto Banco Nacional Q1" />
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-2"><Label>Cliente</Label><SavedTick show={savedField === 'client'} /></div>
          <ComboboxCreatable
            value={form.client}
            onChange={v => { setForm(f => ({ ...f, client: v })); commitField('client', v); }}
            options={existingClients}
            placeholder="Nombre del cliente..."
          />
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-2"><Label>Tipo de proyecto</Label><SavedTick show={savedField === 'projectType'} /></div>
          <Input value={form.projectType} onChange={sf('projectType')} onBlur={() => commitField('projectType', form.projectType)} placeholder="Cualitativo, Cuantitativo..." />
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-2"><Label>Temática</Label><SavedTick show={savedField === 'tematica'} /></div>
          <Input value={form.tematica} onChange={sf('tematica')} onBlur={() => commitField('tematica', form.tematica)} placeholder="Ej: Banca digital" />
        </div>
        {/* Responsable: se pide en edición, no en creación — nace asignado a
            quien lo crea (arriba, owner default = user actual) y se puede
            reasignar después sin que estorbe en el alta. */}
        {!isNew && (
          <div className="space-y-1">
            <div className="flex items-center gap-2"><Label>Responsable</Label><SavedTick show={savedField === 'owner'} /></div>
            <Select value={owner || '__none__'} onValueChange={v => commitOwner(v === '__none__' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
              <SelectContent>{users.map(u => <SelectItem key={u.id} value={u.id}>{userName(u)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}
        {!isNew && (
          <div className="space-y-1">
            <div className="flex items-center gap-2"><Label>Fecha de aprobación</Label><SavedTick show={savedField === 'approvalDate'} /></div>
            <Input type="date" value={form.approvalDate} onChange={e => { sf('approvalDate')(e); commitField('approvalDate', e.target.value); }} />
          </div>
        )}
      </div>

      <div className="space-y-1">
        <div className="flex items-center gap-2"><Label>Notas</Label><SavedTick show={savedField === 'notes'} /></div>
        <Textarea rows={2} value={form.notes} onChange={sf('notes')} onBlur={() => commitField('notes', form.notes)} />
      </div>

      {/* ── Proyecto ya vinculado: solo informativo, la acción de aprobar
          vive en el header de DealDetailSheet.tsx (visible sin importar la
          pestaña) ── */}
      {!checkingProject && linkedProject && (
        <div className="border rounded-xl p-3 bg-muted/20 border-border flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-primary flex-shrink-0" />
          <p className="text-sm text-foreground">
            Proyecto ya creado: <span className="font-semibold">{linkedProject.projectCode ?? linkedProject.id}</span>
          </p>
        </div>
      )}

      {deal.id && (
        <div className="flex items-center justify-between pt-1">
          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive gap-1" onClick={() => setConfirmDel(true)}>
            <Trash2 className="w-3.5 h-3.5" /> Eliminar
          </Button>
        </div>
      )}

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
