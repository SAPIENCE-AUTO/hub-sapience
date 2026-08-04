import { useState, useEffect } from 'react';
import { getUsers, updateUser, GetUsersOutputType } from 'zite-endpoints-sdk';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { Users, ShieldCheck, Clock, Eye, Globe } from 'lucide-react';
import { PAGE_SECTIONS_DEF } from '../lib/pageVisibility';
import { COST_CENTERS } from '../lib/constants';

type UserRecord = GetUsersOutputType['users'][0];

const ACCESS_LEVELS = ['Sin acceso', 'Solo ver', 'Editar', 'Administrar'] as const;
const PURCHASE_LEVELS = ['Visor', 'Creador', 'Aprobador', 'Finanzas', 'Socios'];

const ROLES = ['Owner', 'Socio', 'Head', 'Líder', 'Coordinador', 'Analista'];
const DEPARTAMENTOS = ['Finanzas', 'Análisis', 'Reclutamiento', 'Logística'];

const SECTIONS = [
  { key: 'accessComercial' as const, label: 'Comercial' },
  { key: 'accessOperacion' as const, label: 'Operación' },
  { key: 'accessAdmin' as const, label: 'Administración' },
  { key: 'accessFinanzas' as const, label: 'Finanzas' },
  { key: 'accessOtros' as const, label: 'Otros' },
];

const levelColors: Record<string, string> = {
  'Sin acceso': 'bg-muted text-muted-foreground',
  'Solo ver':   'bg-yellow-100 text-yellow-800',
  'Editar':     'bg-blue-100 text-blue-800',
  'Administrar':'bg-green-100 text-green-800',
};

