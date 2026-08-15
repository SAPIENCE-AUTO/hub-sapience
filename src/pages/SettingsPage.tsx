import { useState, useEffect } from 'react';
import { useAuth } from 'zite-auth-sdk';
import {
  getUsers, updateUser, inviteUsers, deleteUser, getApprovalLimits, saveApprovalLimit, getAppSettings, saveAppSettings,
  getRubroAssignments, saveRubroAssignment, exportConfigBackup, cleanupPJT001,
  GetUsersOutputType, GetApprovalLimitsOutputType, CleanupPJT001OutputType,
} from 'zite-endpoints-sdk';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Progress } from '@/components/ui/progress';
import {
  Settings, Users, Shield, Plus, Check, Loader2, AlertTriangle,
  Eye, Globe, ShieldCheck, ChevronRight, Trash2, Database, Download, FileJson, ArrowRight,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PAGE_SECTIONS_DEF } from '../lib/pageVisibility';
import { COST_CENTERS } from '../lib/constants';
import { fmtCurrency } from '../lib/format';
import NavPreviewDialog from '../components/NavPreviewDialog';

type UserRecord = GetUsersOutputType['users'][0];
type LimitRecord = GetApprovalLimitsOutputType['limits'][0];

const ROLES = ['Owner', 'Socio', 'Head', 'Líder', 'Coordinador', 'Analista'];

const RUBROS_COTIZACION = [
  'Reclutamiento e incentivos',
  'Moderación',
  'Management',
  'Logística y operación',
  'Back office',
] as const;
const DEPARTAMENTOS = ['Finanzas', 'Análisis', 'Reclutamiento', 'Logística'];
const PURCHASE_LEVELS = ['Visor', 'Creador', 'Aprobador', 'Finanzas', 'Socios'];

const APPROVAL_LEVELS = ['Aprobador', 'Finanzas'];
const ACCESS_LEVELS = ['Sin acceso', 'Solo ver', 'Editar', 'Administrar'] as const;
const AREA_SECTIONS = [
  { key: 'accessComercial' as const, label: 'Comercial' },
  { key: 'accessOperacion' as const, label: 'Operación' },
  { key: 'accessAdmin' as const, label: 'Administración' },
  { key: 'accessFinanzas' as const, label: 'Finanzas' },
  { key: 'accessOtros' as const, label: 'Otros' },
];

const ALL_PAGE_KEYS = PAGE_SECTIONS_DEF.flatMap(s => s.pages.map(p => p.key));



function UserAvatar({ user }: { user: UserRecord }) {
  const initials = ((user.firstName?.[0] ?? '') + (user.lastName?.[0] ?? '')).toUpperCase() || user.email[0].toUpperCase();
  return (
    <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center text-[12px] font-bold text-primary-foreground flex-shrink-0">
      {initials}
    </div>
  );
}

const purchaseLevelColor: Record<string, string> = {
  Socios:    'bg-purple-100 text-purple-700 border-purple-200',
  Finanzas:  'bg-blue-100 text-blue-700 border-blue-200',
  Aprobador: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  Creador:   'bg-sky-100 text-sky-700 border-sky-200',
  Visor:     'bg-muted text-muted-foreground border-border',
};

