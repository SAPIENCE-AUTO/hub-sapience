import { useState, useMemo } from 'react';
import { Search, SortAsc, Clock, ListFilter, Play, Trash2, ChevronDown, Check, X } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { GetProjectsOutputType } from 'zite-endpoints-sdk';

type Project = GetProjectsOutputType['projects'][0];

const STATUSES = ['En curso', 'Finalizado', 'Prospecto', 'Cancelado'];

function statusStyle(s: string, active: boolean) {
  if (!active) return 'bg-muted/40 text-muted-foreground border-border hover:bg-muted';
  switch (s) {
    case 'En curso':   return 'bg-primary text-primary-foreground border-primary';
    case 'Finalizado': return 'bg-muted-foreground text-background border-muted-foreground';
    case 'Prospecto':  return 'bg-chart-4 text-background border-chart-4';
    case 'Cancelado':  return 'bg-destructive text-destructive-foreground border-destructive';
    default:           return 'bg-primary text-primary-foreground border-primary';
  }
}

function rowStatusBadge(s?: string) {
  switch (s) {
    case 'En curso':   return 'bg-primary/10 text-primary border-primary/25';
    case 'Finalizado': return 'bg-muted text-muted-foreground border-border';
    case 'Prospecto':  return 'bg-chart-4/10 text-chart-4 border-chart-4/25';
    case 'Cancelado':  return 'bg-destructive/10 text-destructive border-destructive/25';
    default:           return 'bg-muted text-muted-foreground border-border';
  }
}

function getYear(p: Project): string | null {
  const d = p.computedStartDate ?? p.startDate ?? p.computedEndDate ?? p.endDate;
  return d ? d.slice(0, 4) : null;
}

interface Props {
  projects: Project[];
  selectedIds: Set<string>;
  loadingProjects: boolean;
  onConfirm: (ids: Set<string>) => void;
}

