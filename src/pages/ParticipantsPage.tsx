import { useState, useEffect } from 'react';
import { getParticipants, saveParticipant, deleteParticipant, GetParticipantsOutputType } from 'zite-endpoints-sdk';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { ColumnFilterPopover } from '../components/ColumnFilterPopover';
import { AdvancedFilterSheet } from '../components/AdvancedFilterSheet';
import { useTableFilters } from '../hooks/useTableFilters';
import { Plus, Search, Pencil, Trash2, UserSearch, X } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { useDebouncedCallback } from 'use-debounce';

type Participant = GetParticipantsOutputType['participants'][0];

const PARTICIPANT_COLUMNS = [
  { key: 'fullName',  label: 'Nombre',     type: 'text'   as const },
  { key: 'email',     label: 'Email',      type: 'text'   as const },
  { key: 'phone',     label: 'Teléfono',   type: 'text'   as const },
  { key: 'idNumber',  label: 'Documento',  type: 'text'   as const },
  { key: 'city',      label: 'Ciudad',     type: 'text'   as const },
  { key: 'gender',    label: 'Género',     type: 'select' as const },
  { key: 'age',       label: 'Edad',       type: 'number' as const },
  { key: 'totalSessions', label: 'Sesiones', type: 'number' as const },
];

const emptyForm = { fullName: '', email: '', phone: '', idNumber: '', city: '', gender: '', age: undefined as number | undefined, totalSessions: undefined as number | undefined, notes: '' };