function AccessBadge({ level }: { level?: string }) {
  const l = level || 'Sin acceso';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${levelColors[l] ?? 'bg-muted text-muted-foreground'}`}>
      {l}
    </span>
  );
}

function UserInitials({ user }: { user: UserRecord }) {
  const initials = ((user.firstName?.[0] ?? '') + (user.lastName?.[0] ?? '')).toUpperCase() || user.email[0].toUpperCase();
  return (
    <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-[11px] font-bold text-primary-foreground flex-shrink-0">
      {initials}
    </div>
  );
}

// ── Page Visibility Checkboxes ────────────────────────────────────────────────
function PageVisibilitySelector({
  useGlobal, selected, onToggleGlobal, onTogglePage, onSelectAll, onClearAll,
}: {
  useGlobal: boolean; selected: string[];
  onToggleGlobal: (v: boolean) => void; onTogglePage: (key: string) => void;
  onSelectAll: () => void; onClearAll: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
          <Eye className="w-3 h-3" /> Páginas visibles
        </Label>
        <div className="flex items-center gap-2">
          <Globe className="w-3 h-3 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Usar defaults</span>
          <Switch checked={useGlobal} onCheckedChange={onToggleGlobal} className="scale-75" />
        </div>
      </div>
      {useGlobal ? (
        <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 flex items-center gap-2">
          <Globe className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          <span className="text-xs text-muted-foreground">
            Este usuario verá las páginas configuradas globalmente en Configuración → Visibilidad.
          </span>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex gap-2">
            <button onClick={onSelectAll} className="text-[10px] text-primary hover:underline">Seleccionar todo</button>
            <span className="text-[10px] text-muted-foreground">·</span>
            <button onClick={onClearAll} className="text-[10px] text-muted-foreground hover:underline">Limpiar</button>
          </div>
          <div className="space-y-2.5">
            {PAGE_SECTIONS_DEF.map(section => (
              <div key={section.id}>
                <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-0.5">
                  {section.label}
                </div>
                <div className="grid grid-cols-1 gap-1">
                  {section.pages.map(page => (
                    <div key={page.key} className="flex items-center gap-2 px-1">
                      <Checkbox
                        id={`page-${page.key}`}
                        checked={selected.includes(page.key)}
                        onCheckedChange={() => onTogglePage(page.key)}
                      />
                      <label htmlFor={`page-${page.key}`} className="text-sm cursor-pointer">{page.label}</label>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="pt-1">
            <span className="text-[10px] text-muted-foreground">
              {selected.length} de {PAGE_SECTIONS_DEF.flatMap(s => s.pages).length} páginas seleccionadas
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

const DASHBOARD_WIDGETS = ['Mis proyectos', 'Mis tareas', 'Próximos eventos', 'Órdenes de compra', 'Menciones recientes', 'Facturas recibidas'] as const;

// ── Dashboard Widgets Selector ────────────────────────────────────────────────
function DashboardWidgetsSelector({
  useAll, selected, onToggleAll, onToggleWidget, onSelectAll, onClearAll,
}: {
  useAll: boolean; selected: string[];
  onToggleAll: (v: boolean) => void; onToggleWidget: (w: string) => void;
  onSelectAll: () => void; onClearAll: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
          <Globe className="w-3 h-3" /> Widgets del Dashboard
        </Label>
        <div className="flex items-center gap-2">
          <Globe className="w-3 h-3 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Mostrar todos</span>
          <Switch checked={useAll} onCheckedChange={onToggleAll} className="scale-75" />
        </div>
      </div>
      {useAll ? (
        <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 flex items-center gap-2">
          <Globe className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          <span className="text-xs text-muted-foreground">
            Este usuario verá todos los widgets del dashboard.
          </span>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex gap-2">
            <button onClick={onSelectAll} className="text-[10px] text-primary hover:underline">Seleccionar todo</button>
            <span className="text-[10px] text-muted-foreground">·</span>
            <button onClick={onClearAll} className="text-[10px] text-muted-foreground hover:underline">Limpiar</button>
          </div>
          <div className="space-y-2">
            {DASHBOARD_WIDGETS.map(w => (
              <div key={w} className="flex items-center gap-2 px-1">
                <Checkbox
                  id={`dw-${w}`}
                  checked={selected.includes(w)}
                  onCheckedChange={() => onToggleWidget(w)}
                />
                <label htmlFor={`dw-${w}`} className="text-sm cursor-pointer">{w}</label>
              </div>
            ))}
          </div>
          <div className="pt-1">
            <span className="text-[10px] text-muted-foreground">
              {selected.length} de {DASHBOARD_WIDGETS.length} widgets seleccionados
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Edit Dialog ───────────────────────────────────────────────────────────────
function EditUserDialog({ user, open, onClose, onSaved }: {
  user: UserRecord | null; open: boolean; onClose: () => void; onSaved: (updated: UserRecord) => void;
}) {
  const allPageKeys = PAGE_SECTIONS_DEF.flatMap(s => s.pages.map(p => p.key));

  const [role, setRole] = useState('');
  const [departamento, setDepartamento] = useState('');
  const [form, setForm] = useState({
    accessComercial: '', accessOperacion: '', accessAdmin: '',
    accessFinanzas: '', accessOtros: '', purchaseLevel: '', costCenters: [] as string[],
  });
  const [useGlobalPages, setUseGlobalPages] = useState(true);
  const [visiblePages, setVisiblePages] = useState<string[]>([]);
  const [useAllWidgets, setUseAllWidgets] = useState(true);
  const [dashboardWidgets, setDashboardWidgets] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user) {
      setRole(user.role ?? '');
      setDepartamento((user as UserRecord & { departamento?: string }).departamento ?? '');
      setForm({
        accessComercial: user.accessComercial || 'Sin acceso',
        accessOperacion: user.accessOperacion || 'Sin acceso',
        accessAdmin: user.accessAdmin || 'Sin acceso',
        accessFinanzas: user.accessFinanzas || 'Sin acceso',
        accessOtros: user.accessOtros || 'Sin acceso',
        purchaseLevel: user.purchaseLevel || '',
        costCenters: user.costCenters ?? [],
      });
      const userPages = user.visiblePages ?? [];
      setUseGlobalPages(userPages.length === 0);
      setVisiblePages(userPages.length > 0 ? userPages : []);
      const widgets = (user as UserRecord & { dashboardWidgets?: string[] }).dashboardWidgets ?? [];
      setUseAllWidgets(widgets.length === 0);
      setDashboardWidgets(widgets.length > 0 ? widgets : []);
    }
  }, [user]);

  const toggleCC = (cc: string) => {
    setForm(f => ({
      ...f,
      costCenters: f.costCenters.includes(cc) ? f.costCenters.filter(c => c !== cc) : [...f.costCenters, cc],
    }));
  };

  const togglePage = (key: string) => {
    setVisiblePages(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  };

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const pagesToSave = useGlobalPages ? [] : visiblePages;
      const widgetsToSave = useAllWidgets ? [] : dashboardWidgets;
      await updateUser({ id: user.id, role, departamento, ...form, visiblePages: pagesToSave, dashboardWidgets: widgetsToSave });
      toast.success('Permisos actualizados');
      onSaved({ ...user, role, departamento, ...form, visiblePages: pagesToSave, dashboardWidgets: widgetsToSave });
      onClose();
    } catch { toast.error('Error al guardar'); }
    setSaving(false);
  };

  if (!user) return null;
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 py-4 border-b flex-shrink-0">
          <DialogTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-primary" />
            Editar permisos
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1">
          <div className="px-6 py-5 space-y-6">
            {/* User info */}
            <div className="flex items-center gap-3 p-3 bg-muted/40 rounded-lg">
              <UserInitials user={user} />
              <div className="flex-1">
                <div className="font-semibold text-sm">{fullName}</div>
                <div className="text-xs text-muted-foreground">{user.email}</div>
              </div>
            </div>

            {/* Title & Departamento */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Título</Label>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Sin título" /></SelectTrigger>
                  <SelectContent>
                    {ROLES.map(r => <SelectItem key={r} value={r} className="text-xs">{r}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Departamento</Label>
                <Select value={departamento} onValueChange={setDepartamento}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Sin departamento" /></SelectTrigger>
                  <SelectContent>
                    {DEPARTAMENTOS.map(d => <SelectItem key={d} value={d} className="text-xs">{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Section access */}
            <div className="space-y-3">
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Acceso por área</Label>
              <div className="space-y-2.5">
                {SECTIONS.map(s => (
                  <div key={s.key} className="flex items-center justify-between">
                    <span className="text-sm font-medium">{s.label}</span>
                    <Select value={form[s.key]} onValueChange={v => setForm(f => ({ ...f, [s.key]: v }))}>
                      <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ACCESS_LEVELS.map(l => (
                          <SelectItem key={l} value={l} className="text-xs">{l}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t" />

            {/* Purchase permissions */}
            <div className="space-y-3">
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Permisos de compras</Label>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Nivel de compras</span>
                <Select value={form.purchaseLevel} onValueChange={v => setForm(f => ({ ...f, purchaseLevel: v }))}>
                  <SelectTrigger className="h-8 w-40 text-xs"><SelectValue placeholder="Sin nivel" /></SelectTrigger>
                  <SelectContent>
                    {PURCHASE_LEVELS.map(l => <SelectItem key={l} value={l} className="text-xs">{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 pt-1">
                <Label className="text-xs text-muted-foreground">Centros de costo asignados</Label>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  {COST_CENTERS.map(cc => (
                    <div key={cc} className="flex items-center gap-2">
                      <Checkbox
                        id={`cc-${cc}`}
                        checked={form.costCenters.includes(cc)}
                        onCheckedChange={() => toggleCC(cc)}
                      />
                      <label htmlFor={`cc-${cc}`} className="text-sm cursor-pointer">{cc}</label>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="border-t" />

            {/* Page visibility */}
            <PageVisibilitySelector
              useGlobal={useGlobalPages}
              selected={visiblePages}
              onToggleGlobal={v => {
                setUseGlobalPages(v);
                if (!v && visiblePages.length === 0) setVisiblePages(allPageKeys);
              }}
              onTogglePage={togglePage}
              onSelectAll={() => setVisiblePages(allPageKeys)}
              onClearAll={() => setVisiblePages([])}
            />

            <div className="border-t" />

            {/* Dashboard widgets */}
            <DashboardWidgetsSelector
              useAll={useAllWidgets}
              selected={dashboardWidgets}
              onToggleAll={v => {
                setUseAllWidgets(v);
                if (!v && dashboardWidgets.length === 0) setDashboardWidgets([...DASHBOARD_WIDGETS]);
              }}
              onToggleWidget={w => setDashboardWidgets(prev => prev.includes(w) ? prev.filter(x => x !== w) : [...prev, w])}
              onSelectAll={() => setDashboardWidgets([...DASHBOARD_WIDGETS])}
              onClearAll={() => setDashboardWidgets([])}
            />
          </div>
        </ScrollArea>

        <div className="px-6 py-4 border-t flex justify-end gap-2 flex-shrink-0">
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Guardando...' : 'Guardar permisos'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function UserAdminPage() {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [editUser, setEditUser] = useState<UserRecord | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const d = await getUsers({});
      setUsers(d.users);
    } catch { toast.error('Sin permisos para ver esta página'); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleSaved = (updated: UserRecord) => {
    setUsers(prev => prev.map(u => u.id === updated.id ? updated : u));
  };

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <Users className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-bold">Administración de usuarios</h1>
            <p className="text-xs text-muted-foreground">
              {loading ? 'Cargando...' : `${users.length} usuario${users.length !== 1 ? 's' : ''}`}
            </p>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs text-muted-foreground font-medium">Niveles:</span>
        {ACCESS_LEVELS.map(l => <AccessBadge key={l} level={l} />)}
      </div>

      {/* Table */}
      <div className="border border-border rounded-xl overflow-hidden bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 border-b border-border">
                <th className="text-left px-4 py-3 font-semibold text-xs text-muted-foreground uppercase tracking-wide">Usuario</th>
                {SECTIONS.map(s => (
                  <th key={s.key} className="text-center px-3 py-3 font-semibold text-xs text-muted-foreground uppercase tracking-wide whitespace-nowrap">{s.label}</th>
                ))}
                <th className="text-center px-3 py-3 font-semibold text-xs text-muted-foreground uppercase tracking-wide">Compras</th>
                <th className="text-center px-3 py-3 font-semibold text-xs text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                  <span className="flex items-center gap-1 justify-center"><Eye className="w-3 h-3" /> Páginas</span>
                </th>
                <th className="text-left px-3 py-3 font-semibold text-xs text-muted-foreground uppercase tracking-wide">Último acceso</th>
                <th className="w-12" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 10 }).map((_, j) => (
                      <td key={j} className="px-4 py-3"><Skeleton className="h-5 w-full" /></td>
                    ))}
                  </tr>
                ))
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-muted-foreground text-sm">
                    No hay usuarios registrados
                  </td>
                </tr>
              ) : (
                users.map(user => {
                  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ') || '—';
                  const hasCustomPages = (user.visiblePages ?? []).length > 0;
                  return (
                    <tr
                      key={user.id}
                      className="hover:bg-muted/30 transition-colors cursor-pointer"
                      onClick={() => setEditUser(user)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <UserInitials user={user} />
                          <div className="min-w-0">
                            <div className="font-medium text-sm truncate">{fullName}</div>
                            <div className="text-xs text-muted-foreground truncate">{user.email}</div>
                            {user.role && (
                              <div className="text-[10px] text-muted-foreground">{user.role}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      {SECTIONS.map(s => (
                        <td key={s.key} className="px-3 py-3 text-center">
                          <AccessBadge level={user[s.key]} />
                        </td>
                      ))}
                      <td className="px-3 py-3 text-center">
                        {user.purchaseLevel ? (
                          <Badge variant="outline" className="text-xs font-medium">{user.purchaseLevel}</Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-center">
                        {hasCustomPages ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-semibold">
                            <Eye className="w-2.5 h-2.5" />
                            {(user.visiblePages ?? []).length} págs.
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                            <Globe className="w-2.5 h-2.5" /> Global
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {user.lastActiveAt ? (
                          <div className="flex items-center gap-1 text-xs text-muted-foreground whitespace-nowrap">
                            <Clock className="w-3 h-3" />
                            {new Date(user.lastActiveAt).toLocaleDateString('es-MX')}
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={e => { e.stopPropagation(); setEditUser(user); }}
                        >
                          Editar
                        </Button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <EditUserDialog
        user={editUser}
        open={!!editUser}
        onClose={() => setEditUser(null)}
        onSaved={handleSaved}
      />
    </div>
  );
}
