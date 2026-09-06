import { useState, useEffect, useMemo } from 'react';
import { useAuth } from 'zite-auth-sdk';
import { getDeals, GetDealsOutputType, saveDeal } from 'zite-endpoints-sdk';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { LayoutGrid, Table2, Plus, TrendingUp, Search, X, ChevronDown, CalendarRange, Check, FileSpreadsheet, Loader2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import DealKanban from '../components/commercial/DealKanban';
import DealTable from '../components/commercial/DealTable';
import DealDetailSheet from '../components/commercial/DealDetailSheet';
import { PHASE_COLOR_MAP, PHASES, CURRENCIES } from '../components/commercial/dealUtils';
import { exportDealsExcel } from '../lib/exportDealsExcel';

// Exclusivo para Sergio, a su pedido explícito — no es un rol, es una
// excepción puntual para esta sola persona (mismo patrón que
// TOOLS_ALLOWED_EMAILS en ProjectHubPage.tsx). Todo lo que exporta ya lo
// puede ver este usuario en pantalla (getDeals no cambia), así que basta
// con ocultar el botón en el front — no hay un endpoint nuevo que proteger.
const EXPORT_EXCEL_ALLOWED_EMAILS = ['sergio@sapience.com.mx'];


type Deal = GetDealsOutputType['deals'][0];

const emptyDeal: Deal = { id: '', dealName: undefined, phase: 'Prospecto', client: undefined, projectType: undefined, tematica: undefined, owner: undefined, proposalDate: undefined, approvalDate: undefined, currency: 'MXN 🇲🇽', clientPrice: undefined, taxesPct: undefined, retencionesPct: undefined, quotedCost: undefined, notes: undefined };

export default function CommercialPage() {
  const { user } = useAuth();
  const canExportExcel = !!(user?.email && EXPORT_EXCEL_ALLOWED_EMAILS.includes(user.email));
  const [exporting, setExporting] = useState(false);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'kanban' | 'table'>('table');
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [filterClient, setFilterClient] = useState<string>('');
  const [filterPhases, setFilterPhases] = useState<string[]>([]);
  const [filterCurrency, setFilterCurrency] = useState<string>('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');

  // Popover open state
  const [clientOpen, setClientOpen] = useState(false);
  const [phaseOpen, setPhaseOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    try { const d = await getDeals({}); setDeals(d.deals); }
    catch { toast.error('Error al cargar deals'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handleStatusChange = async (dealId: string, newPhase: string) => {
    await saveDeal({ id: dealId, phase: newPhase });
    setDeals(prev => prev.map(d => d.id === dealId ? { ...d, phase: newPhase } : d));
  };

  const handleDealUpdated = (updated: Deal) => {
    setDeals(prev => {
      const idx = prev.findIndex(d => d.id === updated.id);
      if (idx >= 0) return prev.map((d, i) => i === idx ? updated : d);
      return [...prev, updated];
    });
    setSelectedDeal(updated);
  };

  const uniqueClients = useMemo(() =>
    [...new Set(deals.map(d => d.client).filter((c): c is string => !!c))].sort(),
    [deals]
  );

  const hasFilters = !!search || !!filterClient || filterPhases.length > 0 || !!filterCurrency || !!filterDateFrom || !!filterDateTo;

  const clearFilters = () => {
    setSearch('');
    setFilterClient('');
    setFilterPhases([]);
    setFilterCurrency('');
    setFilterDateFrom('');
    setFilterDateTo('');
  };

  const filteredDeals = useMemo(() => {
    return deals.filter(d => {
      if (search.trim()) {
        const q = search.toLowerCase();
        const match =
          d.dealName?.toLowerCase().includes(q) ||
          d.client?.toLowerCase().includes(q) ||
          d.tematica?.toLowerCase().includes(q) ||
          d.projectType?.toLowerCase().includes(q) ||
          (Array.isArray(d.owner) ? d.owner.join(' ') : d.owner ?? '').toLowerCase().includes(q);
        if (!match) return false;
      }
      if (filterClient && d.client !== filterClient) return false;
      if (filterPhases.length > 0 && !filterPhases.includes(d.phase ?? '')) return false;
      if (filterCurrency && d.currency !== filterCurrency) return false;
      if (filterDateFrom && d.proposalDate && d.proposalDate < filterDateFrom) return false;
      if (filterDateTo && d.proposalDate && d.proposalDate > filterDateTo) return false;
      return true;
    });
  }, [deals, search, filterClient, filterPhases, filterCurrency, filterDateFrom, filterDateTo]);

  const togglePhase = (phase: string) => {
    setFilterPhases(prev =>
      prev.includes(phase) ? prev.filter(p => p !== phase) : [...prev, phase]
    );
  };

  const handleExportExcel = async () => {
    setExporting(true);
    try {
      const count = await exportDealsExcel(filteredDeals);
      toast.success(`Se exportaron ${count} deal${count === 1 ? '' : 's'} a Excel`);
    } catch {
      toast.error('Error al exportar a Excel');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2"><TrendingUp className="w-5 h-5 text-primary" /> Comercial / Deals</h2>
          <p className="text-sm text-muted-foreground">{filteredDeals.length} de {deals.length} deals</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex border rounded-lg overflow-hidden">
            <Button variant={view === 'kanban' ? 'secondary' : 'ghost'} size="sm" className="rounded-none gap-1.5" onClick={() => setView('kanban')}>
              <LayoutGrid className="w-4 h-4" /> Kanban
            </Button>
            <Button variant={view === 'table' ? 'secondary' : 'ghost'} size="sm" className="rounded-none gap-1.5" onClick={() => setView('table')}>
              <Table2 className="w-4 h-4" /> Tabla
            </Button>
          </div>
          {canExportExcel && (
            <Button variant="outline" onClick={handleExportExcel} disabled={exporting} className="gap-2">
              {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
              Exportar a Excel
            </Button>
          )}
          <Button onClick={() => setSelectedDeal({ ...emptyDeal })} className="gap-2">
            <Plus className="w-4 h-4" /> Nuevo Deal
          </Button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 items-center">
        {/* Search */}
        <div className="relative min-w-[200px] flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            className="pl-9 pr-9 h-9"
            placeholder="Buscar por nombre, cliente..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Cliente */}
        <Popover open={clientOpen} onOpenChange={setClientOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-9 gap-1.5 font-normal">
              {filterClient || 'Cliente'}
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-0" align="start">
            <Command>
              <CommandInput placeholder="Buscar cliente..." />
              <CommandList>
                <CommandEmpty>Sin resultados</CommandEmpty>
                <CommandGroup>
                    <CommandList>
<CommandItem onSelect={() => { setFilterClient(''); setClientOpen(false); }}>
                    <Check className={`w-4 h-4 mr-2 ${!filterClient ? 'opacity-100' : 'opacity-0'}`} />
                    Todos los clientes
                  </CommandItem>
{uniqueClients.map(c => (
                    <CommandItem key={c} onSelect={() => { setFilterClient(c); setClientOpen(false); }}>
                      <Check className={`w-4 h-4 mr-2 ${filterClient === c ? 'opacity-100' : 'opacity-0'}`} />
                      {c}
                    </CommandItem>
                  ))}
                    </CommandList>
                  </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {/* Fase */}
        <Popover open={phaseOpen} onOpenChange={setPhaseOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-9 gap-1.5 font-normal">
              {filterPhases.length === 0 ? 'Fase' : `${filterPhases.length} fase${filterPhases.length > 1 ? 's' : ''}`}
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-52 p-2" align="start">
            <div className="space-y-1">
              {PHASES.map(p => (
                <button
                  key={p.key}
                  onClick={() => togglePhase(p.key)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted text-sm transition-colors"
                >
                  <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${filterPhases.includes(p.key) ? 'bg-primary border-primary' : 'border-border'}`}>
                    {filterPhases.includes(p.key) && <Check className="w-3 h-3 text-primary-foreground" />}
                  </div>
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: PHASE_COLOR_MAP[p.key] }} />
                  {p.key}
                </button>
              ))}
              {filterPhases.length > 0 && (
                <button onClick={() => setFilterPhases([])} className="w-full text-xs text-muted-foreground hover:text-foreground px-2 py-1 text-left mt-1">
                  Limpiar selección
                </button>
              )}
            </div>
          </PopoverContent>
        </Popover>

        {/* Moneda */}
        <Select value={filterCurrency || '__all__'} onValueChange={v => setFilterCurrency(v === '__all__' ? '' : v)}>
          <SelectTrigger className="h-9 w-[130px] font-normal text-sm">
            <SelectValue placeholder="Moneda" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todas</SelectItem>
            {CURRENCIES.map(c => (
              <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Fecha */}
        <Popover open={dateOpen} onOpenChange={setDateOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className={`h-9 gap-1.5 font-normal ${(filterDateFrom || filterDateTo) ? 'border-primary text-primary' : ''}`}>
              <CalendarRange className="w-4 h-4" />
              {filterDateFrom || filterDateTo
                ? `${filterDateFrom || '…'} → ${filterDateTo || '…'}`
                : 'Fecha de propuesta'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-3 space-y-3" align="start">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Fecha de propuesta</p>
            <div className="space-y-2">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Desde</label>
                <Input type="date" className="h-8 text-sm" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Hasta</label>
                <Input type="date" className="h-8 text-sm" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)} />
              </div>
            </div>
            {(filterDateFrom || filterDateTo) && (
              <button onClick={() => { setFilterDateFrom(''); setFilterDateTo(''); }} className="text-xs text-muted-foreground hover:text-foreground">
                Limpiar fechas
              </button>
            )}
          </PopoverContent>
        </Popover>

        {/* Clear all */}
        {hasFilters && (
          <Button variant="ghost" size="sm" className="h-9 gap-1.5 text-muted-foreground" onClick={clearFilters}>
            <X className="w-3.5 h-3.5" /> Limpiar filtros
          </Button>
        )}
      </div>

      {/* Pipeline phases overview */}
      {!loading && (
        <div className="flex gap-2 flex-wrap">
          {Object.entries(
            filteredDeals.reduce((acc, d) => ({ ...acc, [d.phase ?? 'Prospecto']: (acc[d.phase ?? 'Prospecto'] ?? 0) + 1 }), {} as Record<string, number>)
          ).map(([phase, count]) => (
            <div key={phase} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium"
              style={{ borderColor: PHASE_COLOR_MAP[phase] + '60', color: PHASE_COLOR_MAP[phase] }}>
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: PHASE_COLOR_MAP[phase] }} />
              {phase} ({count})
            </div>
          ))}
        </div>
      )}

      {/* Main view */}
      {loading ? (
        <div className="grid grid-cols-6 gap-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-64 rounded-xl" />)}</div>
      ) : view === 'kanban' ? (
        <DealKanban deals={filteredDeals} onDealClick={setSelectedDeal} onStatusChange={handleStatusChange}
          onNewDeal={phase => setSelectedDeal({ ...emptyDeal, phase })} />
      ) : (
        <DealTable deals={filteredDeals} onDealClick={setSelectedDeal} onDealApproved={handleDealUpdated} />
      )}

      {selectedDeal !== null && (
        <DealDetailSheet deal={selectedDeal} isOpen={true} onClose={() => setSelectedDeal(null)}
          onDealUpdated={handleDealUpdated} onDeleted={() => { load(); setSelectedDeal(null); }}
          existingClients={uniqueClients} />
      )}
    </div>
  );
}