// ── Full User Edit Sheet ──────────────────────────────────────────────────────
function UserEditSheet({
  user, open, onClose, onSaved, onDeleted,
}: {
  user: UserRecord | null;
  open: boolean;
  onClose: () => void;
  onSaved: (updated: UserRecord) => void;
  onDeleted: (id: string) => void;
}) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [role, setRole] = useState('');
  const [departamento, setDepartamento] = useState('');
  const [accessComercial, setAccessComercial] = useState('Sin acceso');
  const [accessOperacion, setAccessOperacion] = useState('Sin acceso');
  const [accessAdmin, setAccessAdmin] = useState('Sin acceso');
  const [accessFinanzas, setAccessFinanzas] = useState('Sin acceso');
  const [accessOtros, setAccessOtros] = useState('Sin acceso');
  const [purchaseLevel, setPurchaseLevel] = useState('');
  const [maxApprovalAmount, setMaxApprovalAmount] = useState('');
  const [costCenters, setCostCenters] = useState<string[]>([]);
  const [useGlobalPages, setUseGlobalPages] = useState(true);
  const [visiblePages, setVisiblePages] = useState<string[]>([]);
  const [useAllWidgets, setUseAllWidgets] = useState(true);
  const [dashboardWidgets, setDashboardWidgets] = useState<string[]>([]);
  const [hiddenFromChat, setHiddenFromChat] = useState(false);
  const [cotizacionRubros, setCotizacionRubros] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!user) return;
    setFirstName(user.firstName ?? '');
    setLastName(user.lastName ?? '');
    setRole(user.role ?? '');
    setDepartamento((user as UserRecord & { departamento?: string }).departamento ?? '');
    setAccessComercial(user.accessComercial ?? 'Sin acceso');
    setAccessOperacion(user.accessOperacion ?? 'Sin acceso');
    setAccessAdmin(user.accessAdmin ?? 'Sin acceso');
    setAccessFinanzas(user.accessFinanzas ?? 'Sin acceso');
    setAccessOtros(user.accessOtros ?? 'Sin acceso');
    setPurchaseLevel(user.purchaseLevel ?? '');
    setMaxApprovalAmount(user.maxApprovalAmount != null ? String(user.maxApprovalAmount) : '');
    setCostCenters(user.costCenters ?? []);
    const pages = user.visiblePages ?? [];
    setUseGlobalPages(pages.length === 0);
    setVisiblePages(pages);
    const widgets = (user as UserRecord & { dashboardWidgets?: string[] }).dashboardWidgets ?? [];
    setUseAllWidgets(widgets.length === 0);
    setDashboardWidgets(widgets.length > 0 ? widgets : []);
    setHiddenFromChat(user.hiddenFromChat ?? false);
    setCotizacionRubros((user as any).cotizacionRubros ?? []);
  }, [user]);

  const toggleCC = (cc: string) =>
    setCostCenters(prev => prev.includes(cc) ? prev.filter(c => c !== cc) : [...prev, cc]);

  const togglePage = (key: string) =>
    setVisiblePages(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);

  const handleSave = async () => {
    if (!user) return;
    const missing: string[] = [];
    if (!role) missing.push('Rol');
    if (!departamento) missing.push('Departamento');
    if (missing.length > 0) {
      toast.error(`Falta ${missing.length > 1 ? 'seleccionar' : 'seleccionar el campo'}: ${missing.join(', ')}`);
      return;
    }
    setSaving(true);
    try {
      const parsedMax = maxApprovalAmount.trim() !== '' && !isNaN(parseFloat(maxApprovalAmount))
        ? parseFloat(maxApprovalAmount) : undefined;
      const pagesToSave = useGlobalPages ? [] : visiblePages;
      const widgetsToSave = useAllWidgets ? [] : dashboardWidgets;
      await updateUser({
        id: user.id,
        firstName: firstName.trim() || undefined,
        lastName: lastName.trim() || undefined,
        role, departamento, accessComercial, accessOperacion, accessAdmin, accessFinanzas, accessOtros,
        purchaseLevel, costCenters, maxApprovalAmount: parsedMax, visiblePages: pagesToSave,
        dashboardWidgets: widgetsToSave,
        hiddenFromChat,
        cotizacionRubros,
      });
      toast.success('Usuario actualizado');
      onSaved({
        ...user,
        firstName: firstName.trim() || undefined,
        lastName: lastName.trim() || undefined,
        role, departamento, accessComercial, accessOperacion, accessAdmin, accessFinanzas, accessOtros,
        purchaseLevel, costCenters, maxApprovalAmount: parsedMax, visiblePages: pagesToSave,
        dashboardWidgets: widgetsToSave,
        hiddenFromChat,
        cotizacionRubros,
      } as any);
      onClose();
    } catch { toast.error('Error al guardar'); }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!user) return;
    setDeleting(true);
    try {
      await deleteUser({ id: user.id });
      toast.success('Usuario eliminado');
      onDeleted(user.id);
      onClose();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error al eliminar usuario');
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
    }
  };

  if (!user) return null;
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email;

  return (
    <>
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 py-4 border-b flex-shrink-0">
          <DialogTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-primary" />
            Configuración de usuario
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="px-6 py-5 space-y-7">

            {/* ── 1. Datos del usuario ─────────────────────── */}
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/40 border border-border">
                <UserAvatar user={{ ...user, firstName, lastName }} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-foreground truncate">
                    {[firstName, lastName].filter(Boolean).join(' ') || <span className="text-muted-foreground">Sin nombre</span>}
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate">{user.email}</div>
                </div>
                <div className="flex flex-col gap-1.5 flex-shrink-0">
                  <Select value={role} onValueChange={setRole}>
                    <SelectTrigger className="h-8 w-36 text-xs">
                      <SelectValue placeholder="Sin título" />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLES.map(r => <SelectItem key={r} value={r} className="text-xs">{r}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={departamento} onValueChange={setDepartamento}>
                    <SelectTrigger className="h-8 w-36 text-xs">
                      <SelectValue placeholder="Departamento" />
                    </SelectTrigger>
                    <SelectContent>
                      {DEPARTAMENTOS.map(d => <SelectItem key={d} value={d} className="text-xs">{d}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Nombre</Label>
                  <Input
                    className="h-8 text-sm"
                    placeholder="Juan"
                    value={firstName}
                    onChange={e => setFirstName(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Apellido</Label>
                  <Input
                    className="h-8 text-sm"
                    placeholder="García"
                    value={lastName}
                    onChange={e => setLastName(e.target.value)}
                  />
                </div>
              </div>
            </div>

            {/* ── 2. Acceso por área ───────────────────────── */}
            <div className="space-y-3">
              <SectionTitle icon={<Shield className="w-3.5 h-3.5" />} label="Acceso por área" />
              <div className="space-y-2">
                {[
                  { key: 'accessComercial', label: 'Comercial', value: accessComercial, set: setAccessComercial },
                  { key: 'accessOperacion', label: 'Operación', value: accessOperacion, set: setAccessOperacion },
                  { key: 'accessAdmin',     label: 'Administración', value: accessAdmin, set: setAccessAdmin },
                  { key: 'accessFinanzas',  label: 'Finanzas',  value: accessFinanzas, set: setAccessFinanzas },
                  { key: 'accessOtros',     label: 'Otros',     value: accessOtros,    set: setAccessOtros },
                ].map(s => (
                  <div key={s.key} className="flex items-center justify-between py-1">
                    <span className="text-sm font-medium text-foreground/80">{s.label}</span>
                    <Select value={s.value} onValueChange={s.set}>
                      <SelectTrigger className="h-8 w-40 text-xs">
                        <SelectValue />
                      </SelectTrigger>
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

            <div className="border-t border-border" />

            {/* ── 3. Permisos de compras ───────────────────── */}
            <div className="space-y-4">
              <SectionTitle icon={<ShieldCheck className="w-3.5 h-3.5" />} label="Permisos de compras" />

              {/* Nivel */}
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground/80">Nivel de compras</span>
                <Select value={purchaseLevel} onValueChange={setPurchaseLevel}>
                  <SelectTrigger className="h-8 w-40 text-xs">
                    <SelectValue placeholder="Sin nivel" />
                  </SelectTrigger>
                  <SelectContent>
                    {PURCHASE_LEVELS.map(l => (
                      <SelectItem key={l} value={l} className="text-xs">{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Monto máximo */}
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground/80">Monto máximo personal</span>
                <div className="relative w-40">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">$</span>
                  <Input
                    type="number" min={0}
                    className="h-8 text-xs pl-6 w-40"
                    placeholder="Sin límite"
                    value={maxApprovalAmount}
                    onChange={e => setMaxApprovalAmount(e.target.value)}
                  />
                </div>
              </div>

              {/* Centros de costo */}
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Centros de costo asignados</Label>
                <div className="grid grid-cols-2 gap-2">
                  {COST_CENTERS.map(cc => (
                    <div key={cc} className="flex items-center gap-2">
                      <Checkbox
                        id={`cc-${cc}`}
                        checked={costCenters.includes(cc)}
                        onCheckedChange={() => toggleCC(cc)}
                      />
                      <label htmlFor={`cc-${cc}`} className="text-xs cursor-pointer leading-tight">{cc}</label>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="border-t border-border" />

            {/* ── 4. Páginas visibles ──────────────────────── */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <SectionTitle icon={<Eye className="w-3.5 h-3.5" />} label="Páginas visibles" />
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Usar configuración global</span>
                  <Switch
                    checked={useGlobalPages}
                    onCheckedChange={v => {
                      setUseGlobalPages(v);
                      if (!v && visiblePages.length === 0) setVisiblePages(ALL_PAGE_KEYS);
                    }}
                  />
                </div>
              </div>

              {useGlobalPages ? (
                <div className="flex items-center gap-2.5 px-3 py-3 rounded-lg border border-border bg-muted/30">
                  <Globe className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <span className="text-xs text-muted-foreground">
                    Este usuario verá las páginas definidas en la configuración global
                    (tab <strong>Visibilidad de páginas</strong>).
                  </span>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <button onClick={() => setVisiblePages(ALL_PAGE_KEYS)} className="text-xs text-primary hover:underline">
                      Seleccionar todo
                    </button>
                    <span className="text-xs text-muted-foreground">·</span>
                    <button onClick={() => setVisiblePages([])} className="text-xs text-muted-foreground hover:underline">
                      Limpiar
                    </button>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {visiblePages.length}/{ALL_PAGE_KEYS.length} páginas
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                    {PAGE_SECTIONS_DEF.map(section => (
                      <div key={section.id} className="space-y-1.5">
                        <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                          {section.label}
                        </div>
                        <div className="space-y-1">
                          {section.pages.map(page => (
                            <div key={page.key} className="flex items-center gap-2">
                              <Checkbox
                                id={`vp-${page.key}`}
                                checked={visiblePages.includes(page.key)}
                                onCheckedChange={() => togglePage(page.key)}
                              />
                              <label htmlFor={`vp-${page.key}`} className="text-xs cursor-pointer">
                                {page.label}
                              </label>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="border-t border-border" />

            {/* ── 5. Widgets del Dashboard ─────────────────── */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <SectionTitle icon={<Eye className="w-3.5 h-3.5" />} label="Widgets del Dashboard" />
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Mostrar todos</span>
                  <Switch
                    checked={useAllWidgets}
                    onCheckedChange={v => {
                      setUseAllWidgets(v);
                      if (!v && dashboardWidgets.length === 0)
                        setDashboardWidgets(['Mis proyectos', 'Mis tareas', 'Próximos eventos', 'Órdenes de compra', 'Menciones recientes', 'Facturas recibidas']);
                    }}
                  />
                </div>
              </div>

              {useAllWidgets ? (
                <div className="flex items-center gap-2.5 px-3 py-3 rounded-lg border border-border bg-muted/30">
                  <Globe className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <span className="text-xs text-muted-foreground">
                    Este usuario verá todos los widgets del dashboard.
                  </span>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setDashboardWidgets(['Mis proyectos', 'Mis tareas', 'Próximos eventos', 'Órdenes de compra', 'Menciones recientes', 'Facturas recibidas'])}
                      className="text-xs text-primary hover:underline"
                    >
                      Seleccionar todo
                    </button>
                    <span className="text-xs text-muted-foreground">·</span>
                    <button onClick={() => setDashboardWidgets([])} className="text-xs text-muted-foreground hover:underline">
                      Limpiar
                    </button>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {dashboardWidgets.length}/6 widgets
                    </span>
                  </div>
                  <div className="space-y-2">
                    {(['Mis proyectos', 'Mis tareas', 'Próximos eventos', 'Órdenes de compra', 'Menciones recientes', 'Facturas recibidas'] as const).map(w => (
                      <div key={w} className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-border bg-muted/30 cursor-pointer hover:border-primary/30 transition-colors"
                        onClick={() => setDashboardWidgets(prev => prev.includes(w) ? prev.filter(x => x !== w) : [...prev, w])}
                      >
                        <Checkbox
                          id={`dw-${w}`}
                          checked={dashboardWidgets.includes(w)}
                          onCheckedChange={() => setDashboardWidgets(prev => prev.includes(w) ? prev.filter(x => x !== w) : [...prev, w])}
                          onClick={e => e.stopPropagation()}
                        />
                        <label htmlFor={`dw-${w}`} className="text-xs cursor-pointer">{w}</label>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="border-t border-border" />

            {/* ── 6. Rubros de cotización ──────────────────── */}
            <div className="space-y-3">
              <SectionTitle icon={<ChevronRight className="w-3.5 h-3.5" />} label="Rubros de cotización" />
              <p className="text-xs text-muted-foreground">
                Selecciona qué rubros puede ver y sobre cuáles recibirá notificaciones al aprobarse un deal.
              </p>
              <div className="grid grid-cols-1 gap-2">
                {RUBROS_COTIZACION.map(rubro => {
                  const checked = cotizacionRubros.includes(rubro);
                  return (
                    <div
                      key={rubro}
                      onClick={() => setCotizacionRubros(prev => prev.includes(rubro) ? prev.filter(r => r !== rubro) : [...prev, rubro])}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                        checked ? 'bg-primary/5 border-primary/25' : 'bg-muted/30 border-transparent hover:border-border'
                      }`}
                    >
                      <Checkbox
                        id={`cr-${rubro}`}
                        checked={checked}
                        onCheckedChange={() => setCotizacionRubros(prev => prev.includes(rubro) ? prev.filter(r => r !== rubro) : [...prev, rubro])}
                        onClick={e => e.stopPropagation()}
                      />
                      <label htmlFor={`cr-${rubro}`} className={`text-sm cursor-pointer select-none ${checked ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
                        {rubro}
                      </label>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="border-t border-border" />

            {/* ── 7. Chat ──────────────────────────────────── */}
            <div className="flex items-center justify-between py-1">
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium text-foreground/80">Ocultar del chat</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Este usuario no aparecerá en la lista de miembros del chat.
                </p>
              </div>
              <Switch checked={hiddenFromChat} onCheckedChange={setHiddenFromChat} />
            </div>

          </div>
        </div>

        {/* Delete zone */}
        <div className="px-6 py-3 border-t border-border flex-shrink-0">
          <button
            onClick={() => setDeleteOpen(true)}
            className="flex items-center gap-1.5 text-xs text-destructive hover:underline transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Eliminar usuario
          </button>
        </div>

        <div className="px-6 py-4 border-t flex-shrink-0 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            {saving ? 'Guardando...' : 'Guardar cambios'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Eliminar usuario?</AlertDialogTitle>
          <AlertDialogDescription>
            Estás a punto de eliminar a <strong>{fullName}</strong> ({user.email}).
            Esta acción no se puede deshacer.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={deleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90 gap-1.5"
          >
            {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            {deleting ? 'Eliminando...' : 'Sí, eliminar'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

// ── Rubro Assignments Tab ─────────────────────────────────────────────────────
const RUBROS_LIST = [
  'Reclutamiento e incentivos',
  'Moderación',
  'Management',
  'Logística y operación',
  'Back office',
] as const;

type RubroAssignment = { id?: string; rubro: string; assignedUserId?: string; assignedUserName?: string; assignedUserEmail?: string; };
type RubroUser = { id: string; name: string; email: string; };

function RubroAssignmentsTab() {
  const [assignments, setAssignments] = useState<RubroAssignment[]>([]);
  const [users, setUsers] = useState<RubroUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    getRubroAssignments({})
      .then(d => { setAssignments(d.assignments); setUsers(d.users); })
      .catch(() => toast.error('Error al cargar responsables'))
      .finally(() => setLoading(false));
  }, []);

  const handleChange = async (assignment: RubroAssignment, newUserId: string) => {
    const resolvedUserId = newUserId === '__none__' ? undefined : newUserId;
    setSaving(assignment.rubro);
    try {
      const result = await saveRubroAssignment({
        id: assignment.id,
        rubro: assignment.rubro,
        assignedUserId: resolvedUserId,
      });
      setAssignments(prev => prev.map(a =>
        a.rubro === assignment.rubro
          ? { ...a, id: result.id, assignedUserId: resolvedUserId, assignedUserName: users.find(u => u.id === resolvedUserId)?.name }
          : a
      ));
      toast.success('Responsable actualizado');
    } catch { toast.error('Error al guardar'); }
    setSaving(null);
  };

  return (
    <div>
      <div className="px-6 py-4 border-b border-border">
        <p className="text-sm font-semibold">Responsables por rubro</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Al aprobar un deal, cada responsable recibirá un mensaje directo con el detalle de su presupuesto asignado (sin markup).
        </p>
      </div>
      <div className="divide-y divide-border">
        {loading ? (
          <div className="px-6 py-10 text-center text-sm text-muted-foreground">Cargando...</div>
        ) : (
          RUBROS_LIST.map(rubroName => {
            const assignment = assignments.find(a => a.rubro === rubroName) ?? { rubro: rubroName };
            const isSaving = saving === rubroName;
            return (
              <div key={rubroName} className="px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{rubroName}</p>
                  {assignment.assignedUserName && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {assignment.assignedUserName}
                      {assignment.assignedUserEmail && (
                        <span className="text-muted-foreground/70"> · {assignment.assignedUserEmail}</span>
                      )}
                    </p>
                  )}
                </div>
                <Select
                  value={assignment.assignedUserId ?? '__none__'}
                  onValueChange={v => handleChange(assignment, v)}
                  disabled={isSaving}
                >
                  <SelectTrigger className="w-64 h-9 text-sm">
                    <SelectValue placeholder="Sin asignar..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Sin asignar</SelectItem>
                    {users.map(u => (
                      <SelectItem key={u.id} value={u.id}>
                        <div className="flex flex-col py-0.5">
                          <span>{u.name}</span>
                          <span className="text-xs text-muted-foreground">{u.email}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// small helper
function SectionTitle({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-primary">{icon}</span>
      <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{label}</span>
    </div>
  );
}

// ── Invite Users Dialog ───────────────────────────────────────────────────────
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseEmails(raw: string): string[] {
  return raw
    .split(/[\n,;]+/)
    .map(e => e.trim().toLowerCase())
    .filter(e => e.length > 0);
}

function InviteUsersDialog({
  open, onClose, onInvited,
}: {
  open: boolean;
  onClose: () => void;
  onInvited: () => void;
}) {
  const [tab, setTab] = useState<'individual' | 'bulk'>('individual');
  const [singleEmail, setSingleEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [bulkRaw, setBulkRaw] = useState('');
  const [role, setRole] = useState('');
  const [accessComercial, setAccessComercial] = useState('Sin acceso');
  const [accessOperacion, setAccessOperacion] = useState('Sin acceso');
  const [accessAdmin, setAccessAdmin] = useState('Sin acceso');
  const [accessFinanzas, setAccessFinanzas] = useState('Sin acceso');
  const [accessOtros, setAccessOtros] = useState('Sin acceso');
  const [saving, setSaving] = useState(false);
  const [emailError, setEmailError] = useState('');

  const resetForm = () => {
    setSingleEmail(''); setFirstName(''); setLastName('');
    setBulkRaw(''); setRole('');
    setAccessComercial('Sin acceso'); setAccessOperacion('Sin acceso');
    setAccessAdmin('Sin acceso'); setAccessFinanzas('Sin acceso');
    setAccessOtros('Sin acceso'); setEmailError('');
  };

  const handleClose = () => { resetForm(); onClose(); };

  const bulkEmails = parseEmails(bulkRaw);
  const invalidBulk = bulkEmails.filter(e => !EMAIL_REGEX.test(e));

  const handleInvite = async () => {
    const emails = tab === 'individual' ? [singleEmail.trim().toLowerCase()] : bulkEmails;

    if (tab === 'individual') {
      if (!EMAIL_REGEX.test(emails[0])) { setEmailError('Email inválido'); return; }
    } else {
      if (emails.length === 0) { toast.error('Ingresa al menos un email'); return; }
      if (invalidBulk.length > 0) { toast.error(`Emails inválidos: ${invalidBulk.join(', ')}`); return; }
    }

    setSaving(true);
    try {
      const result = await inviteUsers({
        emails,
        firstName: tab === 'individual' && firstName.trim() ? firstName.trim() : undefined,
        lastName: tab === 'individual' && lastName.trim() ? lastName.trim() : undefined,
        role: role || undefined,
        accessComercial: accessComercial !== 'Sin acceso' ? accessComercial : undefined,
        accessOperacion: accessOperacion !== 'Sin acceso' ? accessOperacion : undefined,
        accessAdmin: accessAdmin !== 'Sin acceso' ? accessAdmin : undefined,
        accessFinanzas: accessFinanzas !== 'Sin acceso' ? accessFinanzas : undefined,
        accessOtros: accessOtros !== 'Sin acceso' ? accessOtros : undefined,
      });

      const parts: string[] = [];
      if (result.created > 0) parts.push(`${result.created} usuario${result.created !== 1 ? 's' : ''} agregado${result.created !== 1 ? 's' : ''}`);
      if (result.skipped > 0) parts.push(`${result.skipped} ya existía${result.skipped !== 1 ? 'n' : ''}`);
      toast.success(parts.join(' · ') || 'Operación completada');

      onInvited();
      handleClose();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error al agregar usuarios');
    } finally {
      setSaving(false);
    }
  };

  const AccessSelects = () => (
    <div className="space-y-2 pt-1">
      <Label className="text-xs text-muted-foreground">Acceso por área (opcional)</Label>
      <div className="grid grid-cols-2 gap-2">
        {[
          { label: 'Comercial', value: accessComercial, set: setAccessComercial },
          { label: 'Operación', value: accessOperacion, set: setAccessOperacion },
          { label: 'Administración', value: accessAdmin, set: setAccessAdmin },
          { label: 'Finanzas', value: accessFinanzas, set: setAccessFinanzas },
          { label: 'Otros', value: accessOtros, set: setAccessOtros },
        ].map(s => (
          <div key={s.label} className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">{s.label}</Label>
            <Select value={s.value} onValueChange={s.set}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ACCESS_LEVELS.map(l => <SelectItem key={l} value={l} className="text-xs">{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) handleClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" />
            Agregar usuarios
          </DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={v => { setTab(v as 'individual' | 'bulk'); setEmailError(''); }}>
          <TabsList className="w-full">
            <TabsTrigger value="individual" className="flex-1 text-xs">Individual</TabsTrigger>
            <TabsTrigger value="bulk" className="flex-1 text-xs">Múltiple</TabsTrigger>
          </TabsList>

          {/* ── Individual ── */}
          <TabsContent value="individual" className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Nombre <span className="text-muted-foreground font-normal">(opcional)</span></Label>
                <Input
                  placeholder="Juan"
                  value={firstName}
                  onChange={e => setFirstName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Apellido <span className="text-muted-foreground font-normal">(opcional)</span></Label>
                <Input
                  placeholder="García"
                  value={lastName}
                  onChange={e => setLastName(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Email <span className="text-destructive">*</span></Label>
              <Input
                type="email"
                placeholder="usuario@empresa.com"
                value={singleEmail}
                onChange={e => { setSingleEmail(e.target.value); setEmailError(''); }}
                onKeyDown={e => e.key === 'Enter' && handleInvite()}
                className={emailError ? 'border-destructive' : ''}
              />
              {emailError && <p className="text-xs text-destructive">{emailError}</p>}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Rol (opcional)</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Sin rol asignado" /></SelectTrigger>
                <SelectContent>
                  {ROLES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <AccessSelects />
          </TabsContent>

          {/* ── Bulk ── */}
          <TabsContent value="bulk" className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs">
                Emails <span className="text-destructive">*</span>
                <span className="text-muted-foreground font-normal ml-1">(uno por línea o separados por coma)</span>
              </Label>
              <Textarea
                placeholder={"usuario1@empresa.com\nusuario2@empresa.com\nusuario3@empresa.com"}
                value={bulkRaw}
                onChange={e => setBulkRaw(e.target.value)}
                rows={5}
                className="text-sm font-mono resize-none"
              />
              <div className="flex items-center justify-between">
                {bulkEmails.length > 0 && (
                  <span className="text-xs text-muted-foreground">{bulkEmails.length} email{bulkEmails.length !== 1 ? 's' : ''} detectado{bulkEmails.length !== 1 ? 's' : ''}</span>
                )}
                {invalidBulk.length > 0 && (
                  <span className="text-xs text-destructive ml-auto">{invalidBulk.length} inválido{invalidBulk.length !== 1 ? 's' : ''}</span>
                )}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Rol para todos (opcional)</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Sin rol asignado" /></SelectTrigger>
                <SelectContent>
                  {ROLES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <AccessSelects />
          </TabsContent>
        </Tabs>

        <DialogFooter className="gap-2 pt-2">
          <Button variant="ghost" onClick={handleClose} disabled={saving}>Cancelar</Button>
          <Button onClick={handleInvite} disabled={saving} className="gap-1.5">
            {saving
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Plus className="w-3.5 h-3.5" />
            }
            {saving
              ? 'Agregando...'
              : tab === 'bulk' && bulkEmails.length > 1
                ? `Agregar ${bulkEmails.length} usuarios`
                : 'Agregar usuario'
            }
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Users Tab ─────────────────────────────────────────────────────────────────
function UsersTab() {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [editUser, setEditUser] = useState<UserRecord | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [previewUser, setPreviewUser] = useState<UserRecord | null>(null);

  const loadUsers = () => {
    setLoading(true);
    getUsers({})
      .then(d => setUsers(d.users))
      .catch(() => toast.error('Error al cargar usuarios'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadUsers(); }, []);

  const handleSaved = (updated: UserRecord) => {
    setUsers(prev => prev.map(u => u.id === updated.id ? updated : u));
  };

  const handleDeleted = (id: string) => {
    setUsers(prev => prev.filter(u => u.id !== id));
  };

  return (
    <>
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div>
          <p className="text-sm font-semibold">Usuarios del sistema</p>
          <p className="text-xs text-muted-foreground">
            {loading ? 'Cargando...' : `${users.length} usuario${users.length !== 1 ? 's' : ''} registrados — haz clic en uno para editarlo`}
          </p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setInviteOpen(true)}>
          <Plus className="w-3.5 h-3.5" /> Agregar usuarios
        </Button>
      </div>

      {loading ? (
        <div className="p-6 space-y-3">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
        </div>
      ) : users.length === 0 ? (
        <div className="px-6 py-16 text-center text-sm text-muted-foreground">No hay usuarios registrados.</div>
      ) : (
        <div className="divide-y divide-border">
          {users.map(user => {
            const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ') || '—';
            const hasCustomPages = (user.visiblePages ?? []).length > 0;
            return (
              <div
                key={user.id}
                onClick={() => setEditUser(user)}
                className="flex items-center gap-4 px-6 py-3.5 hover:bg-muted/30 cursor-pointer transition-colors group"
              >
                <UserAvatar user={user} />

                {/* Name + email */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium truncate">{fullName}</span>
                    {user.role && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium border border-border">
                        {user.role}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">{user.email}</div>
                </div>

                {/* Tags */}
                <div className="hidden sm:flex items-center gap-2 flex-shrink-0">
                  {user.purchaseLevel && (
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${purchaseLevelColor[user.purchaseLevel] ?? 'bg-muted text-muted-foreground border-border'}`}>
                      {user.purchaseLevel}
                    </span>
                  )}
                  {hasCustomPages ? (
                    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-semibold">
                      <Eye className="w-2.5 h-2.5" /> {(user.visiblePages ?? []).length} págs.
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Globe className="w-2.5 h-2.5" /> Global
                    </span>
                  )}
                </div>

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 flex-shrink-0 text-muted-foreground hover:text-foreground"
                  title="Ver navegación como este usuario"
                  onClick={e => { e.stopPropagation(); setPreviewUser(user); }}
                >
                  <Eye className="w-3.5 h-3.5" />
                </Button>

                <ChevronRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors flex-shrink-0" />
              </div>
            );
          })}
        </div>
      )}

      <UserEditSheet
        user={editUser}
        open={!!editUser}
        onClose={() => setEditUser(null)}
        onSaved={handleSaved}
        onDeleted={handleDeleted}
      />

      <InviteUsersDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onInvited={loadUsers}
      />

      <NavPreviewDialog
        user={previewUser}
        open={!!previewUser}
        onClose={() => setPreviewUser(null)}
      />
    </>
  );
}

// ── Page Visibility Tab ───────────────────────────────────────────────────────
function PageVisibilityTab() {
  const [defaultPages, setDefaultPages] = useState<string[]>([]);
  const [settingId, setSettingId] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getAppSettings({})
      .then(d => { setDefaultPages(d.defaultVisiblePages); setSettingId(d.settingId); })
      .catch(() => toast.error('Error al cargar configuración'))
      .finally(() => setLoading(false));
  }, []);

  const toggle = (key: string) =>
    setDefaultPages(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await saveAppSettings({ settingId, defaultVisiblePages: defaultPages });
      setSettingId(result.id);
      toast.success('Configuración guardada');
    } catch { toast.error('Error al guardar'); }
    setSaving(false);
  };

  if (loading) return (
    <div className="p-6 space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
  );

  const isAllSelected = ALL_PAGE_KEYS.every(k => defaultPages.includes(k));

  return (
    <div>
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div>
          <p className="text-sm font-semibold">Visibilidad de páginas por defecto</p>
          <p className="text-xs text-muted-foreground">
            Aplica a todos los usuarios sin configuración personalizada.
          </p>
        </div>
        <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1.5">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          {saving ? 'Guardando...' : 'Guardar'}
        </Button>
      </div>

      <div className="px-6 py-5 space-y-5">
        {defaultPages.length === 0 && (
          <div className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800">
            <Globe className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <p className="text-xs">
              Sin páginas seleccionadas, todos los usuarios verán <strong>todas las páginas</strong> por defecto.
            </p>
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={() => setDefaultPages(isAllSelected ? [] : ALL_PAGE_KEYS)}
            className="text-xs text-primary hover:underline font-medium"
          >
            {isAllSelected ? 'Deseleccionar todo' : 'Seleccionar todo'}
          </button>
          <span className="text-xs text-muted-foreground">
            {defaultPages.length} de {ALL_PAGE_KEYS.length} páginas habilitadas
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5">
          {PAGE_SECTIONS_DEF.map(section => (
            <div key={section.id} className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="h-px flex-1 bg-border" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground px-1">
                  {section.label}
                </span>
                <div className="h-px flex-1 bg-border" />
              </div>
              <div className="space-y-1.5">
                {section.pages.map(page => {
                  const checked = defaultPages.includes(page.key);
                  return (
                    <div
                      key={page.key}
                      onClick={() => toggle(page.key)}
                      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer border transition-colors ${
                        checked ? 'bg-primary/5 border-primary/20' : 'bg-muted/30 border-transparent hover:border-border'
                      }`}
                    >
                      <Checkbox checked={checked} onCheckedChange={() => toggle(page.key)} onClick={e => e.stopPropagation()} />
                      <span className={`text-sm ${checked ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
                        {page.label}
                      </span>
                      {checked && <Eye className="w-3 h-3 text-primary ml-auto" />}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Approval Limits Tab ───────────────────────────────────────────────────────
function LimitDialog({ limit, open, onClose, onSaved }: {
  limit: LimitRecord | null; open: boolean; onClose: () => void; onSaved: (l: LimitRecord) => void;
}) {
  const [costCenter, setCostCenter] = useState('');
  const [approvalLevel, setApprovalLevel] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setCostCenter(limit?.costCenter ?? '');
      setApprovalLevel(limit?.approvalLevel ?? '');
      setMaxAmount(String(limit?.maxAmount ?? ''));
    }
  }, [open, limit]);

  const handleSave = async () => {
    if (!costCenter || !approvalLevel || !maxAmount) { toast.error('Completa todos los campos'); return; }
    setSaving(true);
    try {
      const result = await saveApprovalLimit({ id: limit?.id, costCenter, approvalLevel, maxAmount: parseFloat(maxAmount) });
      onSaved({ id: result.id, costCenter, approvalLevel, maxAmount: parseFloat(maxAmount) });
      toast.success(limit ? 'Límite actualizado' : 'Límite creado');
      onClose();
    } catch (e: unknown) { toast.error((e as Error).message ?? 'Error al guardar'); }
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{limit ? 'Editar límite de aprobación' : 'Nuevo límite de aprobación'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Centro de costo</Label>
            <Select value={costCenter} onValueChange={setCostCenter}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
              <SelectContent>{COST_CENTERS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Nivel de aprobación</Label>
            <Select value={approvalLevel} onValueChange={setApprovalLevel}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
              <SelectContent>{APPROVAL_LEVELS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Monto máximo (MXN)</Label>
            <Input type="number" min={0} className="h-9 text-sm" placeholder="Ej: 50000"
              value={maxAmount} onChange={e => setMaxAmount(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            {saving ? 'Guardando...' : 'Guardar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ApprovalLimitsTab() {
  const [limits, setLimits] = useState<LimitRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingLimit, setEditingLimit] = useState<LimitRecord | null>(null);

  useEffect(() => {
    getApprovalLimits({})
      .then(d => setLimits(d.limits))
      .catch(() => toast.error('Error al cargar límites'))
      .finally(() => setLoading(false));
  }, []);

  const handleSaved = (l: LimitRecord) => {
    setLimits(prev => {
      const idx = prev.findIndex(x => x.id === l.id);
      return idx >= 0 ? prev.map((x, i) => i === idx ? l : x) : [...prev, l];
    });
  };

  const levelColor: Record<string, string> = {
    Aprobador: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    Finanzas:  'bg-blue-100 text-blue-700 border-blue-200',
  };

  if (loading) return (
    <div className="space-y-3 p-6">{[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
  );

  return (
    <div>
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div>
          <p className="text-sm font-semibold">Límites de aprobación por rubro</p>
          <p className="text-xs text-muted-foreground">Define el monto máximo que cada nivel puede aprobar por centro de costo</p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => { setEditingLimit(null); setDialogOpen(true); }}>
          <Plus className="w-3.5 h-3.5" /> Agregar límite
        </Button>
      </div>

      {limits.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
          <div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center">
            <Shield className="w-6 h-6 text-muted-foreground" />
          </div>
          <p className="text-sm font-semibold">Sin límites configurados</p>
          <p className="text-xs text-muted-foreground">Agrega límites para controlar qué montos puede aprobar cada nivel.</p>
          <Button size="sm" className="mt-2 gap-1.5" onClick={() => { setEditingLimit(null); setDialogOpen(true); }}>
            <Plus className="w-3.5 h-3.5" /> Agregar primero
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-muted/40 border-b border-border">
              <tr>
                {['Centro de costo', 'Nivel de aprobación', 'Monto máximo', ''].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {limits.map(l => (
                <tr key={l.id} className="border-b border-border hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 text-sm font-medium">{l.costCenter ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${levelColor[l.approvalLevel ?? ''] ?? 'bg-muted text-muted-foreground border-border'}`}>
                      {l.approvalLevel ?? '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-bold tabular-nums">{fmtCurrency(l.maxAmount)}</td>
                  <td className="px-4 py-3">
                    <Button size="sm" variant="ghost" className="h-7 px-2.5 text-xs text-muted-foreground"
                      onClick={() => { setEditingLimit(l); setDialogOpen(true); }}>
                      Editar
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <LimitDialog
        limit={editingLimit} open={dialogOpen}
        onClose={() => setDialogOpen(false)} onSaved={handleSaved}
      />
    </div>
  );
}

// ── Backups Tab ───────────────────────────────────────────────────────────────
type BackupSummary = {
  [key: string]: number | string | undefined;
};

function BackupCard({
  table,
  title,
  description,
}: {
  table: 'BoardColumns' | 'SharedViews';
  title: string;
  description: string;
}) {
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<BackupSummary | null>(null);
  const [lastExport, setLastExport] = useState<string | null>(null);

  const handleExport = async () => {
    setLoading(true);
    setSummary(null);
    try {
      const { jsonData } = await exportConfigBackup({ table });
      // Trigger download
      const now = new Date();
      const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const filename = `${table}_Backup_${dateStr}.json`;
      const blob = new Blob([jsonData], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Parse summary
      try {
        const parsed = JSON.parse(jsonData);
        if (parsed._summary) {
          setSummary(parsed._summary);
          setLastExport(parsed._exportDate);
        }
      } catch { /* ignore parse errors */ }

      toast.success(`${title} exportado correctamente`);
    } catch {
      toast.error(`Error al exportar ${title}`);
    }
    setLoading(false);
  };

  return (
    <div className="border border-border rounded-xl bg-card overflow-hidden">
      <div className="p-5 flex items-start justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
            <FileJson className="w-5 h-5 text-primary" />
          </div>
          <div className="space-y-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">{title}</p>
            <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
          </div>
        </div>
        <Button
          size="sm"
          onClick={handleExport}
          disabled={loading}
          className="gap-1.5 flex-shrink-0"
        >
          {loading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Download className="w-3.5 h-3.5" />
          )}
          {loading ? 'Exportando...' : 'Exportar JSON'}
        </Button>
      </div>

      {summary && (
        <div className="border-t border-border bg-muted/30 px-5 py-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Resumen del export
            </span>
            {lastExport && (
              <span className="text-[10px] text-muted-foreground">
                {new Date(lastExport).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {Object.entries(summary).map(([key, value]) => {
              if (typeof value !== 'number') return null;
              const labels: Record<string, string> = {
                totalColumns: 'Total columnas',
                activeColumns: 'Activas',
                deletedColumns: 'Eliminadas',
                resolvedToBoard: 'Resueltas a board',
                unresolvedColumns: 'Sin resolver',
                projectCount: 'Proyectos',
                uniqueBoardIds: 'Board IDs únicos',
                totalViews: 'Total vistas',
                activeViews: 'Activas',
                inactiveViews: 'Inactivas',
                internalViews: 'Internas',
                externalViews: 'Externas',
                resolvedToBoard2: 'Resueltas',
                unresolvedViews: 'Sin resolver',
              };
              const label = labels[key] || key.replace(/([A-Z])/g, ' $1').trim();
              const isHighlight = key.startsWith('total') || key === 'projectCount';
              return (
                <div
                  key={key}
                  className={`px-3 py-2 rounded-lg border ${
                    isHighlight
                      ? 'bg-primary/5 border-primary/20'
                      : 'bg-card border-border'
                  }`}
                >
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
                  <p className={`text-lg font-bold tabular-nums ${isHighlight ? 'text-primary' : 'text-foreground'}`}>
                    {value.toLocaleString()}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

const CLEANUP_BOARD_IDS = [
  'recruitment-PJT-001-prueba 5',
  'recruitment-PJT-001-prueba 2',
  'recruitment-PJT-001-29 mar 344',
  'recruitment-PJT-001-pellet',
  'recruitment-PJT-001-prueba 3',
  'recruitment-PJT-001-PAIN',
  'recruitment-PJT-001-veamos',
  'recruitment-PJT-001-bravo',
  'recruitment-PJT-001-TIZANA',
  'recruitment-PJT-001-AWAY',
  'recruitment-PJT-001-centauro',
  'recruitment-PJT-001-IMÁN',
  'recruitment-PJT-001-inspire 6',
  'recruitment-PJT-001-otro prueba',
  'recruitment-PJT-001-INSPIRE 5',
  'recruitment-PJT-001-27 mar 26',
  'recruitment-PJT-001-MONEY MONEY',
  'recruitment-PJT-001-carrera',
  'recruitment-PJT-001-INSPIRE',
  'recruitment-PJT-001-PAIN::groups',
  'recruitment-PJT-001-IMÁN::groups',
  'recruitment-PJT-001-TIZANA::groups',
  'recruitment-PJT-001-veamos::groups',
];

type CleanupBoardResult = CleanupPJT001OutputType['results'][0];

function CleanupPJT001Card() {
  const [phase, setPhase] = useState<'idle' | 'scanning' | 'applying' | 'done'>('idle');
  const [dryRunResults, setDryRunResults] = useState<CleanupBoardResult[] | null>(null);
  const [dryRunDelta, setDryRunDelta] = useState('');
  const [dryRunTotal, setDryRunTotal] = useState(0);
  const [applyResults, setApplyResults] = useState<CleanupBoardResult[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [currentBoardId, setCurrentBoardId] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [finalVerification, setFinalVerification] = useState<{ passed: boolean; activeRemaining: number } | null>(null);
  const [totalSoftDeleted, setTotalSoftDeleted] = useState(0);
  const [totalFailed, setTotalFailed] = useState(0);
  const [error, setError] = useState('');

  const dryRunCountMap = new Map<string, number>();
  if (dryRunResults) {
    for (const r of dryRunResults) dryRunCountMap.set(r.boardId, r.found);
  }

  const handleDryRun = async () => {
    setPhase('scanning');
    setError('');
    setDryRunResults(null);
    setApplyResults([]);
    setFinalVerification(null);
    try {
      const res = await cleanupPJT001({ mode: 'dry-run' });
      setDryRunResults(res.results);
      setDryRunDelta(res.delta);
      setDryRunTotal(res.totalFound);
      setPhase('idle');
    } catch (e: any) {
      setError(e.message || 'Error en dry-run');
      setPhase('idle');
    }
  };

  const handleApply = async () => {
    setConfirmOpen(false);
    setConfirmText('');
    setPhase('applying');
    setApplyResults([]);
    setTotalSoftDeleted(0);
    setTotalFailed(0);
    setFinalVerification(null);
    setError('');

    let cumDeleted = 0;
    let cumFailed = 0;
    const allResults: CleanupBoardResult[] = [];

    for (let i = 0; i < CLEANUP_BOARD_IDS.length; i++) {
      const bid = CLEANUP_BOARD_IDS[i];
      setCurrentIdx(i);
      setCurrentBoardId(bid);
      try {
        const res = await cleanupPJT001({ mode: 'apply', confirm: 'PJT-001-CLEANUP', boardIds: [bid] });
        const r = res.results[0] || { boardId: bid, found: 0, softDeleted: 0, failed: 0, sampleIds: [] };
        allResults.push(r);
        cumDeleted += r.softDeleted;
        cumFailed += r.failed;
      } catch (e: any) {
        allResults.push({ boardId: bid, found: 0, softDeleted: 0, failed: 0, sampleIds: [], error: e.message || 'Error' });
        cumFailed += 1;
      }
      setApplyResults([...allResults]);
      setTotalSoftDeleted(cumDeleted);
      setTotalFailed(cumFailed);
    }

    // Final verification
    try {
      const ver = await cleanupPJT001({ mode: 'dry-run' });
      setFinalVerification({ passed: ver.totalFound === 0, activeRemaining: ver.totalFound });
    } catch {
      setFinalVerification({ passed: false, activeRemaining: -1 });
    }

    setPhase('done');
  };

  const progressPct = phase === 'applying' ? Math.round(((currentIdx + 1) / CLEANUP_BOARD_IDS.length) * 100) : 0;
  const showResults = phase === 'done' && applyResults.length > 0;

  return (
    <div className="border border-border rounded-xl bg-card overflow-hidden">
      {/* Header */}
      <div className="p-5 flex items-start justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="w-10 h-10 rounded-lg bg-destructive/10 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Trash2 className="w-5 h-5 text-destructive" />
          </div>
          <div className="space-y-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">Cleanup PJT-001 — Data de prueba</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Soft-delete de todos los CellValues legacy bajo <code className="text-[11px] bg-muted px-1 py-0.5 rounded">recruitment-PJT-001-*</code>. No toca Boards, RecruitmentRows ni BoardColumns.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button
            size="sm"
            variant="outline"
            onClick={handleDryRun}
            disabled={phase === 'scanning' || phase === 'applying'}
            className="gap-1.5"
          >
            {phase === 'scanning' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
            Dry Run
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => { setConfirmText(''); setConfirmOpen(true); }}
            disabled={!dryRunResults || phase === 'scanning' || phase === 'applying'}
            className="gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Aplicar Soft-Delete
          </Button>
        </div>
      </div>

      {/* Scanning bar */}
      {phase === 'scanning' && (
        <div className="px-5 pb-5 space-y-2">
          <Progress value={undefined} className="h-2" />
          <p className="text-xs text-muted-foreground">Escaneando todos los boardIds...</p>
        </div>
      )}

      {/* Apply progress bar */}
      {phase === 'applying' && (
        <div className="px-5 pb-5 space-y-2">
          <Progress value={progressPct} className="h-2" />
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {currentIdx + 1}/{CLEANUP_BOARD_IDS.length} boardIds procesados
            </p>
            <p className="text-xs font-medium tabular-nums">{progressPct}%</p>
          </div>
          <p className="text-xs text-foreground/70">
            Procesando: <span className="font-medium">{currentBoardId}</span>
            {dryRunCountMap.has(currentBoardId) && (
              <span className="text-muted-foreground"> ({dryRunCountMap.get(currentBoardId)!.toLocaleString()} registros)</span>
            )}
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mx-5 mb-5 flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Dry-run results */}
      {dryRunResults && phase === 'idle' && !showResults && (
        <div className="border-t border-border bg-muted/30 px-5 py-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Resultado Dry-Run</span>
            <span className="text-xs font-medium tabular-nums">{dryRunTotal.toLocaleString()} activos · Delta: {dryRunDelta}</span>
          </div>
          <div className="max-h-64 overflow-y-auto rounded-lg border border-border bg-card">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold text-muted-foreground">boardId</th>
                  <th className="text-right px-3 py-2 font-semibold text-muted-foreground">Activos</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {dryRunResults.map(r => (
                  <tr key={r.boardId}>
                    <td className="px-3 py-1.5 font-mono text-[11px] truncate max-w-xs">{r.boardId}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-medium">{r.found.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Apply results */}
      {showResults && (
        <div className="border-t border-border bg-muted/30 px-5 py-4 space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Encontrados', value: applyResults.reduce((a, r) => a + r.found, 0), highlight: true },
              { label: 'Soft-deleted', value: totalSoftDeleted, highlight: true },
              { label: 'Fallidos', value: totalFailed, highlight: false, danger: totalFailed > 0 },
              { label: 'Verificación', value: finalVerification?.passed ? '✅ Pasada' : '❌ Fallida', highlight: false, danger: !finalVerification?.passed },
            ].map(s => (
              <div key={s.label} className={`px-3 py-2 rounded-lg border ${s.danger ? 'bg-destructive/5 border-destructive/20' : s.highlight ? 'bg-primary/5 border-primary/20' : 'bg-card border-border'}`}>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{s.label}</p>
                <p className={`text-lg font-bold tabular-nums ${s.danger ? 'text-destructive' : s.highlight ? 'text-primary' : 'text-foreground'}`}>
                  {typeof s.value === 'number' ? s.value.toLocaleString() : s.value}
                </p>
              </div>
            ))}
          </div>

          {finalVerification && (
            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium ${finalVerification.passed ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-destructive/10 border-destructive/20 text-destructive'}`}>
              {finalVerification.passed ? '✅ Verificación pasada — 0 CellValues activos bajo recruitment-PJT-001-*' : `❌ Verificación fallida — ${finalVerification.activeRemaining} activos restantes`}
            </div>
          )}

          {/* Per-boardId table */}
          <div className="max-h-64 overflow-y-auto rounded-lg border border-border bg-card">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold text-muted-foreground">boardId</th>
                  <th className="text-right px-3 py-2 font-semibold text-muted-foreground">Found</th>
                  <th className="text-right px-3 py-2 font-semibold text-muted-foreground">Deleted</th>
                  <th className="text-right px-3 py-2 font-semibold text-muted-foreground">Failed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {applyResults.map(r => (
                  <tr key={r.boardId} className={r.error ? 'bg-destructive/5' : ''}>
                    <td className="px-3 py-1.5 font-mono text-[11px] truncate max-w-xs">
                      {r.boardId}
                      {r.error && <span className="ml-1 text-destructive">⚠</span>}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.found.toLocaleString()}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-medium">{r.softDeleted.toLocaleString()}</td>
                    <td className={`px-3 py-1.5 text-right tabular-nums font-medium ${r.failed > 0 ? 'text-destructive' : ''}`}>{r.failed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Confirm dialog */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive" />
              Confirmar Soft-Delete
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <span className="block">
                Esto soft-deleteará <strong>~{dryRunTotal.toLocaleString()}</strong> CellValues bajo{' '}
                <code className="text-[11px] bg-muted px-1 py-0.5 rounded">recruitment-PJT-001-*</code>.
              </span>
              <span className="block text-xs">
                Escribe <strong>PJT-001-CLEANUP</strong> para confirmar:
              </span>
              <Input
                value={confirmText}
                onChange={e => setConfirmText(e.target.value)}
                placeholder="PJT-001-CLEANUP"
                className="font-mono text-sm"
              />
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={confirmText !== 'PJT-001-CLEANUP'}
              onClick={handleApply}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Confirmar y aplicar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function BackupsTab() {
  const navigate = useNavigate();
  return (
    <div>
      <div className="px-6 py-4 border-b border-border">
        <p className="text-sm font-semibold">Exportar configuración</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Descarga backups JSON de las tablas de configuración. Incluye registros activos y eliminados, con resolución de boards y conteos por proyecto.
        </p>
      </div>
      <div className="p-5 space-y-4">
        <BackupCard
          table="BoardColumns"
          title="Columnas de tableros"
          description="Todas las columnas definidas en cada board de reclutamiento, PM y calendarios. Incluye tipo, orden, opciones JSON, y estado de eliminación."
        />
        <BackupCard
          table="SharedViews"
          title="Vistas compartidas"
          description="Todas las vistas internas y externas (shared links) con filtros, columnas visibles, tokens de acceso, y configuración de cada vista."
        />
      </div>

      {/* Herramientas de administración */}
      <div className="px-5 pb-5">
        <div className="flex items-center gap-2 mb-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground px-1">
            Herramientas de administración
          </span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <div className="border border-border rounded-xl bg-card overflow-hidden">
          <div className="p-5 flex items-start justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Database className="w-5 h-5 text-primary" />
              </div>
              <div className="space-y-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">Migración UUID de CellValues</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Migra los boardId de legacy a UUID de forma automática y resumable
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate('/admin/migration')}
              className="gap-1.5 flex-shrink-0"
            >
              Abrir Migration Runner
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        <CleanupPJT001Card />
      </div>
    </div>
  );
}

// ── Main Settings Page ────────────────────────────────────────────────────────
export default function SettingsPage() {
  const { user } = useAuth();

  const canAccess = user?.role === 'Owner' || user?.role === 'Socio' ||
    user?.purchaseLevel === 'Socios' ||
    user?.purchaseLevel === 'Finanzas';

  if (!canAccess) {
    return (
      <div className="p-6 flex flex-col items-center justify-center h-full gap-3">
        <div className="w-14 h-14 rounded-2xl bg-destructive/10 flex items-center justify-center">
          <AlertTriangle className="w-7 h-7 text-destructive" />
        </div>
        <div className="text-center">
          <p className="font-semibold">Acceso restringido</p>
          <p className="text-sm text-muted-foreground mt-1">
            Solo administradores y niveles Socios/Finanzas pueden acceder a la configuración.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
          <Settings className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-lg font-bold">Configuración</h1>
          <p className="text-xs text-muted-foreground">Administración del sistema y permisos</p>
        </div>
      </div>

      <Tabs defaultValue="usuarios">
        <TabsList className="mb-6">
          <TabsTrigger value="usuarios" className="gap-2 text-sm">
            <Users className="w-3.5 h-3.5" /> Usuarios
          </TabsTrigger>
          <TabsTrigger value="visibilidad" className="gap-2 text-sm">
            <Eye className="w-3.5 h-3.5" /> Visibilidad de páginas
          </TabsTrigger>
          <TabsTrigger value="limites" className="gap-2 text-sm">
            <Shield className="w-3.5 h-3.5" /> Límites de aprobación
          </TabsTrigger>
          <TabsTrigger value="rubros" className="gap-2 text-sm">
            <Users className="w-3.5 h-3.5" /> Responsables por rubro
          </TabsTrigger>
          <TabsTrigger value="backups" className="gap-2 text-sm">
            <Database className="w-3.5 h-3.5" /> Backups
          </TabsTrigger>
        </TabsList>

        <TabsContent value="usuarios">
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <UsersTab />
          </div>
        </TabsContent>

        <TabsContent value="visibilidad">
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <PageVisibilityTab />
          </div>
        </TabsContent>

        <TabsContent value="limites">
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <ApprovalLimitsTab />
          </div>
        </TabsContent>

        <TabsContent value="rubros">
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <RubroAssignmentsTab />
          </div>
        </TabsContent>

        <TabsContent value="backups">
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <BackupsTab />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
