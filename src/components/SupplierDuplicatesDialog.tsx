import { useState, useEffect } from 'react';
import {
  detectDuplicateSuppliers,
  normalizeSupplierNames,
  mergeSupplierRecords,
  DetectDuplicateSuppliersOutputType,
} from 'zite-endpoints-sdk';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import {
  GitMerge, ShoppingCart, AlertTriangle, CheckCircle2, RefreshCw,
  Database, Pencil, Plus, Loader2, Link2, Users,
} from 'lucide-react';
import SearchableSelect from '@/components/SearchableSelect';

type Group = DetectDuplicateSuppliersOutputType['groups'][0];
type UnregisteredItem = DetectDuplicateSuppliersOutputType['unregistered'][0];
type ExistingSupplier = DetectDuplicateSuppliersOutputType['existingSuppliers'][0];
type SupplierDuplicateGroup = DetectDuplicateSuppliersOutputType['supplierDuplicates'][0];
type SupplierDuplicateItem = SupplierDuplicateGroup['suppliers'][0];

// ── Variant group card ────────────────────────────────────────────────────────
type CanonicalMode = 'variant' | 'custom' | 'existing';

function GroupCard({ group, existingSuppliers, onNormalized }: {
  group: Group; existingSuppliers: ExistingSupplier[]; onNormalized: () => void;
}) {
  const anyInDb = group.variants.some(v => v.inDb);
  const [mode, setMode] = useState<CanonicalMode>('variant');
  const [selectedVariant, setSelectedVariant] = useState(group.variants[0]?.name ?? '');
  const [customName, setCustomName] = useState('');
  const [existingName, setExistingName] = useState('');
  const [createSupplier, setCreateSupplier] = useState(!anyInDb);
  const [saving, setSaving] = useState(false);

  const canonicalName =
    mode === 'custom' ? customName.trim() :
    mode === 'existing' ? existingName : selectedVariant;

  const totalOCs = group.variants.reduce((s, v) => s + v.poCount, 0);

  const handleNormalize = async () => {
    if (!canonicalName) { toast.error('Elige un nombre canónico'); return; }
    setSaving(true);
    try {
      const result = await normalizeSupplierNames({
        canonicalName,
        variantNames: group.variants.map(v => v.name),
        createSupplier: mode !== 'existing' && createSupplier,
      });
      toast.success(`${result.posUpdated} OC${result.posUpdated !== 1 ? 's' : ''} actualizadas${result.supplierCreated ? ' · Proveedor creado en BD' : ''}`);
      onNormalized();
    } catch { toast.error('Error al normalizar el grupo'); }
    setSaving(false);
  };

  const existingOptions = existingSuppliers.map(s => ({
    value: s.name, label: s.name, sub: s.taxId ? `RFC: ${s.taxId}` : undefined,
  }));

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Nombre normalizado</p>
          <p className="text-sm font-bold">{group.normalizedName}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant="secondary" className="gap-1 text-xs"><ShoppingCart className="w-3 h-3" />{totalOCs} OC{totalOCs !== 1 ? 's' : ''}</Badge>
          <Badge className="text-xs">{group.variants.length} variantes</Badge>
        </div>
      </div>

      <div className="space-y-1">
        {group.variants.map(v => (
          <button key={v.name} disabled={mode !== 'variant'} onClick={() => { setMode('variant'); setSelectedVariant(v.name); }}
            className={`w-full text-left flex items-center gap-3 rounded-lg px-3 py-2 border transition-all ${mode === 'variant' && selectedVariant === v.name ? 'border-primary bg-primary/5' : 'border-border bg-muted/30 hover:border-primary/40 disabled:opacity-60 disabled:cursor-default'}`}>
            <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0 ${mode === 'variant' && selectedVariant === v.name ? 'border-primary' : 'border-muted-foreground/40'}`}>
              {mode === 'variant' && selectedVariant === v.name && <div className="w-1.5 h-1.5 rounded-full bg-primary" />}
            </div>
            <span className="flex-1 text-sm font-medium truncate">{v.name}</span>
            {v.inDb && <Badge variant="secondary" className="gap-1 text-[10px] shrink-0"><Database className="w-2.5 h-2.5" />En BD</Badge>}
            <span className="text-xs text-muted-foreground shrink-0">{v.poCount} OC{v.poCount !== 1 ? 's' : ''}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-1.5 text-xs">
        {([['variant', null, 'Usar variante'], ['custom', <Pencil className="w-3 h-3" />, 'Nombre propio'], ['existing', <Database className="w-3 h-3" />, 'Proveedor BD']] as const).map(([key, icon, label]) => (
          <button key={key} onClick={() => setMode(key as CanonicalMode)}
            className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 border font-medium transition-colors ${mode === key ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:border-primary/40'}`}>
            {icon}{label}
          </button>
        ))}
      </div>

      {mode === 'custom' && <Input value={customName} onChange={e => setCustomName(e.target.value)} placeholder="Escribe el nombre canónico…" className="text-sm h-9" />}
      {mode === 'existing' && <SearchableSelect value={existingName} onChange={setExistingName} options={existingOptions} placeholder="Seleccionar proveedor de BD…" className="w-full max-w-full min-w-0" />}
      {mode !== 'existing' && (
        <label className="flex items-center gap-2 cursor-pointer">
          <Checkbox checked={createSupplier} onCheckedChange={v => setCreateSupplier(!!v)} />
          <span className="text-xs text-muted-foreground">Crear proveedor en BD con este nombre</span>
        </label>
      )}

      <div className="flex items-center justify-between gap-3 pt-1 border-t border-border">
        <p className="text-xs text-muted-foreground">
          {canonicalName
            ? <><span className="font-semibold text-foreground">{canonicalName}</span> · reemplaza {group.variants.filter(v => v.name !== canonicalName).length} variante(s)</>
            : <span className="italic">Elige un nombre canónico</span>
          }
        </p>
        <Button size="sm" onClick={handleNormalize} disabled={saving || !canonicalName} className="gap-1.5 shrink-0">
          {saving ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" />Normalizando…</> : <><GitMerge className="w-3.5 h-3.5" />Normalizar</>}
        </Button>
      </div>
    </div>
  );
}

