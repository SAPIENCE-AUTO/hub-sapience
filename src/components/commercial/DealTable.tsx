import { useState, useMemo, Fragment } from 'react';
import { GetDealsOutputType } from 'zite-endpoints-sdk';
import { Button } from '@/components/ui/button';
import { Pencil, ChevronUp, ChevronDown, ChevronRight, ChevronsUpDown, Clock, CalendarCheck, CheckCircle2 } from 'lucide-react';
import { PHASE_COLOR_MAP, getCurrencySymbol, fmtMoney } from './dealUtils';
import { cn } from '@/lib/utils';
import ApprovalReviewDialog from './ApprovalReviewDialog';

type Deal = GetDealsOutputType['deals'][0];

type SortField = 'dealName' | 'client' | 'phase' | 'tematica' | 'quotedCost' | 'clientPrice' | 'currency' | 'proposalDate' | 'approvalDate';
type SortDir = 'asc' | 'desc';
type SortMode = 'byField' | 'createdAt';

const APPROVE_PHASES = ['Cotización enviada', 'Negociación'];

/** Parsea una fecha ISO como fecha local (sin offset UTC) */
function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatLocalDate(dateStr: string): string {
  return parseLocalDate(dateStr).toLocaleDateString('es-MX');
}

function getYear(deal: Deal): string {
  const d = deal.approvalDate ?? deal.proposalDate;
  if (!d) return 'Sin fecha';
  return d.slice(0, 4);
}

function sortDeals(deals: Deal[], field: SortField, dir: SortDir): Deal[] {
  return [...deals].sort((a, b) => {
    let av: any = a[field];
    let bv: any = b[field];

    if (field === 'proposalDate' || field === 'approvalDate') {
      av = av ? parseLocalDate(av).getTime() : 0;
      bv = bv ? parseLocalDate(bv).getTime() : 0;
    } else if (field === 'quotedCost' || field === 'clientPrice') {
      av = av ?? 0;
      bv = bv ?? 0;
    } else {
      av = (av ?? '').toString().toLowerCase();
      bv = (bv ?? '').toString().toLowerCase();
    }

    if (av < bv) return dir === 'asc' ? -1 : 1;
    if (av > bv) return dir === 'asc' ? 1 : -1;
    return 0;
  });
}

function SortIcon({ field, sortField, sortDir }: { field: SortField; sortField: SortField; sortDir: SortDir }) {
  if (sortField !== field) return <ChevronsUpDown className="w-3 h-3 opacity-30 ml-1 shrink-0" />;
  return sortDir === 'asc'
    ? <ChevronUp className="w-3 h-3 ml-1 shrink-0 text-primary" />
    : <ChevronDown className="w-3 h-3 ml-1 shrink-0 text-primary" />;
}

function ColHeader({ label, field, sortField, sortDir, onSort, disabled }: {
  label: string; field: SortField;
  sortField: SortField; sortDir: SortDir;
  onSort: (f: SortField) => void;
  disabled?: boolean;
}) {
  const active = !disabled && sortField === field;
  return (
    <th className="px-3 py-3 text-left">
      <button
        onClick={() => !disabled && onSort(field)}
        disabled={disabled}
        className={cn(
          'flex items-center gap-0.5 text-xs font-semibold whitespace-nowrap transition-colors',
          disabled ? 'text-muted-foreground/50 cursor-default' : 'hover:text-foreground',
          active ? 'text-primary' : 'text-muted-foreground'
        )}
      >
        {label}
        {!disabled && <SortIcon field={field} sortField={sortField} sortDir={sortDir} />}
      </button>
    </th>
  );
}

