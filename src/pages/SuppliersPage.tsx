import { useState, useEffect, useMemo } from 'react';
import { getAdminData, saveSupplier, GetAdminDataOutputType, generateSupplierToken } from 'zite-endpoints-sdk';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import { Building2, Plus, Pencil, ShoppingCart, Mail, Phone, MapPin, Landmark, FileText, Tag, Link2, Copy, RefreshCw, ExternalLink, GitMerge, Search, X } from 'lucide-react';
import SupplierDuplicatesDialog from '@/components/SupplierDuplicatesDialog';
import { CATEGORIES, CAT_STYLES } from '../lib/constants';

type Supplier = GetAdminDataOutputType['suppliers'][0];

const emptyForm = {
  supplierName: '', identifier: '', taxId: '', taxRegime: '', personType: '',
  address: '', country: '', contactName: '', email: '', phone: '',
  bankName: '', bankAccount: '', notes: '', categories: [] as string[],
};
type FormData = typeof emptyForm & { id?: string };

const TAX_REGIMES = [
  'General de Ley Personas Morales', 'RESICO', 'Régimen de Incorporación Fiscal',
  'Actividades Empresariales y Profesionales', 'Sueldos y Salarios', 'Arrendamiento',
  'Sin obligaciones fiscales', 'Otro',
] as const;



// ── Helpers ───────────────────────────────────────────────────────────────────
function CategoryBadge({ cat }: { cat: string }) {
  const style = CAT_STYLES[cat] ?? { bg: 'bg-muted', text: 'text-muted-foreground', border: 'border-border' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${style.bg} ${style.text} ${style.border}`}>
      {cat}
    </span>
  );
}

function PersonTypeBadge({ type }: { type?: string }) {
  if (!type) return null;
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${type === 'Física' ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-purple-100 text-purple-700 border-purple-200'}`}>
      {type}
    </span>
  );
}

function DetailRow({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
      {value
        ? <p className={`text-sm font-medium ${mono ? 'font-mono' : ''}`}>{value}</p>
        : <p className="text-sm text-muted-foreground italic">—</p>}
    </div>
  );
}

function SectionTitle({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="w-3.5 h-3.5 text-muted-foreground" />
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
    </div>
  );
}