// ── Unregistered row ──────────────────────────────────────────────────────────
function UnregisteredRow({ item, existingSuppliers, onDone }: {
  item: UnregisteredItem; existingSuppliers: ExistingSupplier[]; onDone: () => void;
}) {
  const hasSuggestion = !!item.suggestedMatch;
  const [mode, setMode] = useState<'create' | 'link'>(hasSuggestion ? 'link' : 'create');
  const [linkTarget, setLinkTarget] = useState(item.suggestedMatch?.name ?? '');
  const [saving, setSaving] = useState(false);

  const handleAction = async () => {
    setSaving(true);
    try {
      if (mode === 'create') {
        const r = await normalizeSupplierNames({ canonicalName: item.name, variantNames: [item.name], createSupplier: true });
        toast.success(`Proveedor creado${r.posUpdated > 0 ? ` · ${r.posUpdated} OC${r.posUpdated !== 1 ? 's' : ''} vinculadas` : ''}`);
      } else {
        if (!linkTarget) { toast.error('Selecciona un proveedor existente'); setSaving(false); return; }
        const r = await normalizeSupplierNames({ canonicalName: linkTarget, variantNames: [item.name], createSupplier: false });
        toast.success(`${r.posUpdated} OC${r.posUpdated !== 1 ? 's' : ''} reasignadas a "${linkTarget}"`);
      }
      onDone();
    } catch { toast.error('Error al procesar el proveedor'); }
    setSaving(false);
  };

  const existingOptions = existingSuppliers.map(s => ({
    value: s.name, label: s.name, sub: s.taxId ? `RFC: ${s.taxId}` : undefined,
  }));

  const scorePercent = item.suggestedMatch ? Math.round(item.suggestedMatch.score * 100) : 0;

  return (
    <div className={`bg-card rounded-lg border px-3 py-2.5 space-y-2 ${hasSuggestion ? 'border-primary/30' : 'border-border'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{item.name}</p>
          <p className="text-xs text-muted-foreground">{item.poCount} OC{item.poCount !== 1 ? 's' : ''}</p>
        </div>
        {hasSuggestion && (
          <div className="flex items-center gap-1.5 shrink-0 bg-primary/5 border border-primary/20 rounded-lg px-2 py-1">
            <Link2 className="w-3 h-3 text-primary shrink-0" />
            <span className="text-[11px] text-primary font-medium truncate max-w-[140px]">
              {item.suggestedMatch!.name}
            </span>
            <span className="text-[10px] text-primary/70 font-semibold shrink-0">
              {scorePercent}%
            </span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <button onClick={() => setMode('create')}
          className={`text-xs px-2 py-1 rounded border font-medium transition-colors ${mode === 'create' ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground'}`}>
          Crear en BD
        </button>
        <button onClick={() => setMode('link')}
          className={`text-xs px-2 py-1 rounded border font-medium transition-colors ${mode === 'link' ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground'}`}>
          Vincular a existente
        </button>
        {mode === 'link' && (
          <SearchableSelect value={linkTarget} onChange={setLinkTarget} options={existingOptions} placeholder="Proveedor…" className="min-w-[180px]" />
        )}
        <Button size="sm" onClick={handleAction} disabled={saving} className="h-7 px-2.5 gap-1 text-xs ml-auto">
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
          {saving ? '…' : mode === 'create' ? 'Crear' : 'Vincular'}
        </Button>
      </div>
    </div>
  );
}

// ── Supplier DB duplicate card ─────────────────────────────────────────────────
function SupplierDuplicateCard({ group, onMerged }: {
  group: SupplierDuplicateGroup; onMerged: () => void;
}) {
  const [primaryId, setPrimaryId] = useState(group.suppliers[0]?.id ?? '');
  const [saving, setSaving] = useState(false);

  const primary = group.suppliers.find(s => s.id === primaryId);

  const handleMerge = async () => {
    if (!primaryId) { toast.error('Selecciona el proveedor principal'); return; }
    setSaving(true);
    try {
      const duplicateIds = group.suppliers.filter(s => s.id !== primaryId).map(s => s.id);
      const result = await mergeSupplierRecords({ primarySupplierId: primaryId, duplicateSupplierIds: duplicateIds });
      toast.success(
        `Fusión completada · ${result.suppliersDeleted} proveedor${result.suppliersDeleted !== 1 ? 'es' : ''} eliminado${result.suppliersDeleted !== 1 ? 's' : ''}` +
        (result.posUpdated > 0 ? ` · ${result.posUpdated} OC${result.posUpdated !== 1 ? 's' : ''} reasignadas` : '')
      );
      onMerged();
    } catch { toast.error('Error al fusionar proveedores'); }
    setSaving(false);
  };

  const totalOCs = group.suppliers.reduce((s, v) => s + v.poCount, 0);

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Nombre normalizado</p>
          <p className="text-sm font-bold">{group.normalizedName}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant="secondary" className="gap-1 text-xs"><ShoppingCart className="w-3 h-3" />{totalOCs} OC{totalOCs !== 1 ? 's' : ''}</Badge>
          <Badge className="text-xs">{group.suppliers.length} registros</Badge>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">Elige el <strong className="text-foreground">proveedor principal</strong> que se conservará. Los demás serán eliminados y sus OCs reasignadas.</p>

      <div className="space-y-1">
        {group.suppliers.map(s => (
          <button key={s.id} onClick={() => setPrimaryId(s.id)}
            className={`w-full text-left flex items-center gap-3 rounded-lg px-3 py-2 border transition-all ${primaryId === s.id ? 'border-primary bg-primary/5' : 'border-border bg-muted/30 hover:border-primary/40'}`}>
            <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0 ${primaryId === s.id ? 'border-primary' : 'border-muted-foreground/40'}`}>
              {primaryId === s.id && <div className="w-1.5 h-1.5 rounded-full bg-primary" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{s.name}</p>
              {s.taxId && <p className="text-[11px] text-muted-foreground">RFC: {s.taxId}</p>}
            </div>
            <span className="text-xs text-muted-foreground shrink-0">{s.poCount} OC{s.poCount !== 1 ? 's' : ''}</span>
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3 pt-1 border-t border-border">
        <p className="text-xs text-muted-foreground">
          {primary
            ? <><span className="font-semibold text-foreground">{primary.name}</span> · se conserva, {group.suppliers.length - 1} se elimina{group.suppliers.length - 1 !== 1 ? 'n' : ''}</>
            : <span className="italic">Elige el proveedor principal</span>
          }
        </p>
        <Button size="sm" onClick={handleMerge} disabled={saving || !primaryId} className="gap-1.5 shrink-0">
          {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Fusionando…</> : <><GitMerge className="w-3.5 h-3.5" />Fusionar</>}
        </Button>
      </div>
    </div>
  );
}

// ── Main dialog ───────────────────────────────────────────────────────────────
interface Props { open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void; }

export default function SupplierDuplicatesDialog({ open, onOpenChange, onDone }: Props) {
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);
  const [unregistered, setUnregistered] = useState<UnregisteredItem[]>([]);
  const [existingSuppliers, setExistingSuppliers] = useState<ExistingSupplier[]>([]);
  const [supplierDuplicates, setSupplierDuplicates] = useState<SupplierDuplicateGroup[]>([]);
  const [totals, setTotals] = useState({ groups: 0, variants: 0, unregistered: 0, supplierDuplicates: 0 });
  const [fetched, setFetched] = useState(false);
  const [bulkCreating, setBulkCreating] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(0);

  const fetchGroups = async () => {
    setLoading(true);
    try {
      const result = await detectDuplicateSuppliers({});
      setGroups(result.groups);
      setUnregistered(result.unregistered);
      setExistingSuppliers(result.existingSuppliers);
      setSupplierDuplicates(result.supplierDuplicates);
      setTotals({
        groups: result.totalGroups,
        variants: result.totalVariants,
        unregistered: result.totalUnregistered,
        supplierDuplicates: result.totalSupplierDuplicates,
      });
      setFetched(true);
    } catch { toast.error('Error al buscar variantes'); }
    setLoading(false);
  };

  useEffect(() => { if (open && !fetched) fetchGroups(); if (!open) setFetched(false); }, [open]);

  const removeGroup = (normalizedName: string) => {
    setGroups(prev => { const next = prev.filter(g => g.normalizedName !== normalizedName); setTotals(t => ({ ...t, groups: next.length })); return next; });
    onDone();
  };

  const removeUnregistered = (name: string) => {
    setUnregistered(prev => { const next = prev.filter(u => u.name !== name); setTotals(t => ({ ...t, unregistered: next.length })); return next; });
    onDone();
  };

  const removeSupplierDuplicate = (normalizedName: string) => {
    setSupplierDuplicates(prev => { const next = prev.filter(g => g.normalizedName !== normalizedName); setTotals(t => ({ ...t, supplierDuplicates: next.length })); return next; });
    onDone();
  };

  const handleBulkCreate = async () => {
    setBulkCreating(true);
    setBulkProgress(0);
    let created = 0;
    for (let i = 0; i < unregistered.length; i++) {
      try {
        await normalizeSupplierNames({ canonicalName: unregistered[i].name, variantNames: [unregistered[i].name], createSupplier: true });
        created++;
      } catch { /* skip failed */ }
      setBulkProgress(i + 1);
    }
    toast.success(`${created} proveedor${created !== 1 ? 'es' : ''} creado${created !== 1 ? 's' : ''} en BD`);
    setBulkCreating(false);
    setUnregistered([]);
    setTotals(t => ({ ...t, unregistered: 0 }));
    onDone();
  };

  const defaultTab = totals.supplierDuplicates > 0 ? 'bd_duplicados' : totals.groups > 0 ? 'variantes' : 'sin_registrar';

  const summaryParts = [
    totals.groups > 0 && `${totals.groups} grupo${totals.groups !== 1 ? 's' : ''} con variantes`,
    totals.unregistered > 0 && `${totals.unregistered} sin registrar`,
    totals.supplierDuplicates > 0 && `${totals.supplierDuplicates} grupo${totals.supplierDuplicates !== 1 ? 's' : ''} duplicado${totals.supplierDuplicates !== 1 ? 's' : ''} en BD`,
  ].filter(Boolean);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <GitMerge className="w-5 h-5 text-primary" />
            Normalizar proveedores
          </DialogTitle>
          {fetched && (
            <p className="text-sm text-muted-foreground mt-1">
              {summaryParts.length > 0 ? summaryParts.join(' · ') : '¡Todo en orden!'}
            </p>
          )}
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading && <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-40 w-full rounded-xl" />)}</div>}

          {!loading && fetched && (
            <Tabs defaultValue={defaultTab} className="space-y-3">
              <TabsList className="w-full">
                <TabsTrigger value="variantes" className="flex-1 gap-1.5 text-xs">
                  <GitMerge className="w-3.5 h-3.5" />
                  Variantes
                  {totals.groups > 0 && <Badge className="text-[10px] px-1.5 py-0">{totals.groups}</Badge>}
                </TabsTrigger>
                <TabsTrigger value="sin_registrar" className="flex-1 gap-1.5 text-xs">
                  <Database className="w-3.5 h-3.5" />
                  Sin registrar
                  {totals.unregistered > 0 && <Badge variant="destructive" className="text-[10px] px-1.5 py-0">{totals.unregistered}</Badge>}
                </TabsTrigger>
                <TabsTrigger value="bd_duplicados" className="flex-1 gap-1.5 text-xs">
                  <Users className="w-3.5 h-3.5" />
                  Duplicados en BD
                  {totals.supplierDuplicates > 0 && <Badge variant="destructive" className="text-[10px] px-1.5 py-0">{totals.supplierDuplicates}</Badge>}
                </TabsTrigger>
              </TabsList>

              {/* ── Variantes tab ── */}
              <TabsContent value="variantes" className="mt-0 space-y-3">
                {groups.length === 0 ? (
                  <div className="flex flex-col items-center py-12 text-center">
                    <CheckCircle2 className="w-10 h-10 text-primary/40 mb-3" />
                    <p className="font-semibold">Sin variantes</p>
                    <p className="text-sm text-muted-foreground mt-1">Todos los nombres de proveedor en OCs son únicos.</p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <p className="text-xs text-amber-800">Nombres en OCs con variaciones. Elige el <strong>nombre canónico</strong> y se actualizarán todas las OCs con otras variantes.</p>
                    </div>
                    {groups.map(group => (
                      <GroupCard key={group.normalizedName} group={group} existingSuppliers={existingSuppliers} onNormalized={() => removeGroup(group.normalizedName)} />
                    ))}
                  </>
                )}
              </TabsContent>

              {/* ── Sin registrar tab ── */}
              <TabsContent value="sin_registrar" className="mt-0 space-y-3">
                {unregistered.length === 0 ? (
                  <div className="flex flex-col items-center py-12 text-center">
                    <CheckCircle2 className="w-10 h-10 text-primary/40 mb-3" />
                    <p className="font-semibold">Todos registrados</p>
                    <p className="text-sm text-muted-foreground mt-1">Cada proveedor en tus OCs tiene registro en la BD.</p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs text-muted-foreground">
                        {unregistered.length} nombre{unregistered.length !== 1 ? 's' : ''} de proveedor encontrado{unregistered.length !== 1 ? 's' : ''} en OCs sin registro en BD
                      </p>
                      <Button size="sm" variant="outline" onClick={handleBulkCreate} disabled={bulkCreating} className="gap-1.5 shrink-0 text-xs">
                        {bulkCreating
                          ? <><Loader2 className="w-3 h-3 animate-spin" />Creando {bulkProgress}/{unregistered.length}…</>
                          : <><Plus className="w-3 h-3" />Crear todos en BD</>
                        }
                      </Button>
                    </div>
                    <div className="space-y-1.5">
                      {unregistered.map(item => (
                        <UnregisteredRow key={item.name} item={item} existingSuppliers={existingSuppliers} onDone={() => removeUnregistered(item.name)} />
                      ))}
                    </div>
                  </>
                )}
              </TabsContent>

              {/* ── Duplicados en BD tab ── */}
              <TabsContent value="bd_duplicados" className="mt-0 space-y-3">
                {supplierDuplicates.length === 0 ? (
                  <div className="flex flex-col items-center py-12 text-center">
                    <CheckCircle2 className="w-10 h-10 text-primary/40 mb-3" />
                    <p className="font-semibold">Sin duplicados en BD</p>
                    <p className="text-sm text-muted-foreground mt-1">No se detectaron registros duplicados en la tabla de Proveedores.</p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <p className="text-xs text-amber-800">Registros duplicados detectados en la tabla Proveedores. Elige el <strong>principal</strong> a conservar — los demás serán eliminados y sus OCs reasignadas.</p>
                    </div>
                    {supplierDuplicates.map(group => (
                      <SupplierDuplicateCard
                        key={group.normalizedName}
                        group={group}
                        onMerged={() => removeSupplierDuplicate(group.normalizedName)}
                      />
                    ))}
                  </>
                )}
              </TabsContent>
            </Tabs>
          )}
        </div>

        <div className="px-6 py-4 border-t shrink-0 flex justify-between items-center">
          <Button variant="ghost" size="sm" onClick={fetchGroups} disabled={loading} className="gap-1.5 text-muted-foreground">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Volver a buscar
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cerrar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
