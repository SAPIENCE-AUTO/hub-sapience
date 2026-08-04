import { useState, useMemo } from 'react';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { ChevronDown, X, Check, CalendarRange } from 'lucide-react';
import { DashboardFilters, DateReference, Deal } from '@/lib/commercial-dashboard/types';
import { DEFAULT_FILTERS, PHASE_ORDER } from '@/lib/commercial-dashboard/constants';
import { PHASE_COLOR_MAP } from '@/components/commercial/dealUtils';

interface Props {
  filters: DashboardFilters;
  dateRef: DateReference;
  deals: Deal[];
  onFiltersChange: (f: DashboardFilters) => void;
  onDateRefChange: (r: DateReference) => void;
}

const YEARS = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i);
const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function fmtShort(iso: string): string {
  try { return format(parseISO(iso), 'd MMM', { locale: es }); } catch { return iso; }
}

export default function CommercialDashboardFilters({
  filters, dateRef, deals, onFiltersChange, onDateRefChange,
}: Props) {
  const [clientOpen, setClientOpen] = useState(false);
  const [empresaOpen, setEmpresaOpen] = useState(false);
  const [phaseOpen, setPhaseOpen] = useState(false);
  const [fromOpen, setFromOpen] = useState(false);
  const [toOpen, setToOpen] = useState(false);

  const uniqueClients = useMemo(
    () => [...new Set(deals.map(d => d.client).filter(Boolean) as string[])].sort(), [deals]
  );
  const uniqueEmpresas = useMemo(
    () => [...new Set(deals.map(d => d.empresaOperadora).filter(Boolean) as string[])].sort(), [deals]
  );

  const p = filters.period;
  const hasFilters =
    p.mode !== 'all' ||
    filters.clients.length > 0 ||
    filters.empresaOperadora.length > 0 ||
    filters.currencies.length > 0 ||
    filters.phases.length > 0;

  function setMode(mode: 'all' | 'year' | 'quarter' | 'month' | 'custom') {
    const yr = new Date().getFullYear();
    const mo = new Date().getMonth() + 1;
    if (mode === 'all') onFiltersChange({ ...filters, period: { mode: 'all' } });
    else if (mode === 'year') onFiltersChange({ ...filters, period: { mode: 'year', year: yr } });
    else if (mode === 'quarter') onFiltersChange({ ...filters, period: { mode: 'quarter', year: yr, quarter: Math.ceil(mo / 3) } });
    else if (mode === 'month') onFiltersChange({ ...filters, period: { mode: 'month', year: yr, month: mo } });
    else onFiltersChange({ ...filters, period: { mode: 'custom', startDate: undefined, endDate: undefined } });
  }

  function setStartDate(date: Date | undefined) {
    const iso = date ? format(date, 'yyyy-MM-dd') : undefined;
    onFiltersChange({ ...filters, period: { mode: 'custom', startDate: iso, endDate: p.endDate } });
    setFromOpen(false);
  }

  function setEndDate(date: Date | undefined) {
    const iso = date ? format(date, 'yyyy-MM-dd') : undefined;
    onFiltersChange({ ...filters, period: { mode: 'custom', startDate: p.startDate, endDate: iso } });
    setToOpen(false);
  }

  function toggleClient(c: string) {
    const next = filters.clients.includes(c) ? filters.clients.filter(x => x !== c) : [...filters.clients, c];
    onFiltersChange({ ...filters, clients: next });
  }

  function toggleEmpresa(val: string) {
    const next = filters.empresaOperadora.includes(val) ? filters.empresaOperadora.filter(x => x !== val) : [...filters.empresaOperadora, val];
    onFiltersChange({ ...filters, empresaOperadora: next });
  }

  function togglePhase(val: string) {
    const next = filters.phases.includes(val) ? filters.phases.filter(x => x !== val) : [...filters.phases, val];
    onFiltersChange({ ...filters, phases: next });
  }

  const clientItems = uniqueClients.map(c => (
    <CommandItem key={c} onSelect={() => toggleClient(c)}>
      <Check className={`w-4 h-4 mr-2 ${filters.clients.includes(c) ? 'opacity-100' : 'opacity-0'}`} />{c}
    </CommandItem>
  ));

  const MODES = [
    { key: 'all', label: 'Todo' },
    { key: 'year', label: 'Año' },
    { key: 'quarter', label: 'Q' },
    { key: 'month', label: 'Mes' },
    { key: 'custom', label: 'Rango' },
  ] as const;

  return (
    <div className="flex flex-wrap gap-2 items-center">
      {/* Period mode toggle */}
      <div className="flex border rounded-lg overflow-hidden text-xs">
        {MODES.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setMode(key)}
            className={`px-3 py-1.5 font-medium transition-colors ${
              p.mode === key ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Year selector */}
      {(p.mode === 'year' || p.mode === 'quarter' || p.mode === 'month') && (
        <Select
          value={String(p.year ?? new Date().getFullYear())}
          onValueChange={y => onFiltersChange({ ...filters, period: { ...p, year: Number(y) } })}
        >
          <SelectTrigger className="h-8 w-20 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{YEARS.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
        </Select>
      )}

      {/* Quarter selector */}
      {p.mode === 'quarter' && (
        <Select
          value={String(p.quarter ?? 1)}
          onValueChange={q => onFiltersChange({ ...filters, period: { ...p, quarter: Number(q) } })}
        >
          <SelectTrigger className="h-8 w-16 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{[1,2,3,4].map(q => <SelectItem key={q} value={String(q)}>Q{q}</SelectItem>)}</SelectContent>
        </Select>
      )}

      {/* Month selector */}
      {p.mode === 'month' && (
        <Select
          value={String(p.month ?? 1)}
          onValueChange={m => onFiltersChange({ ...filters, period: { ...p, month: Number(m) } })}
        >
          <SelectTrigger className="h-8 w-20 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{MONTHS.map((mn, i) => <SelectItem key={i+1} value={String(i+1)}>{mn}</SelectItem>)}</SelectContent>
        </Select>
      )}

      {/* Custom date range pickers */}
      {p.mode === 'custom' && (
        <div className="flex items-center gap-1">
          {/* From date */}
          <Popover open={fromOpen} onOpenChange={setFromOpen}>
            <PopoverTrigger asChild>
              <button className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium hover:bg-muted transition-colors ${p.startDate ? 'text-foreground' : 'text-muted-foreground'}`}>
                <CalendarRange className="w-3 h-3" />
                {p.startDate ? fmtShort(p.startDate) : 'Desde'}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={p.startDate ? parseISO(p.startDate) : undefined}
                onSelect={setStartDate}
                defaultMonth={p.startDate ? parseISO(p.startDate) : undefined}
                toDate={p.endDate ? parseISO(p.endDate) : undefined}
                initialFocus
              />
              {p.startDate && (
                <div className="p-2 border-t">
                  <Button variant="ghost" size="sm" className="w-full text-xs h-7 text-muted-foreground" onClick={() => setStartDate(undefined)}>
                    Quitar fecha inicio
                  </Button>
                </div>
              )}
            </PopoverContent>
          </Popover>

          <span className="text-muted-foreground text-xs">–</span>

          {/* To date */}
          <Popover open={toOpen} onOpenChange={setToOpen}>
            <PopoverTrigger asChild>
              <button className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium hover:bg-muted transition-colors ${p.endDate ? 'text-foreground' : 'text-muted-foreground'}`}>
                {p.endDate ? fmtShort(p.endDate) : 'Hasta'}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={p.endDate ? parseISO(p.endDate) : undefined}
                onSelect={setEndDate}
                defaultMonth={p.endDate ? parseISO(p.endDate) : undefined}
                fromDate={p.startDate ? parseISO(p.startDate) : undefined}
                initialFocus
              />
              {p.endDate && (
                <div className="p-2 border-t">
                  <Button variant="ghost" size="sm" className="w-full text-xs h-7 text-muted-foreground" onClick={() => setEndDate(undefined)}>
                    Quitar fecha fin
                  </Button>
                </div>
              )}
            </PopoverContent>
          </Popover>
        </div>
      )}

      {/* Date reference toggle */}
      <button
        onClick={() => onDateRefChange(dateRef === 'proposalDate' ? 'approvalDate' : 'proposalDate')}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium hover:bg-muted transition-colors"
      >
        {dateRef === 'proposalDate' ? '📅 Propuesta' : '✅ Aprobación'}
      </button>

      {/* Client filter */}
      <Popover open={clientOpen} onOpenChange={setClientOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1 font-normal">
            {filters.clients.length > 0 ? `${filters.clients.length} cliente(s)` : 'Cliente'}
            <ChevronDown className="w-3 h-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-0" align="start">
          <Command>
            <CommandInput placeholder="Buscar..." />
            <CommandList>
              <CommandEmpty>Sin resultados</CommandEmpty>
              <CommandGroup>{clientItems}</CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* Empresa filter */}
      {uniqueEmpresas.length > 0 && (
        <Popover open={empresaOpen} onOpenChange={setEmpresaOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1 font-normal">
              {filters.empresaOperadora.length > 0 ? `${filters.empresaOperadora.length} empresa(s)` : 'Empresa'}
              <ChevronDown className="w-3 h-3" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-44 p-2" align="start">
            <div className="space-y-1">
              {uniqueEmpresas.map(e => (
                <button key={e} onClick={() => toggleEmpresa(e)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted text-sm">
                  <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${filters.empresaOperadora.includes(e) ? 'bg-primary border-primary' : 'border-border'}`}>
                    {filters.empresaOperadora.includes(e) && <Check className="w-3 h-3 text-primary-foreground" />}
                  </div>
                  {e}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}

      {/* Phase filter */}
      <Popover open={phaseOpen} onOpenChange={setPhaseOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1 font-normal">
            {filters.phases.length > 0 ? `${filters.phases.length} fase(s)` : 'Fase'}
            <ChevronDown className="w-3 h-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-52 p-2" align="start">
          <div className="space-y-1">
            {PHASE_ORDER.map(phase => (
              <button key={phase} onClick={() => togglePhase(phase)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted text-sm">
                <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${filters.phases.includes(phase) ? 'bg-primary border-primary' : 'border-border'}`}>
                  {filters.phases.includes(phase) && <Check className="w-3 h-3 text-primary-foreground" />}
                </div>
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: PHASE_COLOR_MAP[phase] }} />
                {phase}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/* Currency filter */}
      <Select
        value={filters.currencies[0] || '__all__'}
        onValueChange={v => onFiltersChange({ ...filters, currencies: v === '__all__' ? [] : [v] })}
      >
        <SelectTrigger className="h-8 w-[100px] text-xs font-normal"><SelectValue placeholder="Moneda" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">Todas</SelectItem>
          <SelectItem value="MXN 🇲🇽">MXN</SelectItem>
          <SelectItem value="USD 🇺🇸">USD</SelectItem>
          <SelectItem value="EUR 🇪🇺">EUR</SelectItem>
        </SelectContent>
      </Select>

      {/* Compare mode */}
      {p.mode !== 'all' && p.mode !== 'custom' && (
        <Select
          value={filters.compareMode ?? 'previous'}
          onValueChange={v => onFiltersChange({ ...filters, compareMode: v as any })}
        >
          <SelectTrigger className="h-8 w-[130px] text-xs font-normal"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="previous">vs Anterior</SelectItem>
            <SelectItem value="yoy">vs Año ant. (YoY)</SelectItem>
            <SelectItem value="none">Sin comparación</SelectItem>
          </SelectContent>
        </Select>
      )}

      {/* Clear all */}
      {hasFilters && (
        <Button variant="ghost" size="sm" className="h-8 text-xs gap-1 text-muted-foreground" onClick={() => onFiltersChange(DEFAULT_FILTERS)}>
          <X className="w-3 h-3" /> Limpiar
        </Button>
      )}
    </div>
  );
}