export default function ParticipantsPage() {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Participant | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);

  const load = (q?: string) => {
    setLoading(true);
    getParticipants({ search: q }).then(d => { setParticipants(d.participants); setLoading(false); });
  };

  useEffect(() => { load(); }, []);

  const debouncedSearch = useDebouncedCallback((q: string) => load(q), 400);

  const {
    filteredData,
    columnFilters,
    advancedFilters,
    setAdvancedFilters,
    setColFilter,
    clearAllFilters,
    colUniqueValues,
    activeFilterCount,
    filterMode, setFilterMode,
  } = useTableFilters(participants, PARTICIPANT_COLUMNS);

  const openNew = () => { setEditing(null); setForm({ ...emptyForm }); setOpen(true); };
  const openEdit = (p: Participant) => {
    setEditing(p);
    setForm({ fullName: p.fullName ?? '', email: p.email ?? '', phone: p.phone ?? '', idNumber: p.idNumber ?? '', city: p.city ?? '', gender: p.gender ?? '', age: p.age, totalSessions: p.totalSessions, notes: p.notes ?? '' });
    setOpen(true);
  };

  const save = async () => {
    if (!form.fullName) return toast.error('El nombre es obligatorio');
    setSaving(true);
    try {
      await saveParticipant({ ...form, id: editing?.id });
      toast.success(editing ? 'Participante actualizado' : 'Participante creado');
      setOpen(false); load(search);
    } catch { toast.error('Error al guardar'); }
    setSaving(false);
  };

  const del = async () => {
    if (!deleting) return;
    await deleteParticipant({ id: deleting });
    toast.success('Participante eliminado');
    setDeleting(null); load(search);
  };

  const genderLabel: Record<string, string> = { female: 'F', male: 'M', other: 'O', Femenino: 'F', Masculino: 'M', Otro: 'O' };

  const totalActiveFilters = activeFilterCount + (search ? 1 : 0);
  const handleClearAll = () => { clearAllFilters(); setSearch(''); load(); };

  const headers: { key: keyof Participant; label: string; filterable?: boolean }[] = [
    { key: 'fullName',  label: 'Nombre',    filterable: true },
    { key: 'email',     label: 'Email',     filterable: true },
    { key: 'phone',     label: 'Teléfono',  filterable: true },
    { key: 'idNumber',  label: 'Documento', filterable: true },
    { key: 'city',      label: 'Ciudad',    filterable: true },
    { key: 'gender',    label: 'Género',    filterable: true },
    { key: 'age',       label: 'Edad' },
    { key: 'totalSessions', label: 'Sesiones' },
  ];

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <UserSearch className="w-5 h-5" /> Base de Participantes
          </h2>
          <p className="text-sm text-muted-foreground">
            Registro global de participantes — busca para detectar duplicados o historial
          </p>
        </div>
        <Button onClick={openNew} className="gap-2"><Plus className="w-4 h-4" /> Nuevo participante</Button>
      </div>

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Buscar por nombre, email o documento..."
            className="pl-9 w-72 h-9"
            value={search}
            onChange={e => { setSearch(e.target.value); debouncedSearch(e.target.value); }}
          />
        </div>

        <AdvancedFilterSheet
          columns={PARTICIPANT_COLUMNS}
          rules={advancedFilters}
          onRulesChange={setAdvancedFilters}
          filterMode={filterMode}
          onFilterModeChange={setFilterMode}
          colUniqueValues={colUniqueValues}
          columnFilters={columnFilters}
          onClearColumnFilter={key => setColFilter(key, new Set())}
          activeFilterCount={activeFilterCount}
          onClearAll={handleClearAll}
        />

        <div className="flex-1" />
        <span className="text-xs text-muted-foreground">
          {filteredData.length} de {participants.length} participante{participants.length !== 1 ? 's' : ''}
        </span>
      </div>

      {loading ? (
        <div className="space-y-2">{[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : (
        <div className="bg-card rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 sticky top-0 z-10">
              <tr>
                {headers.map(h => (
                  <th key={h.key} className="text-left px-4 py-3 text-xs font-semibold whitespace-nowrap">
                    <div className="flex items-center">
                      {h.label}
                      {h.filterable && (
                        <ColumnFilterPopover
                          allValues={colUniqueValues(h.key)}
                          activeValues={columnFilters[h.key] ?? new Set()}
                          onApply={v => setColFilter(h.key, v)}
                        />
                      )}
                    </div>
                  </th>
                ))}
                <th className="text-left px-4 py-3 text-xs font-semibold"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredData.map(p => (
                <tr key={p.id} className="hover:bg-muted/30">
                  <td className="px-4 py-2.5 font-medium">{p.fullName}</td>
                  <td className="px-4 py-2.5 text-muted-foreground text-xs">{p.email}</td>
                  <td className="px-4 py-2.5 text-muted-foreground text-xs">{p.phone}</td>
                  <td className="px-4 py-2.5 text-muted-foreground text-xs">{p.idNumber}</td>
                  <td className="px-4 py-2.5 text-muted-foreground text-xs">{p.city}</td>
                  <td className="px-4 py-2.5 text-xs">{genderLabel[p.gender ?? ''] ?? p.gender}</td>
                  <td className="px-4 py-2.5 text-xs">{p.age}</td>
                  <td className="px-4 py-2.5">
                    {p.totalSessions != null && p.totalSessions > 0 && (
                      <Badge variant="secondary" className="text-xs">{p.totalSessions} sesiones</Badge>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(p)}><Pencil className="w-3 h-3" /></Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setDeleting(p.id)}><Trash2 className="w-3 h-3" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredData.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">
                    {totalActiveFilters > 0 ? (
                      <div className="space-y-2">
                        <p className="font-medium">Sin resultados con los filtros actuales</p>
                        <Button size="sm" variant="outline" onClick={handleClearAll}>Limpiar filtros</Button>
                      </div>
                    ) : 'No se encontraron participantes.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{editing ? 'Editar participante' : 'Nuevo participante'}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-1"><Label>Nombre completo *</Label><Input value={form.fullName} onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))} /></div>
            <div className="space-y-1"><Label>Email</Label><Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
            <div className="space-y-1"><Label>Teléfono</Label><Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} /></div>
            <div className="space-y-1"><Label>Documento / ID</Label><Input value={form.idNumber} onChange={e => setForm(f => ({ ...f, idNumber: e.target.value }))} /></div>
            <div className="space-y-1"><Label>Ciudad</Label><Input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} /></div>
            <div className="space-y-1"><Label>Género</Label>
              <Select value={form.gender} onValueChange={v => setForm(f => ({ ...f, gender: v }))}>
                <SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Femenino">Femenino</SelectItem>
                  <SelectItem value="Masculino">Masculino</SelectItem>
                  <SelectItem value="Otro">Otro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Edad</Label><Input type="number" value={form.age ?? ''} onChange={e => setForm(f => ({ ...f, age: e.target.value ? Number(e.target.value) : undefined }))} /></div>
            <div className="space-y-1"><Label>Total sesiones</Label><Input type="number" value={form.totalSessions ?? ''} onChange={e => setForm(f => ({ ...f, totalSessions: e.target.value ? Number(e.target.value) : undefined }))} /></div>
            <div className="col-span-2 space-y-1"><Label>Notas</Label><Textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={o => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>¿Eliminar participante?</AlertDialogTitle><AlertDialogDescription>Esta acción no se puede deshacer.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={del} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Eliminar</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