export default function ProjectSelectorDialog({ projects, selectedIds, loadingProjects, onConfirm }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [statusFilters, setStatusFilters] = useState<Set<string>>(new Set());
  const [yearFilters, setYearFilters] = useState<Set<string>>(new Set());
  const [clientFilters, setClientFilters] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<'az' | 'reciente'>('az');

  const years = useMemo(() => {
    const s = new Set<string>();
    projects.forEach(p => { const y = getYear(p); if (y) s.add(y); });
    return Array.from(s).sort((a, b) => b.localeCompare(a));
  }, [projects]);

  const clients = useMemo(() => {
    const s = new Set<string>();
    projects.forEach(p => { if (p.client) s.add(p.client); });
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [projects]);

  const handleOpen = () => {
    setDraft(new Set(selectedIds));
    setSearch('');
    setStatusFilters(new Set());
    setYearFilters(new Set());
    setClientFilters(new Set());
    setOpen(true);
  };

  const toggleFilter = (set: Set<string>, val: string, setter: (s: Set<string>) => void) => {
    const n = new Set(set);
    n.has(val) ? n.delete(val) : n.add(val);
    setter(n);
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return projects
      .filter(p => {
        const matchSearch = !q ||
          p.projectCode?.toLowerCase().includes(q) ||
          p.fullName?.toLowerCase().includes(q) ||
          p.client?.toLowerCase().includes(q);
        const matchStatus = statusFilters.size === 0 || statusFilters.has(p.status ?? '');
        const matchYear = yearFilters.size === 0 || yearFilters.has(getYear(p) ?? '');
        const matchClient = clientFilters.size === 0 || clientFilters.has(p.client ?? '');
        return matchSearch && matchStatus && matchYear && matchClient;
      })
      .sort((a, b) => {
        if (sortBy === 'az') return (a.projectCode ?? '').localeCompare(b.projectCode ?? '');
        const da = a.computedStartDate ?? a.startDate ?? '';
        const db = b.computedStartDate ?? b.startDate ?? '';
        return db.localeCompare(da);
      });
  }, [projects, search, statusFilters, yearFilters, clientFilters, sortBy]);

  const toggle = (id: string) =>
    setDraft(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const allFilteredSel = filtered.length > 0 && filtered.every(p => draft.has(p.id));
  const someFilteredSel = filtered.some(p => draft.has(p.id));
  const isEmpty = draft.size === 0;

  const [clientSearch, setClientSearch] = useState('');
  const [clientPopoverOpen, setClientPopoverOpen] = useState(false);

  const filteredClientOptions = useMemo(() => {
    const q = clientSearch.toLowerCase();
    return q ? clients.filter(c => c.toLowerCase().includes(q)) : clients;
  }, [clients, clientSearch]);

  // Reusable pill component
  const Pill = ({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) => (
    <button
      onClick={onClick}
      className={cn(
        'px-2.5 py-1 rounded-full text-xs font-medium border transition-colors whitespace-nowrap shrink-0',
        active ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted/40 text-muted-foreground border-border hover:bg-muted'
      )}
    >
      {label}
    </button>
  );

  const SortBtn = ({ label, icon: Icon, val }: { label: string; icon: typeof SortAsc; val: 'az' | 'reciente' }) => (
    <button
      onClick={() => setSortBy(val)}
      className={cn(
        'px-2.5 py-1 rounded-full text-xs font-medium border flex items-center gap-1 transition-colors shrink-0',
        sortBy === val ? 'bg-primary/10 text-primary border-primary/30' : 'bg-muted/40 text-muted-foreground border-border hover:bg-muted'
      )}
    >
      <Icon className="w-3 h-3" />{label}
    </button>
  );

  const FilterLabel = ({ label, count }: { label: string; count: number }) => (
    <span className="text-xs text-muted-foreground font-medium shrink-0 flex items-center gap-1">
      {label}
      {count > 0 && (
        <span className="bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 text-[10px] leading-none font-semibold">
          {count}
        </span>
      )}
    </span>
  );

  return (
    <>
      <Button variant="outline" onClick={handleOpen} disabled={loadingProjects} className="gap-2">
        <ListFilter className="w-4 h-4" />
        Seleccionar proyectos
        <Badge variant="secondary" className="ml-0.5 text-xs">{selectedIds.size}</Badge>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl h-[80vh] flex flex-col gap-0 p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-5 pb-4 shrink-0">
            <DialogTitle>Seleccionar proyectos</DialogTitle>
          </DialogHeader>
          <Separator />

          {/* ── Controls ── */}
          <div className="px-6 py-3 space-y-2.5 shrink-0">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                className="pl-9"
                placeholder="Buscar por código, nombre o cliente..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                autoFocus
              />
            </div>

            {/* Row 1: Status + Sort */}
            <div className="flex items-center gap-2 overflow-x-auto pb-0.5 no-scrollbar">
              <FilterLabel label="Estado" count={statusFilters.size} />
              <div className="flex items-center gap-1.5 flex-1 overflow-x-auto no-scrollbar">
                {STATUSES.map(s => (
                  <button
                    key={s}
                    onClick={() => toggleFilter(statusFilters, s, setStatusFilters)}
                    className={cn(
                      'px-2.5 py-1 rounded-full text-xs font-medium border transition-colors whitespace-nowrap shrink-0',
                      statusStyle(s, statusFilters.has(s))
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <div className="flex gap-1.5 shrink-0 ml-2 border-l border-border pl-2">
                <SortBtn label="A-Z" icon={SortAsc} val="az" />
                <SortBtn label="Reciente" icon={Clock} val="reciente" />
              </div>
            </div>

            {/* Row 2: Years */}
            {years.length > 0 && (
              <div className="flex items-center gap-2">
                <FilterLabel label="Año" count={yearFilters.size} />
                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
                  {years.map(y => (
                    <Pill key={y} label={y} active={yearFilters.has(y)} onClick={() => toggleFilter(yearFilters, y, setYearFilters)} />
                  ))}
                </div>
              </div>
            )}

            {/* Row 3: Clients — combobox popover */}
            {clients.length > 0 && (
              <div className="flex items-center gap-2">
                <FilterLabel label="Cliente" count={clientFilters.size} />
                <Popover open={clientPopoverOpen} onOpenChange={open => { setClientPopoverOpen(open); if (!open) setClientSearch(''); }}>
                  <PopoverTrigger asChild>
                    <button
                      className={cn(
                        'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors',
                        clientFilters.size > 0
                          ? 'bg-primary/10 text-primary border-primary/30'
                          : 'bg-muted/40 text-muted-foreground border-border hover:bg-muted'
                      )}
                    >
                      {clientFilters.size === 0
                        ? 'Todos los clientes'
                        : clientFilters.size === 1
                          ? Array.from(clientFilters)[0]
                          : `${clientFilters.size} clientes seleccionados`}
                      <ChevronDown className="w-3 h-3 opacity-60" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="p-0 w-64">
                    <div className="p-2 border-b border-border">
                      <div className="relative">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                        <Input
                          className="pl-7 h-7 text-xs"
                          placeholder="Buscar cliente..."
                          value={clientSearch}
                          onChange={e => setClientSearch(e.target.value)}
                          autoFocus
                        />
                      </div>
                    </div>
                    {clientFilters.size > 0 && (
                      <div className="px-2 py-1.5 border-b border-border">
                        <button
                          onClick={() => setClientFilters(new Set())}
                          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                        >
                          <X className="w-3 h-3" />Limpiar selección
                        </button>
                      </div>
                    )}
                    <ScrollArea className="max-h-52">
                      <div className="p-1">
                        {filteredClientOptions.length === 0 ? (
                          <p className="text-xs text-muted-foreground text-center py-3">Sin resultados</p>
                        ) : (
                          filteredClientOptions.map(c => (
                            <button
                              key={c}
                              onClick={() => toggleFilter(clientFilters, c, setClientFilters)}
                              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-muted text-left transition-colors"
                            >
                              <div className={cn(
                                'w-3.5 h-3.5 rounded-sm border flex items-center justify-center shrink-0 transition-colors',
                                clientFilters.has(c) ? 'bg-primary border-primary' : 'border-border'
                              )}>
                                {clientFilters.has(c) && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                              </div>
                              <span className="truncate">{c}</span>
                            </button>
                          ))
                        )}
                      </div>
                    </ScrollArea>
                  </PopoverContent>
                </Popover>
              </div>
            )}

            {/* Quick actions */}
            <div className="flex items-center gap-3 text-xs pt-0.5">
              <Checkbox
                checked={allFilteredSel ? true : someFilteredSel ? 'indeterminate' : false}
                onCheckedChange={v => {
                  if (v) setDraft(prev => { const n = new Set(prev); filtered.forEach(p => n.add(p.id)); return n; });
                  else   setDraft(prev => { const n = new Set(prev); filtered.forEach(p => n.delete(p.id)); return n; });
                }}
              />
              <span className="text-muted-foreground">{filtered.length} visibles</span>
              <span className="text-muted-foreground/40">·</span>
              <button onClick={() => setDraft(new Set(projects.map(p => p.id)))} className="text-primary hover:underline">Todos</button>
              <span className="text-muted-foreground/40">·</span>
              <button onClick={() => setDraft(new Set())} className="text-muted-foreground hover:underline">Ninguno</button>
              <span className="text-muted-foreground/40">·</span>
              <button onClick={() => setDraft(new Set(filtered.map(p => p.id)))} className="text-primary hover:underline">Solo filtrados</button>
            </div>
          </div>

          <Separator />

          {/* ── List ── */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                No hay proyectos con esos filtros
              </div>
            ) : (
              <div className="divide-y divide-border">
                {filtered.map(p => {
                  const sel = draft.has(p.id);
                  return (
                    <label
                      key={p.id}
                      className={cn(
                        'flex items-center gap-4 px-6 py-3 cursor-pointer transition-colors hover:bg-muted/40 select-none',
                        sel && 'bg-primary/5'
                      )}
                    >
                      <Checkbox checked={sel} onCheckedChange={() => toggle(p.id)} />
                      <span className="font-mono text-xs font-semibold text-muted-foreground w-20 shrink-0">{p.projectCode}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{p.fullName ?? p.projectCode}</p>
                        {p.client && <p className="text-xs text-muted-foreground truncate">{p.client}</p>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {getYear(p) && <span className="text-xs text-muted-foreground font-mono">{getYear(p)}</span>}
                        {p.status && (
                          <span className={cn('text-xs px-2 py-0.5 rounded-full border', rowStatusBadge(p.status))}>
                            {p.status}
                          </span>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <Separator />

          {/* ── Footer ── */}
          <div className="px-6 py-4 flex items-center justify-between shrink-0">
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{draft.size}</span> de {projects.length} seleccionados
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              {isEmpty ? (
                <Button variant="destructive" onClick={() => { setOpen(false); onConfirm(new Set()); }} className="gap-2">
                  <Trash2 className="w-4 h-4" />Limpiar análisis
                </Button>
              ) : (
                <Button onClick={() => { setOpen(false); onConfirm(new Set(draft)); }} className="gap-2">
                  <Play className="w-4 h-4" />
                  Analizar {draft.size} proyecto{draft.size !== 1 ? 's' : ''}
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
