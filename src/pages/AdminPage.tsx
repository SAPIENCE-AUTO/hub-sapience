import { useState, useEffect, useMemo, Fragment } from 'react';
import { useProject } from '../context/ProjectContext';
import { getAdminData, savePurchaseOrder, deletePurchaseOrder, saveSupplier, fixOrphanedCellValues, GetAdminDataOutputType } from 'zite-endpoints-sdk';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '../components/StatusBadge';
import { Plus, Pencil, Trash2, ChevronRight, ChevronDown, ExternalLink, Building2, ShoppingCart, Wrench, CheckCircle2, Loader2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { useDynamicColumns } from '../hooks/useDynamicColumns';
import { CATEGORIES, CAT_STYLES } from '../lib/constants';
import { DynamicColumnHeaders, DynamicColumnCells } from '../components/DynamicColumns';

type PO = GetAdminDataOutputType['purchaseOrders'][0];
type LineItem = GetAdminDataOutputType['lineItems'][0];
type Supplier = GetAdminDataOutputType['suppliers'][0];

const poStatuses = ['Borrador', 'Enviada a aprobación', 'Aprobada', 'Pagada', 'Cancelada'];



function CategoryBadge({ cat }: { cat: string }) {
  const style = CAT_STYLES[cat] ?? { bg: 'bg-muted', text: 'text-muted-foreground', border: 'border-border' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${style.bg} ${style.text} ${style.border}`}>
      {cat}
    </span>
  );
}

const TAX_REGIMES = [
  'General de Ley Personas Morales', 'RESICO', 'Régimen de Incorporación Fiscal',
  'Actividades Empresariales y Profesionales', 'Sueldos y Salarios',
  'Arrendamiento', 'Sin obligaciones fiscales', 'Otro',
] as const;

const emptySupplier = {
  supplierName: '', identifier: '', taxId: '', taxRegime: '', personType: '',
  address: '', country: '', contactName: '', email: '', phone: '',
  bankName: '', bankAccount: '', notes: '', categories: [] as string[],
};

function LineItemsExpanded({ po, lineItems }: { po: PO; lineItems: LineItem[] }) {
  const poItems = lineItems.filter(i => i.poId === po.id);
  const total = poItems.reduce((s, i) => s + (i.total ?? 0), 0);
  return (
    <div className="px-6 py-4 bg-muted/10">
      {po.notes && <p className="text-xs text-muted-foreground mb-3 italic">{po.notes}</p>}
      <table className="w-full text-xs">
        <thead><tr className="border-b text-muted-foreground">
          <th className="text-left py-1.5 pr-4">Descripción</th>
          <th className="text-left py-1.5 pr-4">Categoría</th>
          <th className="text-right py-1.5 pr-4 w-16">Cant.</th>
          <th className="text-right py-1.5 pr-4 w-24">Precio Unit.</th>
          <th className="text-right py-1.5 w-24">Total</th>
        </tr></thead>
        <tbody>
          {poItems.filter(i => !i.parentItemId).map(item => (
            <Fragment key={item.id}>
              <tr className="border-b border-border/40">
                <td className="py-1.5 pr-4 font-medium">{item.description}</td>
                <td className="py-1.5 pr-4 text-muted-foreground">{item.category}</td>
                <td className="py-1.5 pr-4 text-right">{item.quantity}</td>
                <td className="py-1.5 pr-4 text-right">{item.unitPrice != null ? `$${item.unitPrice.toLocaleString()}` : '—'}</td>
                <td className="py-1.5 text-right font-medium">{item.total != null ? `$${item.total.toLocaleString()}` : '—'}</td>
              </tr>
              {poItems.filter(c => c.parentItemId === item.id).map(child => (
                <tr key={child.id} className="border-b border-border/20 text-muted-foreground">
                  <td className="py-1 pr-4 pl-5">↳ {child.description}</td>
                  <td className="py-1 pr-4">{child.category}</td>
                  <td className="py-1 pr-4 text-right">{child.quantity}</td>
                  <td className="py-1 pr-4 text-right">{child.unitPrice != null ? `$${child.unitPrice.toLocaleString()}` : '—'}</td>
                  <td className="py-1 text-right">{child.total != null ? `$${child.total.toLocaleString()}` : '—'}</td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
        <tfoot><tr>
          <td colSpan={4} className="text-right py-2 font-bold pr-4 text-sm">TOTAL:</td>
          <td className="text-right font-black text-primary py-2">${total.toLocaleString()}</td>
        </tr></tfoot>
      </table>
    </div>
  );
}

function SuppliersTab({ suppliers, onEdit, onNew }: {
  suppliers: Supplier[];
  onEdit: (s: Supplier) => void;
  onNew: () => void;
}) {
  const [filterCat, setFilterCat] = useState<string>('all');

  const filtered = useMemo(() => {
    if (filterCat === 'all') return suppliers;
    return suppliers.filter(s => (s.categories ?? []).includes(filterCat));
  }, [suppliers, filterCat]);

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground mr-1">Filtrar por rubro:</span>
        <button
          onClick={() => setFilterCat('all')}
          className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${filterCat === 'all' ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-muted-foreground border-border hover:border-primary'}`}
        >
          Todos ({suppliers.length})
        </button>
        {CATEGORIES.map(cat => {
          const count = suppliers.filter(s => (s.categories ?? []).includes(cat)).length;
          const style = CAT_STYLES[cat];
          const active = filterCat === cat;
          return (
            <button
              key={cat}
              onClick={() => setFilterCat(cat)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${active ? `${style.bg} ${style.text} ${style.border}` : 'bg-card text-muted-foreground border-border hover:border-primary'}`}
            >
              {cat} ({count})
            </button>
          );
        })}
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center bg-card border rounded-xl">
          <Building2 className="w-12 h-12 text-muted-foreground/40 mb-4" />
          <p className="text-base font-semibold text-foreground mb-1">
            {filterCat === 'all' ? 'No hay proveedores aún' : `Sin proveedores en "${filterCat}"`}
          </p>
          <p className="text-sm text-muted-foreground mb-4">
            {filterCat === 'all' ? 'Agrega tu primer proveedor para comenzar.' : 'Prueba con otro filtro o agrega un proveedor a esta categoría.'}
          </p>
          {filterCat === 'all' && (
            <Button onClick={onNew} className="gap-2"><Plus className="w-4 h-4" /> Nuevo proveedor</Button>
          )}
        </div>
      ) : (
        <div className="bg-card border rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold">Proveedor</th>
                <th className="text-left px-4 py-3 text-xs font-semibold">Rubros</th>
                <th className="text-left px-4 py-3 text-xs font-semibold">RFC / Tax ID</th>
                <th className="text-left px-4 py-3 text-xs font-semibold">Contacto</th>
                <th className="text-left px-4 py-3 text-xs font-semibold">Email</th>
                <th className="text-center px-4 py-3 text-xs font-semibold"># OCs</th>
                <th className="text-right px-4 py-3 text-xs font-semibold">Monto total</th>
                <th className="px-4 py-3 text-xs font-semibold w-16"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map(s => (
                <tr key={s.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-semibold">{s.supplierName}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1 max-w-[220px]">
                      {(s.categories ?? []).length > 0
                        ? (s.categories ?? []).map(cat => <CategoryBadge key={cat} cat={cat} />)
                        : <span className="text-xs text-muted-foreground">—</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{s.taxId || '—'}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{s.contactName || '—'}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{s.email || '—'}</td>
                  <td className="px-4 py-3 text-center">
                    <div className="inline-flex items-center gap-1 text-xs font-medium">
                      <ShoppingCart className="w-3 h-3 text-muted-foreground" />
                      {s.poCount}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={`text-sm font-bold ${s.totalSpent > 0 ? 'text-primary' : 'text-muted-foreground'}`}>
                      {s.totalSpent > 0 ? `$${s.totalSpent.toLocaleString()}` : '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onEdit(s)}>
                      <Pencil className="w-3 h-3" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SupplierDialog({ open, onOpenChange, editing, form, setForm, onSave, saving }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: Supplier | null;
  form: typeof emptySupplier;
  setForm: React.Dispatch<React.SetStateAction<typeof emptySupplier>>;
  onSave: () => void;
  saving: boolean;
}) {
  const f = (field: keyof typeof emptySupplier) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(prev => ({ ...prev, [field]: e.target.value }));
  const toggleCat = (cat: string) =>
    setForm(prev => ({ ...prev, categories: prev.categories.includes(cat) ? prev.categories.filter(c => c !== cat) : [...prev.categories, cat] }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{editing ? 'Editar proveedor' : 'Nuevo proveedor'}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-4 py-1">
          <div className="col-span-2 space-y-1.5"><Label>Nombre o razón social</Label><Input value={form.supplierName} onChange={f('supplierName')} placeholder="Nombre o razón social" /></div>
          <div className="space-y-1.5"><Label>Identificador / Screen name</Label><Input value={form.identifier} onChange={f('identifier')} placeholder="@nombre o alias" /></div>
          <div className="space-y-1.5"><Label>RFC</Label><Input value={form.taxId} onChange={f('taxId')} placeholder="XAXX010101000" /></div>
          <div className="space-y-1.5"><Label>Régimen fiscal</Label>
            <Select value={form.taxRegime} onValueChange={v => setForm(p => ({ ...p, taxRegime: v }))}>
              <SelectTrigger><SelectValue placeholder="Seleccionar régimen" /></SelectTrigger>
              <SelectContent>{TAX_REGIMES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Tipo de persona</Label>
            <Select value={form.personType} onValueChange={v => setForm(p => ({ ...p, personType: v }))}>
              <SelectTrigger><SelectValue placeholder="Seleccionar tipo" /></SelectTrigger>
              <SelectContent><SelectItem value="Física">Física</SelectItem><SelectItem value="Moral">Moral</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>País</Label><Input value={form.country} onChange={f('country')} placeholder="México" /></div>
          <div className="space-y-1.5"><Label>Teléfono</Label><Input value={form.phone} onChange={f('phone')} placeholder="+52 55 0000 0000" /></div>
          <div className="space-y-1.5"><Label>Correo electrónico</Label><Input type="email" value={form.email} onChange={f('email')} placeholder="correo@empresa.com" /></div>
          <div className="space-y-1.5"><Label>Nombre de contacto</Label><Input value={form.contactName} onChange={f('contactName')} placeholder="Nombre del responsable" /></div>
          <div className="col-span-2 space-y-1.5"><Label>Dirección</Label><Textarea rows={2} value={form.address} onChange={f('address')} placeholder="Calle, número, colonia, ciudad, CP" /></div>
          <div className="space-y-1.5"><Label>Banco</Label><Input value={form.bankName} onChange={f('bankName')} /></div>
          <div className="space-y-1.5"><Label>Cuenta bancaria</Label><Input value={form.bankAccount} onChange={f('bankAccount')} /></div>
          <div className="col-span-2 space-y-2">
            <Label>Rubros</Label>
            <div className="grid grid-cols-2 gap-2">
              {CATEGORIES.map(cat => {
                const style = CAT_STYLES[cat];
                const checked = form.categories.includes(cat);
                return (
                  <label key={cat} className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${checked ? `${style.bg} ${style.border}` : 'border-border hover:bg-muted/30'}`}>
                    <Checkbox checked={checked} onCheckedChange={() => toggleCat(cat)} />
                    <span className={`text-sm font-medium ${checked ? style.text : 'text-foreground'}`}>{cat}</span>
                  </label>
                );
              })}
            </div>
          </div>
          <div className="col-span-2 space-y-1.5"><Label>Notas</Label><Textarea rows={2} value={form.notes} onChange={f('notes')} /></div>
        </div>
        <DialogFooter className="mt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={onSave} disabled={saving}>{saving ? 'Guardando...' : 'Guardar proveedor'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const ORPHAN_TASKS = [
  { oldCode: 'DOS DOS', newCode: 'PRUEBA – DOS DOS', label: 'DOS DOS → PRUEBA – DOS DOS (reclutamiento)' },
  { oldCode: 'NEW NEWS', newCode: 'PRUEBA NEW NEWS', label: 'NEW NEWS → PRUEBA NEW NEWS (reclutamiento)' },
];

function MaintenanceTab() {
  const [taskState, setTaskState] = useState<Record<string, { running: boolean; done: boolean; total: number }>>({});

  const runFix = async (oldCode: string, newCode: string, key: string) => {
    setTaskState(prev => ({ ...prev, [key]: { running: true, done: false, total: 0 } }));
    let totalFixed = 0;
    let done = false;
    while (!done) {
      try {
        const res = await fixOrphanedCellValues({ oldCode, newCode, maxPages: 5 });
        totalFixed += res.fixedThisRun;
        done = res.done;
        setTaskState(prev => ({ ...prev, [key]: { running: !done, done, total: totalFixed } }));
        if (!done) await new Promise(r => setTimeout(r, 1500));
      } catch {
        toast.error(`Error reparando ${oldCode}`);
        setTaskState(prev => ({ ...prev, [key]: { running: false, done: false, total: totalFixed } }));
        break;
      }
    }
    if (done) toast.success(`${key}: ${totalFixed} celdas reparadas`);
  };

  return (
    <div className="max-w-xl space-y-4">
      <div className="rounded-xl border bg-card p-5">
        <div className="flex items-center gap-2 mb-1">
          <Wrench className="w-4 h-4 text-muted-foreground" />
          <h3 className="font-semibold text-sm">Reparar CellValues huérfanos</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Actualiza los <code>boardId</code> de CellValues de reclutamiento que aún tienen el código de proyecto antiguo. Puede tardar varias pasadas.
        </p>
        <div className="space-y-3">
          {ORPHAN_TASKS.map(({ oldCode, newCode, label }) => {
            const key = oldCode;
            const state = taskState[key];
            return (
              <div key={key} className="flex items-center justify-between gap-4 p-3 rounded-lg border bg-muted/30">
                <div>
                  <p className="text-xs font-medium">{label}</p>
                  {state && <p className="text-xs text-muted-foreground mt-0.5">{state.total} celdas reparadas{state.done ? ' · ✓ Completo' : ''}</p>}
                </div>
                <Button
                  size="sm"
                  variant={state?.done ? 'outline' : 'default'}
                  disabled={state?.running}
                  onClick={() => runFix(oldCode, newCode, key)}
                  className="shrink-0 gap-2"
                >
                  {state?.running ? <><Loader2 className="w-3 h-3 animate-spin" /> Reparando...</>
                   : state?.done ? <><CheckCircle2 className="w-3 h-3 text-green-500" /> Completo</>
                   : 'Reparar'}
                </Button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function AdminPage() {
  const { selectedProject } = useProject();
  const [data, setData] = useState<GetAdminDataOutputType>({ purchaseOrders: [], lineItems: [], suppliers: [] });
  const [loading, setLoading] = useState(true);
  const [expandedPOs, setExpandedPOs] = useState<Set<string>>(new Set());
  const [openPO, setOpenPO] = useState(false);
  const [openSupplier, setOpenSupplier] = useState(false);
  const [editingPO, setEditingPO] = useState<PO | null>(null);
  const [deletingPO, setDeletingPO] = useState<string | null>(null);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [saving, setSaving] = useState(false);

  const [poForm, setPOForm] = useState({ projectCode: '', supplierName: '', issueDate: '', totalAmount: undefined as number | undefined, status: 'Borrador', notes: '', lineItems: [] as Array<{ description: string; category: string; quantity: number; unitPrice: number; total: number }> });
  const [supplierForm, setSupplierForm] = useState({ ...emptySupplier });

  const boardId = `admin-${selectedProject ?? 'all'}`;
  const dynCols = useDynamicColumns(boardId);

  const load = () => {
    setLoading(true);
    getAdminData({ projectCode: selectedProject ?? undefined }).then(d => { setData(d); setLoading(false); });
  };
  useEffect(() => { load(); }, [selectedProject]);

  const togglePO = (id: string) => setExpandedPOs(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const newPO = () => {
    setEditingPO(null);
    setPOForm({ projectCode: selectedProject ?? '', supplierName: '', issueDate: new Date().toISOString().split('T')[0], totalAmount: undefined, status: 'Borrador', notes: '', lineItems: [{ description: '', category: '', quantity: 1, unitPrice: 0, total: 0 }] });
    setOpenPO(true);
  };
  const editPO = (po: PO) => {
    setEditingPO(po);
    const items = data.lineItems.filter(i => i.poId === po.id && !i.parentItemId);
    setPOForm({ projectCode: po.projectCode ?? '', supplierName: po.supplierName ?? '', issueDate: po.issueDate ?? '', totalAmount: po.totalAmount, status: po.status ?? 'Borrador', notes: po.notes ?? '', lineItems: items.map(i => ({ description: i.description ?? '', category: i.category ?? '', quantity: i.quantity ?? 1, unitPrice: i.unitPrice ?? 0, total: i.total ?? 0 })) });
    setOpenPO(true);
  };
  const updateLineItem = (idx: number, field: string, value: string | number) => {
    setPOForm(f => {
      const items = [...f.lineItems];
      items[idx] = { ...items[idx], [field]: value };
      if (field === 'quantity' || field === 'unitPrice') items[idx].total = items[idx].quantity * items[idx].unitPrice;
      return { ...f, lineItems: items, totalAmount: items.reduce((s, i) => s + i.total, 0) };
    });
  };
  const savePO = async () => {
    setSaving(true);
    try { await savePurchaseOrder({ ...poForm, id: editingPO?.id, lineItems: poForm.lineItems }); toast.success('ODC guardada'); setOpenPO(false); load(); }
    catch { toast.error('Error al guardar'); }
    setSaving(false);
  };
  const delPO = async () => {
    if (!deletingPO) return;
    await deletePurchaseOrder({ id: deletingPO });
    toast.success('ODC eliminada'); setDeletingPO(null); load();
  };

  const openNewSupplier = () => {
    setEditingSupplier(null);
    setSupplierForm({ ...emptySupplier });
    setOpenSupplier(true);
  };
  const openEditSupplier = (s: Supplier) => {
    setEditingSupplier(s);
    setSupplierForm({
      supplierName: s.supplierName ?? '',
      identifier: s.identifier ?? '',
      taxId: s.taxId ?? '',
      taxRegime: s.taxRegime ?? '',
      personType: s.personType ?? '',
      address: s.address ?? '',
      country: s.country ?? '',
      contactName: s.contactName ?? '',
      email: s.email ?? '',
      phone: s.phone ?? '',
      bankName: s.bankName ?? '',
      bankAccount: s.bankAccount ?? '',
      notes: s.notes ?? '',
      categories: s.categories ?? [],
    });
    setOpenSupplier(true);
  };
  const saveSupp = async () => {
    setSaving(true);
    try { await saveSupplier({ ...supplierForm, id: editingSupplier?.id }); toast.success('Proveedor guardado'); setOpenSupplier(false); load(); }
    catch { toast.error('Error al guardar'); }
    setSaving(false);
  };

  const grouped = useMemo(() => {
    const g: Record<string, PO[]> = {};
    data.purchaseOrders.forEach(po => {
      const k = po.projectCode ?? 'Sin proyecto';
      if (!g[k]) g[k] = [];
      g[k].push(po);
    });
    return g;
  }, [data.purchaseOrders]);

  const totalBudget = data.purchaseOrders.reduce((s, p) => s + (p.totalAmount ?? 0), 0);
  const fixedCols = 7;
  const totalCols = fixedCols + dynCols.columns.length + 2 + 1;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-bold">Administración</h2>
          <p className="text-sm text-muted-foreground">{selectedProject ? `Proyecto: ${selectedProject}` : 'Todas las órdenes'} · Total: <strong>${totalBudget.toLocaleString()}</strong></p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2" onClick={openNewSupplier}><Building2 className="w-4 h-4" /> Proveedor</Button>
          <Button className="gap-2" onClick={newPO}><Plus className="w-4 h-4" /> Nueva ODC</Button>
        </div>
      </div>

      <Tabs defaultValue="orders">
        <TabsList className="mb-4">
          <TabsTrigger value="orders">Órdenes de compra ({data.purchaseOrders.length})</TabsTrigger>
          <TabsTrigger value="suppliers">Proveedores ({data.suppliers.length})</TabsTrigger>
          <TabsTrigger value="maintenance" className="gap-1.5"><Wrench className="w-3.5 h-3.5" /> Mantenimiento</TabsTrigger>
        </TabsList>

        <TabsContent value="orders">
          {loading ? <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div> : (
            <div className="bg-card border rounded-lg overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 sticky top-0 z-10">
                  <tr>
                    <th className="w-8 px-2 py-2.5" />
                    <th className="text-left px-3 py-2.5 text-xs font-semibold whitespace-nowrap">ODC #</th>
                    <th className="text-left px-3 py-2.5 text-xs font-semibold whitespace-nowrap">Proveedor</th>
                    <th className="text-left px-3 py-2.5 text-xs font-semibold whitespace-nowrap">Proyecto</th>
                    <th className="text-left px-3 py-2.5 text-xs font-semibold whitespace-nowrap">Fecha</th>
                    <th className="text-left px-3 py-2.5 text-xs font-semibold whitespace-nowrap">Estado</th>
                    <th className="text-left px-3 py-2.5 text-xs font-semibold whitespace-nowrap">Total</th>
                    <DynamicColumnHeaders dynCols={dynCols} />
                    <th className="px-3 py-2.5 text-xs font-semibold">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(grouped).map(([project, pos]) => (
                    <Fragment key={project}>
                      <tr className="bg-muted/40">
                        <td colSpan={totalCols} className="px-4 py-1.5">
                          <span className="font-bold text-xs uppercase tracking-wider text-muted-foreground">{project}</span>
                          <span className="text-xs text-muted-foreground ml-2">· {pos.length} ODC{pos.length !== 1 ? 's' : ''} · ${pos.reduce((s, p) => s + (p.totalAmount ?? 0), 0).toLocaleString()}</span>
                        </td>
                      </tr>
                      {pos.map(po => (
                        <Fragment key={po.id}>
                          <tr className="hover:bg-muted/30 border-b border-border/50">
                            <td className="px-2 py-2.5">
                              <button onClick={() => togglePO(po.id)} className="text-muted-foreground hover:text-foreground">
                                {expandedPOs.has(po.id) ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                              </button>
                            </td>
                            <td className="px-3 py-2.5 font-bold text-primary text-xs whitespace-nowrap">ODC-{po.poNumber}</td>
                            <td className="px-3 py-2.5 font-medium whitespace-nowrap">{po.supplierName}</td>
                            <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{po.projectCode}</td>
                            <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{po.issueDate ? new Date(po.issueDate).toLocaleDateString() : '—'}</td>
                            <td className="px-3 py-2.5"><StatusBadge status={po.status} /></td>
                            <td className="px-3 py-2.5 font-bold whitespace-nowrap">${(po.totalAmount ?? 0).toLocaleString()}</td>
                            <DynamicColumnCells rowId={po.id} dynCols={dynCols} />
                            <td className="px-3 py-2.5">
                              <div className="flex gap-1">
                                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => editPO(po)}><Pencil className="w-3 h-3" /></Button>
                                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setDeletingPO(po.id)}><Trash2 className="w-3 h-3" /></Button>
                                {po.pdfUrl && <a href={po.pdfUrl} target="_blank" rel="noopener noreferrer"><Button size="icon" variant="ghost" className="h-7 w-7"><ExternalLink className="w-3 h-3" /></Button></a>}
                              </div>
                            </td>
                          </tr>
                          {expandedPOs.has(po.id) && (
                            <tr><td colSpan={totalCols} className="p-0"><LineItemsExpanded po={po} lineItems={data.lineItems} /></td></tr>
                          )}
                        </Fragment>
                      ))}
                    </Fragment>
                  ))}
                  {data.purchaseOrders.length === 0 && (
                    <tr><td colSpan={totalCols} className="px-4 py-16 text-center text-muted-foreground">No hay órdenes de compra aún.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="suppliers">
          {loading ? (
            <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-14 w-full" />)}</div>
          ) : (
            <SuppliersTab suppliers={data.suppliers} onEdit={openEditSupplier} onNew={openNewSupplier} />
          )}
        </TabsContent>

        <TabsContent value="maintenance">
          <MaintenanceTab />
        </TabsContent>
      </Tabs>

      {/* PO Dialog */}
      <Dialog open={openPO} onOpenChange={setOpenPO}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingPO ? `Editar ODC-${editingPO.poNumber}` : 'Nueva Orden de Compra'}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1"><Label>Proyecto</Label><Input value={poForm.projectCode} onChange={e => setPOForm(f => ({ ...f, projectCode: e.target.value.toUpperCase() }))} /></div>
            <div className="space-y-1"><Label>Proveedor</Label>
              <Select value={poForm.supplierName} onValueChange={v => setPOForm(f => ({ ...f, supplierName: v }))}>
                <SelectTrigger><SelectValue placeholder="Seleccionar proveedor" /></SelectTrigger>
                <SelectContent>{data.suppliers.map(s => <SelectItem key={s.id} value={s.supplierName ?? ''}>{s.supplierName}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Fecha</Label><Input type="date" value={poForm.issueDate} onChange={e => setPOForm(f => ({ ...f, issueDate: e.target.value }))} /></div>
            <div className="space-y-1"><Label>Estado</Label>
              <Select value={poForm.status} onValueChange={v => setPOForm(f => ({ ...f, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{poStatuses.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-1"><Label>Notas</Label><Textarea rows={2} value={poForm.notes} onChange={e => setPOForm(f => ({ ...f, notes: e.target.value }))} /></div>
          </div>
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <Label className="text-sm font-semibold">Ítems / Rubros</Label>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setPOForm(f => ({ ...f, lineItems: [...f.lineItems, { description: '', category: '', quantity: 1, unitPrice: 0, total: 0 }] }))}>+ Ítem</Button>
            </div>
            <table className="w-full text-xs">
              <thead><tr className="border-b text-muted-foreground"><th className="text-left py-1.5 pr-2">Descripción</th><th className="text-left py-1.5 pr-2">Categoría</th><th className="text-right py-1.5 pr-2 w-16">Cant.</th><th className="text-right py-1.5 pr-2 w-24">Precio</th><th className="text-right py-1.5 w-24">Total</th><th className="w-8" /></tr></thead>
              <tbody>
                {poForm.lineItems.map((item, idx) => (
                  <tr key={idx} className="border-b border-border/50">
                    <td className="pr-2 py-1"><Input className="h-7 text-xs" value={item.description} onChange={e => updateLineItem(idx, 'description', e.target.value)} /></td>
                    <td className="pr-2 py-1"><Input className="h-7 text-xs" value={item.category} onChange={e => updateLineItem(idx, 'category', e.target.value)} /></td>
                    <td className="pr-2 py-1"><Input className="h-7 text-xs text-right" type="number" value={item.quantity} onChange={e => updateLineItem(idx, 'quantity', Number(e.target.value))} /></td>
                    <td className="pr-2 py-1"><Input className="h-7 text-xs text-right" type="number" value={item.unitPrice} onChange={e => updateLineItem(idx, 'unitPrice', Number(e.target.value))} /></td>
                    <td className="py-1 text-right font-medium pr-2">${item.total.toLocaleString()}</td>
                    <td className="py-1"><Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => setPOForm(f => ({ ...f, lineItems: f.lineItems.filter((_, i) => i !== idx), totalAmount: f.lineItems.filter((_, i) => i !== idx).reduce((s, i) => s + i.total, 0) }))}><Trash2 className="w-3 h-3" /></Button></td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={4} className="text-right py-2 font-bold pr-2">TOTAL:</td><td className="text-right font-black text-primary py-2">${(poForm.totalAmount ?? 0).toLocaleString()}</td><td /></tr></tfoot>
            </table>
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setOpenPO(false)}>Cancelar</Button>
            <Button onClick={savePO} disabled={saving}>{saving ? 'Guardando...' : 'Guardar ODC'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SupplierDialog
        open={openSupplier}
        onOpenChange={setOpenSupplier}
        editing={editingSupplier}
        form={supplierForm}
        setForm={setSupplierForm}
        onSave={saveSupp}
        saving={saving}
      />

      <AlertDialog open={!!deletingPO} onOpenChange={o => !o && setDeletingPO(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>¿Eliminar ODC?</AlertDialogTitle><AlertDialogDescription>Se eliminarán todos los ítems de esta orden.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={delPO} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Eliminar</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
