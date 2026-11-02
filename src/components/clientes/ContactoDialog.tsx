import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Users } from 'lucide-react';
import { saveClientContact } from 'zite-endpoints-sdk';
import { toast } from 'sonner';
import { ROLES_CONTACTO } from '@/lib/clientes/catalogos';
import { correoValido } from '@/lib/clientes/validacion';
import type { Contacto, Entidad } from './tipos';

const NINGUNA = '__ninguna__';
const etiqueta = 'text-[11px] text-muted-foreground uppercase tracking-wide font-medium';

interface Props {
  clientId: string;
  entidades: Entidad[];
  contacto?: Contacto;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export default function ContactoDialog({ clientId, entidades, contacto, open, onClose, onSaved }: Props) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('');
  const [entityId, setEntityId] = useState('');
  const [notes, setNotes] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(contacto?.name ?? '');
    setEmail(contacto?.email ?? '');
    setPhone(contacto?.phone ?? '');
    setRole(contacto?.role ?? '');
    setEntityId(contacto?.entityId ?? '');
    setNotes(contacto?.notes ?? '');
  }, [open, contacto]);

  const correoMal = email.trim() !== '' && !correoValido(email.trim());
  const puedeGuardar = name.trim() !== '' && !correoMal;

  const guardar = async () => {
    if (!puedeGuardar) return;
    setGuardando(true);
    try {
      await saveClientContact({ id: contacto?.id, clientId, entityId: entityId || null, name, email, phone, role, notes });
      toast.success(contacto ? 'Contacto actualizado' : 'Contacto agregado');
      onSaved();
      onClose();
    } catch (err: unknown) {
      toast.error((err as Error).message ?? 'No se pudo guardar el contacto');
    }
    setGuardando(false);
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Users className="w-4 h-4 text-primary" />{contacto ? 'Editar contacto' : 'Agregar contacto de cobranza'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <label className={etiqueta}>Nombre</label>
            <Input className="h-9" value={name} onChange={e => setName(e.target.value)} autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className={etiqueta}>Correo</label>
              <Input className="h-9" value={email} onChange={e => setEmail(e.target.value)} />
              {correoMal && <p className="text-[11px] text-destructive">El correo no parece válido</p>}
            </div>
            <div className="space-y-1.5">
              <label className={etiqueta}>Teléfono</label>
              <Input className="h-9" value={phone} onChange={e => setPhone(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className={etiqueta}>Qué hace</label>
              <Select value={role || NINGUNA} onValueChange={v => setRole(v === NINGUNA ? '' : v)}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NINGUNA}>Sin definir</SelectItem>
                  {ROLES_CONTACTO.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className={etiqueta}>Razón social</label>
              <Select value={entityId || NINGUNA} onValueChange={v => setEntityId(v === NINGUNA ? '' : v)}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NINGUNA}>Todas</SelectItem>
                  {entidades.map(e => <SelectItem key={e.id} value={e.id}>{e.legalName || 'Sin nombre'}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className={etiqueta}>Notas</label>
            <Textarea rows={2} className="text-sm resize-none" value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={guardando}>Cancelar</Button>
          <Button onClick={guardar} disabled={!puedeGuardar || guardando} className="gap-1.5">
            {guardando && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {guardando ? 'Guardando...' : 'Guardar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