function DealRow({ deal, onDealClick, onApprove }: {
  deal: Deal;
  onDealClick: (deal: Deal) => void;
  onApprove: (deal: Deal) => void;
}) {
  const color = PHASE_COLOR_MAP[deal.phase ?? ''] ?? 'hsl(var(--muted-foreground))';
  const sym = getCurrencySymbol(deal.currency);
  const canApprove = APPROVE_PHASES.includes(deal.phase ?? '');
  return (
    <tr className="hover:bg-muted/30 cursor-pointer" onClick={() => onDealClick(deal)}>
      <td className="px-3 py-2.5 font-medium whitespace-nowrap">{deal.dealName || '—'}</td>
      <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">{deal.client || '—'}</td>
      <td className="px-3 py-2.5">
        <span className="px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap" style={{ backgroundColor: color + '25', color }}>
          {deal.phase || '—'}
        </span>
      </td>
      <td className="px-3 py-2.5 text-muted-foreground max-w-32 truncate">{deal.tematica || '—'}</td>
      <td className="px-3 py-2.5 whitespace-nowrap">{fmtMoney(deal.quotedCost, sym)}</td>
      <td className="px-3 py-2.5 font-medium whitespace-nowrap">{fmtMoney(deal.clientPrice, sym)}</td>
      <td className="px-3 py-2.5 text-muted-foreground text-xs whitespace-nowrap">{deal.currency?.split(' ')[0] || '—'}</td>
      <td className="px-3 py-2.5 text-muted-foreground text-xs whitespace-nowrap">
        {deal.proposalDate ? formatLocalDate(deal.proposalDate) : '—'}
      </td>
      <td className="px-3 py-2.5 text-xs whitespace-nowrap">
        {deal.approvalDate
          ? <span className="text-primary font-medium">{formatLocalDate(deal.approvalDate)}</span>
          : <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-1">
          {canApprove && (
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-primary hover:text-primary hover:bg-primary/10"
              title="Aprobar deal"
              onClick={e => { e.stopPropagation(); onApprove(deal); }}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
            </Button>
          )}
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={e => { e.stopPropagation(); onDealClick(deal); }}>
            <Pencil className="w-3 h-3" />
          </Button>
        </div>
      </td>
    </tr>
  );
}

function YearGroupHeader({ year, count, collapsed, onToggle }: {
  year: string; count: number; collapsed: boolean; onToggle: () => void;
}) {
  return (
    <tr>
      <td colSpan={10} className="px-3 pt-5 pb-1.5">
        <button
          onClick={onToggle}
          className="w-full flex items-center gap-2 group text-left"
        >
          {collapsed
            ? <ChevronRight className="w-3.5 h-3.5 text-primary shrink-0" />
            : <ChevronDown className="w-3.5 h-3.5 text-primary shrink-0" />}
          <span className="text-xs font-bold text-primary tracking-widest uppercase">{year}</span>
          <span className="text-xs text-muted-foreground">({count} deals)</span>
          <div className="flex-1 h-px bg-border group-hover:bg-primary/30 transition-colors" />
        </button>
      </td>
    </tr>
  );
}

interface DealTableProps {
  deals: Deal[];
  onDealClick: (deal: Deal) => void;
  onDealApproved?: (updated: Deal) => void;
}

export default function DealTable({ deals, onDealClick, onDealApproved }: DealTableProps) {
  const [sortField, setSortField] = useState<SortField>('approvalDate');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [sortMode, setSortMode] = useState<SortMode>('createdAt');
  const [collapsedYears, setCollapsedYears] = useState<Set<string>>(new Set());
  const [approvingDeal, setApprovingDeal] = useState<Deal | null>(null);

  const toggleYear = (year: string) => {
    setCollapsedYears(prev => {
      const next = new Set(prev);
      next.has(year) ? next.delete(year) : next.add(year);
      return next;
    });
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const handleApprovalSuccess = (res: { projectCode: string; projectId: string; quotedCost: number; notificationsSent: number }) => {
    if (!approvingDeal) return;
    const today = new Date().toISOString().split('T')[0];
    const updated: Deal = { ...approvingDeal, phase: 'Ganado', approvalDate: today, quotedCost: res.quotedCost };
    (updated as any).projects = [res.projectId];
    onDealApproved?.(updated);
    setApprovingDeal(null);
  };

  const sorted = useMemo(() => {
    if (sortMode === 'createdAt') {
      return [...deals].sort((a, b) => (b.rowIndex ?? -1) - (a.rowIndex ?? -1));
    }
    return sortDeals(deals, sortField, sortDir);
  }, [deals, sortField, sortDir, sortMode]);

  // Group by year, most recent first, "Sin fecha" last
  const groups = useMemo(() => {
    const map = new Map<string, Deal[]>();
    for (const deal of sorted) {
      const y = getYear(deal);
      if (!map.has(y)) map.set(y, []);
      map.get(y)!.push(deal);
    }
    const years = [...map.keys()].sort((a, b) => {
      if (a === 'Sin fecha') return 1;
      if (b === 'Sin fecha') return -1;
      return parseInt(b) - parseInt(a);
    });
    return years.map(y => ({ year: y, deals: map.get(y)! }));
  }, [sorted]);

  const colProps = { sortField, sortDir, onSort: handleSort, disabled: sortMode === 'createdAt' };

  return (
    <>
      <div className="bg-card rounded-lg border overflow-x-auto">
        {/* Sort mode toggle */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/30">
          <span className="text-xs text-muted-foreground font-medium">Ordenar por:</span>
          <div className="flex items-center rounded-lg border border-border overflow-hidden">
            <button
              onClick={() => setSortMode('createdAt')}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium transition-colors',
                sortMode === 'createdAt'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-card text-muted-foreground hover:bg-muted'
              )}
            >
              <Clock className="w-3 h-3" />
              Último creado
            </button>
            <button
              onClick={() => setSortMode('byField')}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium transition-colors',
                sortMode === 'byField'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-card text-muted-foreground hover:bg-muted'
              )}
            >
              <CalendarCheck className="w-3 h-3" />
              Por columna
            </button>
          </div>
          {sortMode === 'byField' && (
            <span className="text-xs text-muted-foreground italic">Haz clic en los encabezados para ordenar</span>
          )}
        </div>

        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b border-border">
            <tr>
              <ColHeader label="Deal" field="dealName" {...colProps} />
              <ColHeader label="Cliente" field="client" {...colProps} />
              <ColHeader label="Fase" field="phase" {...colProps} />
              <ColHeader label="Temática" field="tematica" {...colProps} />
              <ColHeader label="Costo cotizado" field="quotedCost" {...colProps} />
              <ColHeader label="Precio cliente" field="clientPrice" {...colProps} />
              <ColHeader label="Moneda" field="currency" {...colProps} />
              <ColHeader label="F. propuesta" field="proposalDate" {...colProps} />
              <ColHeader label="F. aprobación" field="approvalDate" {...colProps} />
              <th className="px-3 py-3 w-20" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sorted.length === 0 && (
              <tr><td colSpan={10} className="px-4 py-12 text-center text-muted-foreground">Sin deals. Crea el primero.</td></tr>
            )}
            {sortMode === 'createdAt'
              ? sorted.map(deal => (
                <DealRow key={deal.id} deal={deal} onDealClick={onDealClick} onApprove={setApprovingDeal} />
              ))
              : groups.map(({ year, deals: groupDeals }) => (
                <Fragment key={year}>
                  <YearGroupHeader
                    year={year}
                    count={groupDeals.length}
                    collapsed={collapsedYears.has(year)}
                    onToggle={() => toggleYear(year)}
                  />
                  {!collapsedYears.has(year) && groupDeals.map(deal => (
                    <DealRow key={deal.id} deal={deal} onDealClick={onDealClick} onApprove={setApprovingDeal} />
                  ))}
                </Fragment>
              ))
            }
          </tbody>
        </table>
      </div>

      {approvingDeal && (
        <ApprovalReviewDialog
          open={true}
          onClose={() => setApprovingDeal(null)}
          deal={approvingDeal}
          onApproved={handleApprovalSuccess}
        />
      )}
    </>
  );
}