// ── Portal Access Dialog ──────────────────────────────────────────────────────
function PortalAccessDialog({ supplier, open, onOpenChange, onRefresh }: {
  supplier: Supplier | null; open: boolean; onOpenChange: (v: boolean) => void; onRefresh: () => void;
}) {
  const [generating, setGenerating] = useState(false);
  const [localToken, setLocalToken] = useState<string | null>(null);
  const [localPw, setLocalPw] = useState<string | null>(null);

  useEffect(() => { if (open) { setLocalToken(null); setLocalPw(null); } }, [open]);

  const token = localToken ?? supplier?.accessToken ?? '';
  const pw = localPw ?? supplier?.portalPassword ?? '';
  const hasAccess = !!(supplier?.accessToken || localToken);
  const portalUrl = token ? `${window.location.origin}/portal/${token}` : '';

  const handleGenerate = async () => {
    if (!supplier) return;
    setGenerating(true);
    try {
      const result = await generateSupplierToken({ supplierId: supplier.id });
      setLocalToken(result.token);
      setLocalPw(result.password);
      toast.success('Acceso generado correctamente');
      onRefresh();
    } catch { toast.error('Error al generar el acceso'); }
    finally { setGenerating(false); }
  };

  const copy = (text: string, label: string) =>
    navigator.clipboard.writeText(text).then(() => toast.success(`${label} copiado`));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="w-4 h-4" /> Portal de proveedor — {supplier?.supplierName}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {!hasAccess ? (
            <div className="text-center py-4 space-y-3">
              <div className="w-12 h-12 bg-muted rounded-xl flex items-center justify-center mx-auto">
                <Link2 className="w-6 h-6 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">Este proveedor aún no tiene acceso al portal.</p>
              <Button onClick={handleGenerate} disabled={generating} className="gap-2">
                <Link2 className="w-4 h-4" />{generating ? 'Generando...' : 'Generar acceso al portal'}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Link del portal</label>
                <div className="flex gap-2">
                  <div className="flex-1 min-w-0 bg-muted rounded-lg px-3 py-2 text-xs font-mono truncate">{portalUrl}</div>
                  <Button size="icon" variant="outline" className="h-9 w-9 shrink-0" onClick={() => copy(portalUrl, 'Link')}><Copy className="w-3.5 h-3.5" /></Button>
                  <a href={portalUrl} target="_blank" rel="noopener noreferrer">
                    <Button size="icon" variant="outline" className="h-9 w-9 shrink-0"><ExternalLink className="w-3.5 h-3.5" /></Button>
                  </a>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Clave de acceso</label>
                <div className="flex gap-2">
                  <div className="flex-1 min-w-0 bg-muted rounded-lg px-3 py-2 text-sm font-mono tracking-widest truncate">{pw}</div>
                  <Button size="icon" variant="outline" className="h-9 w-9 shrink-0" onClick={() => copy(pw, 'Clave')}><Copy className="w-3.5 h-3.5" /></Button>
                </div>
              </div>
              <div className="pt-2 border-t">
                <Button variant="outline" size="sm" className="gap-2 text-muted-foreground" onClick={handleGenerate} disabled={generating}>
                  <RefreshCw className="w-3.5 h-3.5" />{generating ? 'Regenerando...' : 'Regenerar acceso'}
                </Button>
                <p className="text-xs text-muted-foreground mt-1.5">Al regenerar, el link y clave anterior dejarán de funcionar.</p>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Unified Supplier Dialog ───────────────────────────────────────────────────
function SupplierDialog({ supplier, open, onOpenChange, initialMode, onSaved, onPortal }: {
  supplier: Supplier | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialMode: 'view' | 'edit';
  onSaved: (data: FormData) => void;
  onPortal: () => void;
}) {
  const [mode, setMode] = useState<'view' | 'edit'>(initialMode);
  const [form, setForm] = useState({ ...emptyForm });

  useEffect(() => {
    if (open) {
      setMode(initialMode);
      setForm(supplier ? {
        supplierName: supplier.supplierName ?? '',
        identifier: supplier.identifier ?? '',
        taxId: supplier.taxId ?? '',
        taxRegime: supplier.taxRegime ?? '',
        personType: supplier.personType ?? '',
        address: supplier.address ?? '',
        country: supplier.country ?? '',
        contactName: supplier.contactName ?? '',
        email: supplier.email ?? '',
        phone: supplier.phone ?? '',
        bankName: supplier.bankName ?? '',
        bankAccount: supplier.bankAccount ?? '',
        notes: supplier.notes ?? '',
        categories: supplier.categories ?? [],
      } : { ...emptyForm });
    }
  }, [open, supplier, initialMode]);

  const f = (field: keyof typeof emptyForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(prev => ({ ...prev, [field]: e.target.value }));

  const toggleCat = (cat: string) =>
    setForm(prev => ({
      ...prev,
      categories: prev.categories.includes(cat)
        ? prev.categories.filter(c => c !== cat)
        : [...prev.categories, cat],
    }));

  const handleSave = () => {
    const data: FormData = { ...form, id: supplier?.id };
    onOpenChange(false);
    onSaved(data);
    toast.success(supplier?.id ? 'Proveedor actualizado' : 'Proveedor creado');
    saveSupplier({ ...form, id: supplier?.id }).catch(() => {
      toast.error('Error al guardar. Los cambios pueden no haberse guardado.');
    });
  };

  const handleCancel = () => {
    if (initialMode === 'edit' || !supplier) {
      onOpenChange(false);
    } else {
      setMode('view');
    }
  };

  const cats = supplier?.categories ?? form.categories;
  const isNew = !supplier;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col p-0 gap-0">
        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
              <Building2 className="w-5 h-5 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <DialogTitle className="text-base font-bold leading-tight">
                  {isNew ? 'Nuevo proveedor' : (supplier.supplierName || 'Sin nombre')}
                </DialogTitle>
                {!isNew && mode === 'view' && <PersonTypeBadge type={supplier.personType} />}
                {mode === 'edit' && !isNew && (
                  <span className="text-xs text-muted-foreground font-normal">— editando</span>
                )}
              </div>
              {!isNew && mode === 'view' && supplier.identifier && (
                <p className="text-sm text-muted-foreground mt-0.5">{supplier.identifier}</p>
              )}
            </div>
          </div>
        </DialogHeader>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {mode === 'view' && supplier ? (
            // ── VIEW MODE ────────────────────────────────────────────────────
            <div className="space-y-6">
              <div>
                <SectionTitle icon={Tag} label="Rubros" />
                {(supplier.categories ?? []).length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {(supplier.categories ?? []).map(cat => <CategoryBadge key={cat} cat={cat} />)}
                  </div>
                ) : <p className="text-sm text-muted-foreground italic">Sin rubros asignados</p>}
              </div>

              <Separator />

              <div>
                <SectionTitle icon={FileText} label="Datos fiscales" />
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <DetailRow label="RFC" value={supplier.taxId} mono />
                  <DetailRow label="Tipo de persona" value={supplier.personType} />
                  <div className="col-span-2"><DetailRow label="Régimen fiscal" value={supplier.taxRegime} /></div>
                  <DetailRow label="País" value={supplier.country} />
                </div>
              </div>

              <Separator />

              <div>
                <SectionTitle icon={Phone} label="Contacto" />
                <div className="space-y-3">
                  <DetailRow label="Nombre de contacto" value={supplier.contactName} />
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Correo electrónico</p>
                    {supplier.email
                      ? <a href={`mailto:${supplier.email}`} className="text-sm font-medium text-primary hover:underline flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" />{supplier.email}</a>
                      : <p className="text-sm text-muted-foreground italic">—</p>}
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Teléfono</p>
                    {supplier.phone
                      ? <a href={`tel:${supplier.phone}`} className="text-sm font-medium text-primary hover:underline flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" />{supplier.phone}</a>
                      : <p className="text-sm text-muted-foreground italic">—</p>}
                  </div>
                  {supplier.address && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Dirección</p>
                      <div className="flex items-start gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                        <p className="text-sm leading-relaxed">{supplier.address}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <Separator />

              <div>
                <SectionTitle icon={Landmark} label="Datos bancarios" />
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <DetailRow label="Banco" value={supplier.bankName} />
                  <DetailRow label="Cuenta / CLABE" value={supplier.bankAccount} mono />
                </div>
              </div>

              <Separator />

              <div>
                <SectionTitle icon={ShoppingCart} label="Actividad" />
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-muted/50 rounded-xl p-3.5 text-center">
                    <p className="text-2xl font-black text-foreground">{supplier.poCount}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Órdenes de compra</p>
                  </div>
                  <div className="bg-muted/50 rounded-xl p-3.5 text-center">
                    <p className={`text-2xl font-black ${supplier.totalSpent > 0 ? 'text-primary' : 'text-muted-foreground'}`}>
                      {supplier.totalSpent > 0 ? `$${supplier.totalSpent.toLocaleString()}` : '$0'}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">Monto total</p>
                  </div>
                </div>
              </div>

              {supplier.notes && (
                <>
                  <Separator />
                  <div>
                    <SectionTitle icon={FileText} label="Notas" />
                    <div className="bg-muted/40 rounded-lg p-3 text-sm leading-relaxed whitespace-pre-wrap">{supplier.notes}</div>
                  </div>
                </>
              )}
            </div>
          ) : (
            // ── EDIT MODE ────────────────────────────────────────────────────
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 space-y-1.5">
                <Label>Nombre o razón social</Label>
                <Input value={form.supplierName} onChange={f('supplierName')} placeholder="Nombre o razón social" />
              </div>
              <div className="space-y-1.5">
                <Label>Identificador / Screen name</Label>
                <Input value={form.identifier} onChange={f('identifier')} placeholder="@nombre o alias" />
              </div>
              <div className="space-y-1.5">
                <Label>RFC</Label>
                <Input value={form.taxId} onChange={f('taxId')} placeholder="XAXX010101000" />
              </div>
              <div className="space-y-1.5">
                <Label>Régimen fiscal</Label>
                <Select value={form.taxRegime} onValueChange={v => setForm(p => ({ ...p, taxRegime: v }))}>
                  <SelectTrigger><SelectValue placeholder="Seleccionar régimen" /></SelectTrigger>
                  <SelectContent>{TAX_REGIMES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Tipo de persona</Label>
                <Select value={form.personType} onValueChange={v => setForm(p => ({ ...p, personType: v }))}>
                  <SelectTrigger><SelectValue placeholder="Seleccionar tipo" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Física">Física</SelectItem>
                    <SelectItem value="Moral">Moral</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>País</Label>
                <Input value={form.country} onChange={f('country')} placeholder="México" />
              </div>
              <div className="space-y-1.5">
                <Label>Teléfono</Label>
                <Input value={form.phone} onChange={f('phone')} placeholder="+52 55 0000 0000" />
              </div>
              <div className="space-y-1.5">
                <Label>Correo electrónico</Label>
                <Input type="email" value={form.email} onChange={f('email')} placeholder="correo@empresa.com" />
              </div>
              <div className="space-y-1.5">
                <Label>Nombre de contacto</Label>
                <Input value={form.contactName} onChange={f('contactName')} placeholder="Nombre del responsable" />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Dirección</Label>
                <Textarea rows={2} value={form.address} onChange={f('address')} placeholder="Calle, número, colonia, ciudad, CP" />
              </div>
              <div className="space-y-1.5">
                <Label>Banco</Label>
                <Input value={form.bankName} onChange={f('bankName')} placeholder="BBVA, Santander…" />
              </div>
              <div className="space-y-1.5">
                <Label>Cuenta bancaria</Label>
                <Input value={form.bankAccount} onChange={f('bankAccount')} placeholder="Número de cuenta o CLABE" />
              </div>
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
              <div className="col-span-2 space-y-1.5">
                <Label>Notas</Label>
                <Textarea rows={2} value={form.notes} onChange={f('notes')} placeholder="Comentarios adicionales" />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <DialogFooter className="px-6 py-4 border-t shrink-0">
          {mode === 'view' ? (
            <div className="flex gap-2 w-full">
              <Button variant="outline" className="flex-1 gap-2" onClick={onPortal}>
                <Link2 className="w-4 h-4" /> Portal
              </Button>
              <Button className="flex-1 gap-2" onClick={() => setMode('edit')}>
                <Pencil className="w-4 h-4" /> Editar
              </Button>
            </div>
          ) : (
            <div className="flex gap-2 w-full justify-end">
              <Button variant="outline" onClick={handleCancel}>
                {initialMode === 'edit' || !supplier ? 'Cancelar' : 'Volver'}
              </Button>
              <Button onClick={handleSave}>Guardar proveedor</Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCat, setFilterCat] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [openDuplicates, setOpenDuplicates] = useState(false);
  const [openPortal, setOpenPortal] = useState(false);
  const [openSupplier, setOpenSupplier] = useState(false);
  const [supplierMode, setSupplierMode] = useState<'view' | 'edit'>('view');
  const [activeSupplier, setActiveSupplier] = useState<Supplier | null>(null);

  const load = (silent = false) => {
    if (!silent) setLoading(true);
    getAdminData({}).then(d => { setSuppliers(d.suppliers); if (!silent) setLoading(false); });
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return suppliers.filter(s => {
      const matchesCat = filterCat === 'all' || (s.categories ?? []).includes(filterCat);
      if (!matchesCat) return false;
      if (!q) return true;
      return [s.supplierName, s.identifier, s.taxId, s.email, s.phone, s.contactName, s.notes, s.bankAccount]
        .some(field => field?.toLowerCase().includes(q));
    });
  }, [suppliers, filterCat, searchQuery]);

  const openView = (s: Supplier) => { setActiveSupplier(s); setSupplierMode('view'); setOpenSupplier(true); };
  const openEdit = (s: Supplier, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setActiveSupplier(s);
    setSupplierMode('edit');
    setOpenSupplier(true);
  };
  const openNew = () => { setActiveSupplier(null); setSupplierMode('edit'); setOpenSupplier(true); };
  const openPortalFor = () => { setOpenSupplier(false); setOpenPortal(true); };

  const handleSaved = (data: FormData) => {
    if (data.id) {
      setSuppliers(prev => prev.map(s => s.id === data.id ? { ...s, ...data, id: s.id } : s));
      setActiveSupplier(prev => {
        if (!prev || prev.id !== data.id) return prev;
        return { ...prev, ...data, id: prev.id, poCount: prev.poCount, totalSpent: prev.totalSpent };
      });
    } else {
      const tempId = `temp-${Date.now()}`;
      const newSupplier: Supplier = {
        id: tempId, supplierName: data.supplierName, identifier: data.identifier,
        taxId: data.taxId, taxRegime: data.taxRegime, personType: data.personType,
        address: data.address, country: data.country, contactName: data.contactName,
        email: data.email, phone: data.phone, bankName: data.bankName,
        bankAccount: data.bankAccount, notes: data.notes, categories: data.categories,
        poCount: 0, totalSpent: 0, accessToken: undefined, portalPassword: undefined,
      };
      setSuppliers(prev => [newSupplier, ...prev]);
    }
    setTimeout(() => load(true), 1500);
  };

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <Toaster />

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">Proveedores</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {loading ? 'Cargando...' : (searchQuery.trim() || filterCat !== 'all')
              ? `${filtered.length} de ${suppliers.length} proveedores`
              : `${suppliers.length} proveedor${suppliers.length !== 1 ? 'es' : ''} registrado${suppliers.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Buscar proveedor..."
              className="pl-8 pr-8 h-9 w-[300px] text-sm"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <Button variant="outline" className="gap-2" onClick={() => setOpenDuplicates(true)}>
            <GitMerge className="w-4 h-4" /> Buscar duplicados
          </Button>
          <Button className="gap-2" onClick={openNew}>
            <Plus className="w-4 h-4" /> Nuevo proveedor
          </Button>
        </div>
      </div>

      {/* Filter pills */}
      {!loading && suppliers.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-xs font-medium text-muted-foreground">Filtrar por rubro:</span>
          <button onClick={() => setFilterCat('all')} className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${filterCat === 'all' ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-muted-foreground border-border hover:border-primary'}`}>
            Todos ({suppliers.length})
          </button>
          {CATEGORIES.map(cat => {
            const count = suppliers.filter(s => (s.categories ?? []).includes(cat)).length;
            if (count === 0) return null;
            const style = CAT_STYLES[cat];
            const active = filterCat === cat;
            return (
              <button key={cat} onClick={() => setFilterCat(cat)} className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${active ? `${style.bg} ${style.text} ${style.border}` : 'bg-card text-muted-foreground border-border hover:border-primary'}`}>
                {cat} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="space-y-2">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center bg-card border rounded-xl">
          <Building2 className="w-14 h-14 text-muted-foreground/30 mb-4" />
          <p className="text-base font-semibold mb-1">
            {filterCat === 'all' ? 'No hay proveedores aún' : `Sin proveedores en "${filterCat}"`}
          </p>
          <p className="text-sm text-muted-foreground mb-5">
            {filterCat === 'all' ? 'Agrega tu primer proveedor para comenzar.' : 'Prueba con otro filtro.'}
          </p>
          {filterCat === 'all'
            ? <Button onClick={openNew} className="gap-2"><Plus className="w-4 h-4" /> Nuevo proveedor</Button>
            : <Button variant="outline" onClick={() => setFilterCat('all')}>Ver todos</Button>}
        </div>
      ) : (
        <div className="bg-card border rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold whitespace-nowrap">Nombre / Razón social</th>
                <th className="text-left px-4 py-3 text-xs font-semibold whitespace-nowrap">Identificador</th>
                <th className="text-left px-4 py-3 text-xs font-semibold whitespace-nowrap">RFC</th>
                <th className="text-left px-4 py-3 text-xs font-semibold whitespace-nowrap">Régimen fiscal</th>
                <th className="text-left px-4 py-3 text-xs font-semibold whitespace-nowrap">Tipo</th>
                <th className="text-left px-4 py-3 text-xs font-semibold whitespace-nowrap">País</th>
                <th className="text-left px-4 py-3 text-xs font-semibold whitespace-nowrap">Rubros</th>
                <th className="text-left px-4 py-3 text-xs font-semibold whitespace-nowrap">Email</th>
                <th className="text-left px-4 py-3 text-xs font-semibold whitespace-nowrap">Teléfono</th>
                <th className="text-center px-4 py-3 text-xs font-semibold whitespace-nowrap"># OCs</th>
                <th className="text-right px-4 py-3 text-xs font-semibold whitespace-nowrap">Monto total</th>
                <th className="px-4 py-3 w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map(s => (
                <tr key={s.id} className="hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => openView(s)}>
                  <td className="px-4 py-3 font-semibold whitespace-nowrap">{s.supplierName || '—'}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{s.identifier || '—'}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap font-mono">{s.taxId || '—'}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground max-w-[180px]">
                    <span className="truncate block" title={s.taxRegime}>{s.taxRegime || '—'}</span>
                  </td>
                  <td className="px-4 py-3 text-xs whitespace-nowrap">
                    {s.personType ? (
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${s.personType === 'Física' ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-purple-100 text-purple-700 border-purple-200'}`}>
                        {s.personType}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{s.country || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1 min-w-[120px] max-w-[200px]">
                      {(s.categories ?? []).length > 0
                        ? (s.categories ?? []).map(cat => <CategoryBadge key={cat} cat={cat} />)
                        : <span className="text-xs text-muted-foreground">—</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{s.email || '—'}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{s.phone || '—'}</td>
                  <td className="px-4 py-3 text-center">
                    <div className="inline-flex items-center gap-1 text-xs font-medium">
                      <ShoppingCart className="w-3 h-3 text-muted-foreground" />{s.poCount}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <span className={`text-sm font-bold ${s.totalSpent > 0 ? 'text-primary' : 'text-muted-foreground'}`}>
                      {s.totalSpent > 0 ? `$${s.totalSpent.toLocaleString()}` : '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={e => openEdit(s, e)}>
                      <Pencil className="w-3 h-3" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SupplierDuplicatesDialog open={openDuplicates} onOpenChange={setOpenDuplicates} onDone={() => load(true)} />

      <SupplierDialog
        supplier={activeSupplier}
        open={openSupplier}
        onOpenChange={setOpenSupplier}
        initialMode={supplierMode}
        onSaved={handleSaved}
        onPortal={openPortalFor}
      />

      <PortalAccessDialog
        supplier={activeSupplier}
        open={openPortal}
        onOpenChange={setOpenPortal}
        onRefresh={() => load(true)}
      />
    </div>
  );
}
