import { useState, useEffect, useMemo } from 'react';
import { getMisPendientes, saveMisPendiente, deleteMisPendiente } from 'zite-endpoints-sdk';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import ComboboxCreatable from '@/components/ComboboxCreatable';
import { Plus, Trash2, Mail, PenLine, ListTodo, CalendarClock, ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';

interface Pendiente {
  id: string;
  titulo: string;
  notas: string | null;
  area: string;
  status: string;
  fuente: string;
  correoAsunto: string | null;
  correoRemitente: string | null;
  fechaLimite: string | null;
  createdAt: string;
}

const DEFAULT_AREAS = ['Comercial', 'Admin', 'Proyectos', 'Postventa', 'Cobranza'];

export default function MisPendientesPage() {
  const [items, setItems] = useState<Pendiente[]>([]);
  const [loading, setLoading] = useState(true);
  const [showResolved, setShowResolved] = useState(false);

  // Quick-add
  const [newTitulo, setNewTitulo] = useState('');
  const [newArea, setNewArea] = useState('');
  const [adding, setAdding] = useState(false);

  const load = () => {
    getMisPendientes({}).then(res => setItems(res.items)).catch(() => toast.error('Error al cargar tus pendientes')).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const knownAreas = useMemo(() => {
    const fromItems = items.map(i => i.area).filter(a => a && a !== 'Sin clasificar');
    return [...new Set([...DEFAULT_AREAS, ...fromItems])];
  }, [items]);

  const handleAdd = async () => {
    if (!newTitulo.trim()) return;
    setAdding(true);
    try {
      const res = await saveMisPendiente({ titulo: newTitulo.trim(), area: newArea || undefined });
      setItems(prev => [{
        id: res.id, titulo: newTitulo.trim(), notas: null, area: newArea || 'Sin clasificar',
        status: 'Pendiente', fuente: 'manual', correoAsunto: null, correoRemitente: null,
        fechaLimite: null, createdAt: new Date().toISOString(),
      }, ...prev]);
      setNewTitulo('');
      setNewArea('');
    } catch {
      toast.error('Error al guardar el pendiente');
    } finally {
      setAdding(false);
    }
  };

  const toggleStatus = async (item: Pendiente) => {
    const nextStatus = item.status === 'Resuelto' ? 'Pendiente' : 'Resuelto';
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: nextStatus } : i));
    try {
      await saveMisPendiente({ id: item.id, status: nextStatus });
    } catch {
      toast.error('Error al actualizar');
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: item.status } : i));
    }
  };

  const updateArea = async (item: Pendiente, area: string) => {
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, area } : i));
    try { await saveMisPendiente({ id: item.id, area }); } catch { toast.error('Error al actualizar el área'); }
  };

  const updateNotas = async (item: Pendiente, notas: string) => {
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, notas } : i));
    try { await saveMisPendiente({ id: item.id, notas }); } catch { toast.error('Error al guardar la nota'); }
  };

  const handleDelete = async (id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
    try { await deleteMisPendiente({ id }); } catch { toast.error('Error al borrar'); load(); }
  };

  const active = items.filter(i => i.status !== 'Resuelto');
  const resolved = items.filter(i => i.status === 'Resuelto');

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><ListTodo className="w-6 h-6 text-primary" /> Mis Pendientes</h1>
        <p className="text-sm text-muted-foreground mt-1">Tu parking lot personal — lo que anotas tú, y (pronto) lo que marques en tu correo.</p>
      </div>

      {/* Quick add */}
      <div className="flex items-center gap-2 border border-border rounded-xl p-2 bg-card">
        <Input
          value={newTitulo}
          onChange={e => setNewTitulo(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
          placeholder="Agregar un pendiente..."
          className="border-0 shadow-none focus-visible:ring-0 h-9"
        />
        <div className="w-40 flex-shrink-0">
          <ComboboxCreatable value={newArea} onChange={setNewArea} options={knownAreas} placeholder="Área..." className="h-9" />
        </div>
        <Button size="sm" onClick={handleAdd} disabled={adding || !newTitulo.trim()} className="gap-1.5 flex-shrink-0">
          <Plus className="w-4 h-4" /> Agregar
        </Button>
      </div>

      {loading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}</div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <ListTodo className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">Sin pendientes por ahora.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {active.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">Todo resuelto — buen trabajo.</p>
          )}
          {active.map(item => (
            <PendienteRow key={item.id} item={item} areas={knownAreas} onToggle={() => toggleStatus(item)} onArea={a => updateArea(item, a)} onNotas={n => updateNotas(item, n)} onDelete={() => handleDelete(item.id)} />
          ))}

          {resolved.length > 0 && (
            <div className="pt-3">
              <button onClick={() => setShowResolved(v => !v)} className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
                {showResolved ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                Resueltos ({resolved.length})
              </button>
              {showResolved && (
                <div className="space-y-2 mt-2">
                  {resolved.map(item => (
                    <PendienteRow key={item.id} item={item} areas={knownAreas} onToggle={() => toggleStatus(item)} onArea={a => updateArea(item, a)} onNotas={n => updateNotas(item, n)} onDelete={() => handleDelete(item.id)} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PendienteRow({ item, areas, onToggle, onArea, onNotas, onDelete }: {
  item: Pendiente; areas: string[];
  onToggle: () => void; onArea: (a: string) => void; onNotas: (n: string) => void; onDelete: () => void;
}) {
  const [notasDraft, setNotasDraft] = useState(item.notas ?? '');
  const done = item.status === 'Resuelto';

  return (
    <div className={`flex items-start gap-3 border border-border rounded-lg px-3 py-2.5 bg-card transition-opacity ${done ? 'opacity-60' : ''}`}>
      <Checkbox checked={done} onCheckedChange={onToggle} className="mt-0.5 flex-shrink-0" />

      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-sm ${done ? 'line-through text-muted-foreground' : 'text-foreground'}`}>{item.titulo}</span>
          {item.fuente === 'correo' && (
            <span title={item.correoRemitente ?? undefined} className="inline-flex items-center gap-1 text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full flex-shrink-0">
              <Mail className="w-2.5 h-2.5" /> correo
            </span>
          )}
        </div>
        {item.correoAsunto && (
          <p className="text-xs text-muted-foreground truncate">📧 {item.correoAsunto}</p>
        )}
        <div className="flex items-center gap-2">
          <div className="w-32">
            <ComboboxCreatable value={item.area} onChange={onArea} options={areas} placeholder="Área..." className="h-6 text-xs px-2" />
          </div>
          {item.fechaLimite && (
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              <CalendarClock className="w-3 h-3" /> {item.fechaLimite}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-0.5 flex-shrink-0">
        <Popover onOpenChange={o => { if (!o && notasDraft !== (item.notas ?? '')) onNotas(notasDraft); }}>
          <PopoverTrigger asChild>
            <button className={`p-1.5 rounded hover:bg-muted transition-colors ${item.notas ? 'text-primary' : 'text-muted-foreground/50'}`} title="Notas">
              <PenLine className="w-3.5 h-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-2" align="end">
            <Textarea value={notasDraft} onChange={e => setNotasDraft(e.target.value)} placeholder="Notas..." rows={3} className="text-xs" />
          </PopoverContent>
        </Popover>
        <button onClick={onDelete} className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground/50 hover:text-destructive transition-colors" title="Eliminar">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
