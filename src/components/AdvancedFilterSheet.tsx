import React, { useState } from 'react';
import { SlidersHorizontal, Plus, X, Type, Hash, Calendar, ListFilter, Save } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';

// ── Types ─────────────────────────────────────────────────────────────────────
export type FilterColumnType = 'text' | 'number' | 'date' | 'select';

export type FilterColumn = {
  key: string;
  label: string;
  type?: FilterColumnType;
  options?: string[];
};

export type FilterRule = {
  id: string;
  column: string;
  operator: string;
  value: string;
  value2?: string;
  selectedValues?: string[];
};

// ── Operators per type ────────────────────────────────────────────────────────
export const OPS: Record<FilterColumnType, { value: string; label: string }[]> = {
  text: [
    { value: 'contiene',    label: 'contiene' },
    { value: 'no_contiene', label: 'no contiene' },
    { value: 'igual_a',     label: 'es igual a' },
    { value: 'no_igual_a',  label: 'no es igual a' },
    { value: 'empieza_con', label: 'empieza con' },
    { value: 'termina_con', label: 'termina con' },
    { value: 'vacio',       label: 'está vacío' },
    { value: 'no_vacio',    label: 'no está vacío' },
  ],
  number: [
    { value: 'igual_a',     label: 'es igual a' },
    { value: 'no_igual_a',  label: 'no es igual a' },
    { value: 'mayor_que',   label: 'mayor que' },
    { value: 'menor_que',   label: 'menor que' },
    { value: 'mayor_igual', label: 'mayor o igual a' },
    { value: 'menor_igual', label: 'menor o igual a' },
    { value: 'entre',       label: 'entre' },
    { value: 'vacio',       label: 'está vacío' },
    { value: 'no_vacio',    label: 'no está vacío' },
  ],
  date: [
    { value: 'fecha_es',    label: 'es' },
    { value: 'antes_de',    label: 'es antes de' },
    { value: 'despues_de',  label: 'es después de' },
    { value: 'entre',       label: 'entre' },
    { value: 'esta_semana', label: 'esta semana' },
    { value: 'este_mes',    label: 'este mes' },
    { value: 'vacio',       label: 'está vacío' },
    { value: 'no_vacio',    label: 'no está vacío' },
  ],
  select: [
    { value: 'es',            label: 'es' },
    { value: 'no_es',         label: 'no es' },
    { value: 'es_alguno',     label: 'es alguno de' },
    { value: 'no_es_ninguno', label: 'no es ninguno de' },
    { value: 'vacio',         label: 'está vacío' },
    { value: 'no_vacio',      label: 'no está vacío' },
  ],
};

export const TYPE_ICONS: Record<FilterColumnType, React.ElementType> = {
  text: Type, number: Hash, date: Calendar, select: ListFilter,
};

export const NO_INPUT_OPS = new Set(['vacio', 'no_vacio', 'esta_semana', 'este_mes']);
const TEXT_FREE_OPS    = new Set(['contiene', 'no_contiene']);
const TEXT_SUGGEST_OPS = new Set(['igual_a', 'empieza_con', 'termina_con']);

