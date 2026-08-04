import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  createSharedView, getSharedViews, deleteSharedView,
  updateSharedView, getBoardGroups, GetSharedViewsOutputType, GetBoardGroupsOutputType,
} from 'zite-endpoints-sdk';
import { Share2, Copy, CheckCheck, Trash2, ExternalLink, Link2, Eye, Pencil, Plus, ArrowLeft, Layers, CopyPlus } from 'lucide-react';
import { toast } from 'sonner';
import { FilterRuleRow, FilterRule, FilterColumn, OPS, FilterColumnType } from './AdvancedFilterSheet';
import { getGroupColor, dynColFilterType, parseDynColOptions } from './table/tableUtils';

type SharedView = GetSharedViewsOutputType['views'][0];
type BoardGroup = GetBoardGroupsOutputType['groups'][0];

const FIXED_COLUMNS: FilterColumn[] = [
  { key: 'participantName', label: 'Participante', type: 'text' },
  { key: 'email',           label: 'Email',        type: 'text' },
  { key: 'phone',           label: 'Teléfono',     type: 'text' },
  { key: 'idNumber',        label: 'ID / Doc',     type: 'text' },
  { key: 'status',          label: 'Estado',       type: 'select',
    options: ['Pendiente', 'Contactado', 'Confirmado', 'Asistió', 'No show', 'Descartado'] },
];

const FIXED_VISIBLE = [
  { key: 'participantName', label: 'Participante', alwaysOn: true },
  { key: 'email',           label: 'Email' },
  { key: 'phone',           label: 'Teléfono' },
  { key: 'idNumber',        label: 'ID / Doc' },
  { key: 'status',          label: 'Estado' },
];

const defaultVisibleCols = new Set(FIXED_VISIBLE.filter(c => c.key !== 'idNumber').map(c => c.key));

function useViewForm(dynamicColumns: Array<{ id: string; columnName?: string; columnType?: string; optionsJson?: string }>, boardGroups: BoardGroup[]) {
  const [viewName, setViewName] = useState('');
  const [filterRules, setFilterRules] = useState<FilterRule[]>([]);
  const [filterMode, setFilterMode] = useState<'and' | 'or'>('and');
  const [visibleCols, setVisibleCols] = useState<Set<string>>(new Set(defaultVisibleCols));
  // null = no group filter (show all). Otherwise: array of group IDs to include.
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[] | null>(null);
  const [showNoGroup, setShowNoGroup] = useState(true);

  const allFilterCols: FilterColumn[] = [
    ...FIXED_COLUMNS,
    ...dynamicColumns.map(c => {
      const t = dynColFilterType(c.columnType);
      let options: string[] | undefined;
      if (c.columnType === 'Checkbox') {
        options = ['Sí', 'No'];
      } else if (c.columnType === 'Status' || c.columnType === 'Select') {
        try {
          const opts = JSON.parse(c.optionsJson ?? '[]');
          options = Array.isArray(opts)
            ? (opts as unknown[]).map(o => typeof o === 'string' ? o : (o as { label?: string }).label ?? '').filter(Boolean)
            : undefined;
        } catch { options = undefined; }
      }
      return { key: c.id, label: c.columnName ?? 'Columna', type: t, options };
    }),
  ];

  const resetForm = () => {
    setViewName('');
    setFilterRules([]);
    setFilterMode('and');
    setVisibleCols(new Set(defaultVisibleCols));
    setSelectedGroupIds(null);
    setShowNoGroup(true);
  };

  const populateFromView = (v: SharedView) => {
    setViewName(v.viewName ?? '');
    const filtersData = v.filtersJson ? JSON.parse(v.filtersJson) : {};
    const rules: FilterRule[] = filtersData.filterRules ?? [];
    if (rules.length === 0 && filtersData.statuses?.length > 0) {
      rules.push({
        id: 'legacy_status',
        column: 'status',
        operator: 'es_alguno',
        value: '',
        selectedValues: filtersData.statuses,
      });
    }
    setFilterRules(rules);
    setFilterMode(filtersData.filterMode ?? 'and');
    const cols: string[] = v.visibleColumnsJson ? JSON.parse(v.visibleColumnsJson) : [...defaultVisibleCols];
    setVisibleCols(new Set(cols));
    // Groups
    const sg = filtersData.selectedGroups;
    setSelectedGroupIds(sg !== undefined ? sg : null);
    setShowNoGroup(filtersData.showNoGroup ?? true);
  };

  const addFilterRule = () => {
    const first = allFilterCols[0];
    const t: FilterColumnType = first?.type ?? 'text';
    setFilterRules(prev => [...prev, {
      id: `r_${Date.now()}`,
      column: first?.key ?? '',
      operator: OPS[t][0].value,
      value: '',
      selectedValues: [],
    }]);
  };

  const updateRule = (id: string, patch: Partial<FilterRule>) =>
    setFilterRules(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
  const removeRule = (id: string) => setFilterRules(prev => prev.filter(r => r.id !== id));

  const toggleCol = (key: string) =>
    setVisibleCols(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  // Toggle a specific group ID in/out of selectedGroupIds
  const toggleGroup = (id: string) => {
    setSelectedGroupIds(prev => {
      // null means all shown — convert to explicit list with this one removed
      const base = prev ?? boardGroups.map(g => g.id);
      const next = base.includes(id) ? base.filter(x => x !== id) : [...base, id];
      // If all groups selected + showNoGroup, revert to null (no filter)
      if (next.length === boardGroups.length && showNoGroup) return null;
      return next;
    });
  };

  const toggleShowNoGroup = () => {
    setShowNoGroup(prev => {
      const next = !prev;
      // If everything is now "all included", revert to null
      if (next && (selectedGroupIds === null || selectedGroupIds.length === boardGroups.length)) {
        setSelectedGroupIds(null);
        return true;
      }
      return next;
    });
  };

  const isGroupSelected = (id: string) =>
    selectedGroupIds === null || selectedGroupIds.includes(id);

  return {
    viewName, setViewName,
    filterRules, filterMode, setFilterMode,
    visibleCols, toggleCol,
    allFilterCols, addFilterRule, updateRule, removeRule,
    resetForm, populateFromView,
    selectedGroupIds, showNoGroup, isGroupSelected, toggleGroup, toggleShowNoGroup,
    getFiltersJson: () => {
      const groupPart = selectedGroupIds !== null
        ? { selectedGroups: selectedGroupIds, showNoGroup }
        : {};
      return JSON.stringify({ filterRules, filterMode, ...groupPart });
    },
    getVisibleColsJson: () => JSON.stringify([...visibleCols]),
  };
}

export function SharedViewDialog({
  open, onOpenChange, boardId, projectCode, boardName, dynamicColumns = [], colUniqueValues = () => [],
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  boardId: string;
  projectCode: string;
  boardName: string;
  dynamicColumns?: Array<{ id: string; columnName?: string; columnType?: string; optionsJson?: string }>;
  colUniqueValues?: (key: string) => string[];
}) {
  const [tab, setTab] = useState('create');
  const [boardGroups, setBoardGroups] = useState<BoardGroup[]>([]);
  const form = useViewForm(dynamicColumns, boardGroups);
  const [creating, setCreating] = useState(false);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [views, setViews] = useState<SharedView[]>([]);
  const [loadingViews, setLoadingViews] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingView, setEditingView] = useState<SharedView | null>(null);
  const [saving, setSaving] = useState(false);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);

  // Load board groups once when dialog opens
  useEffect(() => {
    if (!open || !boardId) return;
    getBoardGroups({ boardId })
      .then(res => setBoardGroups(res.groups))
      .catch(() => setBoardGroups([]));
  }, [open, boardId]);

  useEffect(() => {
    if (!open) {
      form.resetForm();
      setCreating(false);
      setCreatedUrl(null);
      setCopied(false);
      setTab('create');
      setEditingView(null);
    }
  }, [open]);

  const loadViews = async () => {
    if (!boardId) return;
    setLoadingViews(true);
    try {
      const res = await getSharedViews({ boardId });
      setViews(res.views);
    } catch {
      toast.error('Error al cargar vistas');
    }
    setLoadingViews(false);
  };

  useEffect(() => {
    if (open && tab === 'views') loadViews();
  }, [open, tab]);

  const handleCreate = async () => {
    if (!form.viewName.trim()) { toast.error('Ingresa un nombre para la vista'); return; }
    setCreating(true);
    try {
      const res = await createSharedView({
        viewName: form.viewName.trim(),
        boardId,
        projectCode,
        boardName,
        filtersJson: form.getFiltersJson(),
        visibleColumnsJson: form.getVisibleColsJson(),
      });
      setCreatedUrl(res.shareUrl);
    } catch {
      toast.error('Error al crear la vista');
    }
    setCreating(false);
  };

  const handleSaveEdit = async () => {
    if (!editingView) return;
    if (!form.viewName.trim()) { toast.error('Ingresa un nombre para la vista'); return; }
    setSaving(true);
    try {
      await updateSharedView({
        id: editingView.id,
        viewName: form.viewName.trim(),
        filtersJson: form.getFiltersJson(),
        visibleColumnsJson: form.getVisibleColsJson(),
      });
      toast.success('Vista actualizada');
      setEditingView(null);
      await loadViews();
    } catch {
      toast.error('Error al guardar');
    }
    setSaving(false);
  };

  const handleCopy = async (url: string, id?: string) => {
    await navigator.clipboard.writeText(url);
    if (id) { setCopiedId(id); setTimeout(() => setCopiedId(null), 2000); }
    else { setCopied(true); setTimeout(() => setCopied(false), 2000); }
    toast.success('Link copiado al portapapeles');
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteSharedView({ id });
      setViews(prev => prev.filter(v => v.id !== id));
      toast.success('Vista eliminada');
    } catch {
      toast.error('Error al eliminar');
    }
  };

  const handleDuplicate = async (v: SharedView) => {
    setDuplicatingId(v.id);
    try {
      await createSharedView({ duplicateFromToken: v.token });
      toast.success('Vista duplicada');
      await loadViews();
    } catch {
      toast.error('Error al duplicar la vista');
    }
    setDuplicatingId(null);
  };

  const startEdit = (v: SharedView) => {
    form.populateFromView(v);
    setEditingView(v);
    setTab('views');
  };

  const allVisibleCols = [
    ...FIXED_VISIBLE,
    ...dynamicColumns.map(c => ({ key: c.id, label: c.columnName ?? 'Columna', alwaysOn: false })),
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-6xl max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="w-4 h-4 text-primary" />
            Vistas compartidas
            <span className="text-xs font-normal text-muted-foreground ml-1">— {boardName}</span>
          </DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={v => { setTab(v); setEditingView(null); if (v === 'views') loadViews(); }}>
          <TabsList className="w-full">
            <TabsTrigger value="create" className="flex-1">Nueva vista</TabsTrigger>
            <TabsTrigger value="views" className="flex-1">
              Mis vistas {views.length > 0 && tab !== 'create' && <Badge variant="secondary" className="ml-1.5 text-[10px] h-4 px-1">{views.length}</Badge>}
            </TabsTrigger>
          </TabsList>

          {/* ── CREATE TAB ── */}
          <TabsContent value="create" className="mt-4">
            {createdUrl ? (
              <div className="space-y-4">
                <div className="rounded-xl bg-primary/5 border border-primary/20 p-4 space-y-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                    <CheckCheck className="w-4 h-4" /> ¡Vista creada!
                  </div>
                  <p className="text-xs text-muted-foreground">Comparte este link con quien necesite ver los datos:</p>
                  <div className="flex items-center gap-2">
                    <Input value={createdUrl} readOnly className="text-[11px] font-mono flex-1 h-8" />
                    <Button size="sm" variant="outline" className="h-8 px-3 flex-shrink-0 gap-1.5" onClick={() => handleCopy(createdUrl)}>
                      {copied ? <CheckCheck className="w-3.5 h-3.5 text-primary" /> : <Copy className="w-3.5 h-3.5" />}
                      {copied ? 'Copiado' : 'Copiar'}
                    </Button>
                  </div>
                  <a href={createdUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline">
                    <ExternalLink className="w-3 h-3" /> Abrir en nueva pestaña
                  </a>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => { setCreatedUrl(null); form.resetForm(); }}>
                    Crear otra
                  </Button>
                  <Button size="sm" className="flex-1 gap-1.5" onClick={() => { setTab('views'); loadViews(); setCreatedUrl(null); }}>
                    <Eye className="w-3.5 h-3.5" /> Ver mis vistas
                  </Button>
                </div>
              </div>
            ) : (
              <ViewForm
                form={form}
                allVisibleCols={allVisibleCols}
                boardGroups={boardGroups}
                onSubmit={handleCreate}
                submitting={creating}
                submitLabel="Generar link"
                submitIcon={<Link2 className="w-3.5 h-3.5" />}
                colUniqueValues={colUniqueValues}
              />
            )}
          </TabsContent>

          {/* ── VIEWS TAB ── */}
          <TabsContent value="views" className="mt-4">
            {editingView ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <button onClick={() => { setEditingView(null); form.resetForm(); }} className="text-muted-foreground hover:text-foreground transition-colors">
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                  <span className="text-sm font-medium">Editar vista</span>
                </div>
                <ViewForm
                  form={form}
                  allVisibleCols={allVisibleCols}
                  boardGroups={boardGroups}
                  onSubmit={handleSaveEdit}
                  submitting={saving}
                  submitLabel="Guardar cambios"
                  submitIcon={<CheckCheck className="w-3.5 h-3.5" />}
                  colUniqueValues={colUniqueValues}
                />
              </div>
            ) : loadingViews ? (
              <div className="flex items-center justify-center py-10">
                <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              </div>
            ) : views.length === 0 ? (
              <div className="flex flex-col items-center py-10 text-center">
                <Share2 className="w-8 h-8 text-muted-foreground/20 mb-3" />
                <p className="text-sm font-medium text-muted-foreground">Sin vistas compartidas</p>
                <p className="text-xs text-muted-foreground/60 mt-1">Crea una en la pestaña "Nueva vista"</p>
              </div>
            ) : (
              <ScrollArea className="max-h-96">
                <div className="space-y-2 pr-1">
                  {views.map(v => (
                    <div key={v.id} className="rounded-lg border border-border/60 bg-card p-3 space-y-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium truncate flex-1">{v.viewName || 'Sin nombre'}</p>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            onClick={() => startEdit(v)}
                            className="text-muted-foreground hover:text-primary p-1 rounded hover:bg-primary/10 transition-colors"
                            title="Editar vista"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDuplicate(v)}
                            disabled={duplicatingId === v.id}
                            className="text-muted-foreground hover:text-primary p-1 rounded hover:bg-primary/10 transition-colors disabled:opacity-40"
                            title="Duplicar vista"
                          >
                            {duplicatingId === v.id
                              ? <div className="w-3.5 h-3.5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                              : <CopyPlus className="w-3.5 h-3.5" />
                            }
                          </button>
                          <button
                            onClick={() => handleDelete(v.id)}
                            className="text-muted-foreground hover:text-destructive p-1 rounded hover:bg-destructive/10 transition-colors"
                            title="Eliminar vista"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Input value={v.shareUrl} readOnly className="text-[11px] font-mono h-7 flex-1" />
                        <Button size="sm" variant="outline" className="h-7 w-7 p-0 flex-shrink-0" title="Copiar link" onClick={() => handleCopy(v.shareUrl, v.id)}>
                          {copiedId === v.id ? <CheckCheck className="w-3 h-3 text-primary" /> : <Copy className="w-3 h-3" />}
                        </Button>
                        <a href={v.shareUrl} target="_blank" rel="noopener noreferrer">
                          <Button size="sm" variant="outline" className="h-7 w-7 p-0 flex-shrink-0" title="Abrir vista">
                            <ExternalLink className="w-3 h-3" />
                          </Button>
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// ── ViewForm ──────────────────────────────────────────────────────────────────
function ViewForm({
  form, allVisibleCols, boardGroups, onSubmit, submitting, submitLabel, submitIcon, colUniqueValues,
}: {
  form: ReturnType<typeof useViewForm>;
  allVisibleCols: Array<{ key: string; label: string; alwaysOn?: boolean }>;
  boardGroups: BoardGroup[];
  onSubmit: () => void;
  submitting: boolean;
  submitLabel: string;
  submitIcon: React.ReactNode;
  colUniqueValues: (key: string) => string[];
}) {
  return (
    <div className="space-y-5">
      {/* ── Two-column grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* ── LEFT: Name + Filters ── */}
        <div className="space-y-4">
          {/* Name */}
          <div className="space-y-1.5">
            <Label>Nombre de la vista</Label>
            <Input
              placeholder='ej: Confirmados — Reclutador A'
              value={form.viewName}
              onChange={e => form.setViewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && onSubmit()}
              autoFocus
            />
          </div>

          {/* Filters */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Filtros</Label>
              {form.filterRules.length >= 2 && (
                <div className="flex items-center bg-muted rounded-md p-0.5 gap-0.5">
                  {(['and', 'or'] as const).map(m => (
                    <button
                      key={m}
                      onClick={() => form.setFilterMode(m)}
                      className={`px-2 py-0.5 text-xs rounded transition-all ${form.filterMode === m ? 'bg-background text-foreground shadow-sm font-semibold' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                      {m === 'and' ? 'Todas' : 'Cualquiera'}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* Filter rules — no max-height, flow naturally */}
            <div className="space-y-2">
              {form.filterRules.map((rule, idx) => (
                <FilterRuleRow
                  key={rule.id}
                  rule={rule}
                  idx={idx}
                  columns={form.allFilterCols}
                  colUniqueValues={colUniqueValues}
                  filterMode={form.filterMode}
                  onUpdate={patch => form.updateRule(rule.id, patch)}
                  onRemove={() => form.removeRule(rule.id)}
                />
              ))}
              {form.filterRules.length === 0 && (
                <p className="text-xs text-muted-foreground/60 italic px-1 py-2">
                  Sin filtros — se mostrarán todos los participantes del tablero.
                </p>
              )}
            </div>
            <Button variant="outline" size="sm" className="w-full gap-1.5" onClick={form.addFilterRule}>
              <Plus className="w-3.5 h-3.5" /> Agregar condición
            </Button>
          </div>
        </div>

        {/* ── RIGHT: Groups + Visible columns ── */}
        <div className="space-y-4">
          {/* Groups visible — only when board has groups */}
          {boardGroups.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Label className="text-sm">Grupos visibles</Label>
                <Layers className="w-3 h-3 text-muted-foreground" />
              </div>
              <div className="rounded-lg border border-border/50 bg-muted/20 p-2 space-y-1">
                {boardGroups.map(g => {
                  const color = getGroupColor(g.colorId);
                  const checked = form.isGroupSelected(g.id);
                  return (
                    <label
                      key={g.id}
                      className="flex items-center gap-2.5 text-sm px-2 py-1.5 rounded-md cursor-pointer hover:bg-muted transition-colors"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => form.toggleGroup(g.id)}
                        className="h-3.5 w-3.5"
                      />
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                      <span className="truncate">{g.name}</span>
                    </label>
                  );
                })}
                <label className="flex items-center gap-2.5 text-sm px-2 py-1.5 rounded-md cursor-pointer hover:bg-muted transition-colors">
                  <Checkbox
                    checked={form.showNoGroup}
                    onCheckedChange={() => form.toggleShowNoGroup()}
                    className="h-3.5 w-3.5"
                  />
                  <div className="w-2.5 h-2.5 rounded-full border border-dashed border-muted-foreground/40 flex-shrink-0" />
                  <span className="text-muted-foreground italic">Sin grupo</span>
                </label>
              </div>
              {form.selectedGroupIds !== null && (
                <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block" />
                  Filtro activo: {form.selectedGroupIds.length} de {boardGroups.length} grupos seleccionados
                </p>
              )}
            </div>
          )}

          {/* Visible columns */}
          <div className="space-y-2">
            <Label className="text-sm">Columnas visibles</Label>
            <div className="rounded-lg border border-border/50 bg-muted/20 p-2 grid grid-cols-2 gap-0.5">
              {allVisibleCols.map(col => (
                <label
                  key={col.key}
                  className={`flex items-center gap-2 text-sm px-2 py-1.5 rounded-md transition-colors ${col.alwaysOn ? 'opacity-50' : 'cursor-pointer hover:bg-muted'}`}
                >
                  <Checkbox
                    checked={form.visibleCols.has(col.key)}
                    onCheckedChange={() => !col.alwaysOn && form.toggleCol(col.key)}
                    disabled={col.alwaysOn}
                    className="h-3.5 w-3.5"
                  />
                  <span className="truncate text-xs">{col.label}</span>
                  {col.alwaysOn && <span className="text-[10px] text-muted-foreground ml-auto">(siempre)</span>}
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Full-width bottom: info + submit ── */}
      <div className="space-y-3 pt-1 border-t border-border/40">
        <div className="rounded-md bg-muted/50 border border-border/40 px-3 py-2.5 text-xs text-muted-foreground flex items-center gap-4">
          <p>✦ Vista de <strong>solo lectura</strong> — nadie puede editar</p>
          <p>✦ No requiere login para abrirlo</p>
        </div>
        <Button onClick={onSubmit} disabled={submitting || !form.viewName.trim()} className="w-full gap-2">
          {submitting
            ? <><div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Guardando...</>
            : <>{submitIcon} {submitLabel}</>
          }
        </Button>
      </div>
    </div>
  );
}