// ── TextMultiCombobox ─────────────────────────────────────────────────────────
function TextMultiCombobox({ selected, onChange, suggestions }: {
  selected: string[];
  onChange: (vals: string[]) => void;
  suggestions: string[];
}) {
  const [search, setSearch] = useState('');

  const filtered = search.trim()
    ? suggestions.filter(s => s.toLowerCase().includes(search.toLowerCase()))
    : suggestions;

  const toggle = (opt: string, checked: boolean) =>
    onChange(checked ? [...selected, opt] : selected.filter(v => v !== opt));

  return (
    <div className="space-y-1.5">
      {/* Selected badges */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map(v => (
            <span
              key={v}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-primary text-primary-foreground"
            >
              {v}
              <button
                type="button"
                onClick={() => toggle(v, false)}
                className="hover:opacity-70 transition-opacity leading-none"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Search input */}
      <Input
        placeholder="Buscar valores..."
        className="h-8 text-xs"
        value={search}
        onChange={e => setSearch(e.target.value)}
      />

      {/* Checkbox list */}
      <div className="max-h-36 overflow-y-auto rounded-lg border border-border bg-card shadow-sm">
        {filtered.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-3 italic">Sin resultados</p>
        ) : (
          filtered.map(opt => (
            <label
              key={opt}
              className="flex items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-accent cursor-pointer transition-colors"
            >
              <Checkbox
                checked={selected.includes(opt)}
                onCheckedChange={ch => toggle(opt, !!ch)}
                className="h-3.5 w-3.5 flex-shrink-0"
              />
              <span className="truncate text-card-foreground font-medium">{opt}</span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}

// ── TextFreeInput — free-text tag input for "contiene" / "no_contiene" ────────
function TextFreeInput({ selected, onChange }: {
  selected: string[];
  onChange: (vals: string[]) => void;
}) {
  const [input, setInput] = useState('');

  const addTag = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed && !selected.includes(trimmed)) {
      onChange([...selected, trimmed]);
    }
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); addTag(input); }
    if (e.key === 'Backspace' && !input && selected.length > 0) {
      onChange(selected.slice(0, -1));
    }
  };

  const remove = (val: string) => onChange(selected.filter(v => v !== val));

  return (
    <div className="space-y-1.5">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map(v => (
            <span
              key={v}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-primary text-primary-foreground"
            >
              {v}
              <button type="button" onClick={() => remove(v)} className="hover:opacity-70 transition-opacity leading-none">
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}
      <Input
        placeholder={selected.length === 0 ? 'Escribe una palabra y presiona Enter…' : 'Agregar otra palabra…'}
        className="h-8 text-xs"
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <p className="text-[10px] text-muted-foreground leading-none">
        Presiona <kbd className="font-mono bg-muted px-1 rounded">Enter</kbd> para agregar · Backspace para borrar
      </p>
    </div>
  );
}

// ── FilterRuleRow (exported for reuse) ────────────────────────────────────────
export function FilterRuleRow({ rule, idx, columns, colUniqueValues, filterMode, onUpdate, onRemove }: {
  rule: FilterRule;
  idx: number;
  columns: FilterColumn[];
  colUniqueValues: (key: string) => string[];
  filterMode: 'and' | 'or';
  onUpdate: (patch: Partial<FilterRule>) => void;
  onRemove: () => void;
}) {
  const col = columns.find(c => c.key === rule.column);
  const colType: FilterColumnType = col?.type ?? 'text';
  const operators = OPS[colType];
  const rawOptions = col?.options?.length ? col.options : colUniqueValues(rule.column);
  const selectOptions = rawOptions.filter(Boolean);

  const handleColumnChange = (newKey: string) => {
    const newCol = columns.find(c => c.key === newKey);
    const newType: FilterColumnType = newCol?.type ?? 'text';
    onUpdate({ column: newKey, operator: OPS[newType][0].value, value: '', value2: '', selectedValues: [] });
  };

  const handleOperatorChange = (op: string) => {
    onUpdate({ operator: op, value: '', value2: '', selectedValues: [] });
  };

  const toggleVal = (opt: string, checked: boolean) => {
    const prev = rule.selectedValues ?? [];
    onUpdate({ selectedValues: checked ? [...prev, opt] : prev.filter(v => v !== opt) });
  };

  const noInput        = NO_INPUT_OPS.has(rule.operator);
  const isBetween      = rule.operator === 'entre';
  const isSelectSingle = colType === 'select' && ['es', 'no_es'].includes(rule.operator);
  const isSelectMulti  = colType === 'select' && ['es_alguno', 'no_es_ninguno'].includes(rule.operator);
  const isTextFree     = colType === 'text' && TEXT_FREE_OPS.has(rule.operator);
  const isTextSuggest  = colType === 'text' && TEXT_SUGGEST_OPS.has(rule.operator);
  const TypeIcon       = TYPE_ICONS[colType];
  const connectorLabel = idx === 0 ? 'DONDE' : filterMode === 'and' ? 'Y DONDE' : 'O DONDE';

  return (
    <div className="p-3 bg-card border border-border rounded-xl shadow-sm text-foreground">
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{connectorLabel}</span>
        <button onClick={onRemove} className="text-muted-foreground hover:text-destructive transition-colors rounded p-0.5">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="space-y-1.5">
        {/* Column */}
        <Select value={rule.column} onValueChange={handleColumnChange}>
          <SelectTrigger className="h-8 text-xs">
            <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
              <TypeIcon className="w-3 h-3 text-muted-foreground flex-shrink-0" />
              <SelectValue placeholder="Elegir columna..." />
            </div>
          </SelectTrigger>
          <SelectContent>
            {columns.map(c => {
              const Icon = TYPE_ICONS[c.type ?? 'text'];
              return (
                <SelectItem key={c.key} value={c.key}>
                  <div className="flex items-center gap-1.5">
                    <Icon className="w-3 h-3 text-muted-foreground" />
                    {c.label}
                  </div>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>

        {/* Operator */}
        <Select value={rule.operator} onValueChange={handleOperatorChange}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {operators.map(op => <SelectItem key={op.value} value={op.value}>{op.label}</SelectItem>)}
          </SelectContent>
        </Select>

        {/* Value input */}
        {!noInput && (
          isSelectSingle ? (
            <Select value={rule.value} onValueChange={v => onUpdate({ value: v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Elegir valor..." /></SelectTrigger>
              <SelectContent>
                {selectOptions.map(opt => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : isSelectMulti ? (
            <div className="max-h-52 overflow-y-auto border border-border rounded-lg p-1 bg-background">
              {selectOptions.length === 0
                ? <p className="text-xs text-muted-foreground text-center py-2 italic">Sin valores disponibles</p>
                : selectOptions.map(opt => (
                  <label key={opt} className="flex items-center gap-2 px-1.5 py-1 text-xs hover:bg-muted rounded cursor-pointer">
                    <Checkbox
                      checked={(rule.selectedValues ?? []).includes(opt)}
                      onCheckedChange={ch => toggleVal(opt, !!ch)}
                      className="h-3.5 w-3.5"
                    />
                    <span className="truncate">{opt}</span>
                  </label>
                ))
              }
            </div>
          ) : isTextFree ? (
            <TextFreeInput
              selected={rule.selectedValues ?? []}
              onChange={vals => onUpdate({ selectedValues: vals, value: vals[0] ?? '' })}
            />
          ) : isTextSuggest ? (
            <TextMultiCombobox
              selected={rule.selectedValues ?? []}
              onChange={vals => onUpdate({ selectedValues: vals, value: vals[0] ?? '' })}
              suggestions={selectOptions}
            />
          ) : colType === 'number' ? (
            isBetween ? (
              <div className="flex gap-1">
                <Input type="number" placeholder="Mín" className="h-8 text-xs" value={rule.value} onChange={e => onUpdate({ value: e.target.value })} />
                <Input type="number" placeholder="Máx" className="h-8 text-xs" value={rule.value2 ?? ''} onChange={e => onUpdate({ value2: e.target.value })} />
              </div>
            ) : (
              <Input type="number" placeholder="Valor..." className="h-8 text-xs" value={rule.value} onChange={e => onUpdate({ value: e.target.value })} />
            )
          ) : colType === 'date' ? (
            isBetween ? (
              <div className="flex gap-1">
                <Input type="date" className="h-8 text-xs" value={rule.value} onChange={e => onUpdate({ value: e.target.value })} />
                <Input type="date" className="h-8 text-xs" value={rule.value2 ?? ''} onChange={e => onUpdate({ value2: e.target.value })} />
              </div>
            ) : (
              <Input type="date" className="h-8 text-xs" value={rule.value} onChange={e => onUpdate({ value: e.target.value })} />
            )
          ) : (
            <Input placeholder="Valor..." className="h-8 text-xs" value={rule.value} onChange={e => onUpdate({ value: e.target.value })} />
          )
        )}
      </div>
    </div>
  );
}

// ── Shared popover style helpers ──────────────────────────────────────────────
const popoverBg  = 'hsl(var(--filter-popover-bg))';
const popoverFg  = 'hsl(var(--filter-popover-fg))';
const popoverBorder = 'hsl(var(--filter-popover-border))';
const popoverMuted  = 'hsl(var(--filter-popover-muted))';

// ── AdvancedFilterSheet — Popover flotante ────────────────────────────────────
interface Props {
  columns: FilterColumn[];
  rules: FilterRule[];
  onRulesChange: (rules: FilterRule[]) => void;
  filterMode: 'and' | 'or';
  onFilterModeChange: (mode: 'and' | 'or') => void;
  colUniqueValues: (key: string) => string[];
  activeFilterCount?: number;
  activeViewName?: string;
  onSaveToView?: () => void;
  columnFilters?: Record<string, Set<string>>;
  onClearColumnFilter?: (columnKey: string) => void;
  onClearAll?: () => void;
}

export function AdvancedFilterSheet({
  columns, rules, onRulesChange, filterMode, onFilterModeChange, colUniqueValues, activeFilterCount = 0,
  activeViewName, onSaveToView, columnFilters = {}, onClearColumnFilter, onClearAll,
}: Props) {
  const [open, setOpen] = useState(false);

  const addRule = () => {
    const first = columns[0];
    const t: FilterColumnType = first?.type ?? 'text';
    onRulesChange([...rules, {
      id: `r_${Date.now()}`,
      column: first?.key ?? '',
      operator: OPS[t][0].value,
      value: '',
      selectedValues: [],
    }]);
  };

  const update = (id: string, patch: Partial<FilterRule>) =>
    onRulesChange(rules.map(r => r.id === id ? { ...r, ...patch } : r));
  const remove = (id: string) => onRulesChange(rules.filter(r => r.id !== id));

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant={rules.length > 0 ? 'default' : 'outline'}
          className="gap-1.5 h-8"
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          Filtros
          {activeFilterCount > 0 && (
            <Badge variant="secondary" className="text-[10px] h-4 px-1.5 ml-0.5 bg-background/30 text-inherit">
              {activeFilterCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className="w-[420px] p-0 flex flex-col shadow-2xl"
        align="start"
        side="bottom"
        sideOffset={6}
        style={{
          maxHeight: '520px',
          backgroundColor: popoverBg,
          color: popoverFg,
          borderColor: popoverBorder,
        }}
      >
        {/* Header */}
        <div
          className="px-4 py-3 border-b flex items-center justify-between flex-shrink-0"
          style={{ borderColor: popoverBorder }}
        >
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4" style={{ color: popoverMuted }} />
            <span className="text-sm font-semibold" style={{ color: popoverFg }}>Filtros avanzados</span>
            {rules.length > 0 && (
              <Badge variant="secondary" className="text-xs ml-1 bg-white/10 text-white border-white/20">
                {rules.length}
              </Badge>
            )}
          </div>
          <button
            onClick={() => setOpen(false)}
            className="transition-colors p-0.5 rounded hover:bg-white/10"
            style={{ color: popoverMuted }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* AND / OR toggle */}
        {rules.length >= 2 && (
          <div
            className="px-4 py-2 border-b flex items-center gap-2 flex-wrap flex-shrink-0"
            style={{ borderColor: popoverBorder }}
          >
            <span className="text-xs" style={{ color: popoverMuted }}>Mostrar registros que cumplan</span>
            <div className="flex items-center rounded-lg p-0.5 gap-0.5" style={{ backgroundColor: 'hsl(220 50% 10%)' }}>
              <button
                onClick={() => onFilterModeChange('and')}
                className="px-2.5 py-1 text-xs rounded-md transition-all"
                style={filterMode === 'and'
                  ? { backgroundColor: 'hsl(220 50% 28%)', color: popoverFg, fontWeight: 600 }
                  : { color: popoverMuted }}
              >
                todas
              </button>
              <button
                onClick={() => onFilterModeChange('or')}
                className="px-2.5 py-1 text-xs rounded-md transition-all"
                style={filterMode === 'or'
                  ? { backgroundColor: 'hsl(220 50% 28%)', color: popoverFg, fontWeight: 600 }
                  : { color: popoverMuted }}
              >
                cualquiera
              </button>
            </div>
            <span className="text-xs" style={{ color: popoverMuted }}>de las condiciones</span>
          </div>
        )}

        {/* Rules */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {/* Column filters section */}
          {Object.entries(columnFilters).filter(([, vals]) => vals.size > 0).length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: popoverMuted }}>
                Filtros de columna
              </p>
              <div className="space-y-1.5">
                {Object.entries(columnFilters)
                  .filter(([, vals]) => vals.size > 0)
                  .map(([colKey, vals]) => {
                    const colLabel = columns.find(c => c.key === colKey)?.label ?? colKey;
                    return (
                      <div
                        key={colKey}
                        className="flex items-start gap-2 p-2.5 rounded-lg border"
                        style={{ backgroundColor: 'hsl(220 50% 14%)', borderColor: popoverBorder }}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] font-semibold mb-1.5" style={{ color: popoverMuted }}>
                            {colLabel}
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {[...vals].map(v => (
                              <span
                                key={v}
                                className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium"
                                style={{ backgroundColor: 'hsl(220 50% 28%)', color: popoverFg }}
                              >
                                {v || '(vacío)'}
                              </span>
                            ))}
                          </div>
                        </div>
                        {onClearColumnFilter && (
                          <button
                            onClick={() => onClearColumnFilter(colKey)}
                            className="flex-shrink-0 mt-0.5 rounded p-0.5 hover:bg-white/10 transition-colors"
                            style={{ color: popoverMuted }}
                            title="Quitar filtro"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {/* Advanced filter rules */}
          {rules.length === 0 && Object.values(columnFilters).every(s => s.size === 0) ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <SlidersHorizontal className="w-9 h-9 mb-3" style={{ color: `${popoverMuted}55` }} />
              <p className="text-sm font-semibold mb-1" style={{ color: popoverFg }}>Sin filtros activos</p>
              <p className="text-xs" style={{ color: popoverMuted }}>
                Agrega condiciones para filtrar registros de forma precisa
              </p>
            </div>
          ) : rules.length > 0 ? (
            <div className="space-y-3">
              {rules.map((rule, idx) => (
                <FilterRuleRow
                  key={rule.id}
                  rule={rule}
                  idx={idx}
                  columns={columns}
                  colUniqueValues={colUniqueValues}
                  filterMode={filterMode}
                  onUpdate={patch => update(rule.id, patch)}
                  onRemove={() => remove(rule.id)}
                />
              ))}
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div
          className="px-4 py-3 border-t space-y-2 flex-shrink-0"
          style={{ borderColor: popoverBorder }}
        >
          {onSaveToView && (
            <button
              onClick={onSaveToView}
              className="w-full flex items-center justify-center gap-1.5 h-8 text-xs font-semibold rounded-lg transition-all hover:opacity-90 active:scale-[0.98]"
              style={{ backgroundColor: 'hsl(220 50% 32%)', color: popoverFg, border: '1px solid hsl(220 50% 45%)' }}
            >
              <Save className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">Guardar en vista «{activeViewName}»</span>
            </button>
          )}
          <button
            onClick={addRule}
            className="w-full flex items-center justify-center gap-1.5 h-8 text-sm rounded-lg border transition-colors hover:bg-white/10"
            style={{ borderColor: popoverBorder, color: popoverFg }}
          >
            <Plus className="w-3.5 h-3.5" /> Agregar condición
          </button>
          {activeFilterCount > 0 && (
            <button
              onClick={() => { if (onClearAll) { onClearAll(); setOpen(false); } else { onRulesChange([]); } }}
              className="w-full flex items-center justify-center h-8 text-xs rounded-lg transition-colors hover:bg-red-500/20"
              style={{ color: popoverMuted }}
            >
              Limpiar todos los filtros
            </button>
          )}
        </div>
      </PopoverContent>
      </Popover>
      {activeFilterCount > 0 && onClearAll && (
        <button
          onClick={onClearAll}
          className="flex items-center gap-1.5 px-2.5 py-1 bg-primary/10 text-primary text-xs rounded-lg font-medium border border-primary/20 hover:bg-destructive/10 hover:text-destructive hover:border-destructive/20 transition-colors whitespace-nowrap"
          title="Limpiar todos los filtros"
        >
          <span>{activeFilterCount} filtro{activeFilterCount !== 1 ? 's' : ''} activo{activeFilterCount !== 1 ? 's' : ''}</span>
          <X className="w-3 h-3" />
        </button>
      )}
    </>
  );
}
