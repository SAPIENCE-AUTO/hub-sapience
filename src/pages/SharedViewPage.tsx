import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { getSharedViewData, GetSharedViewDataOutputType } from 'zite-endpoints-sdk';
import { StatusBadge } from '../components/StatusBadge';
import { Skeleton } from '@/components/ui/skeleton';
import { Share2, Users, ChevronDown, ChevronRight, RefreshCw, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { getGroupColor } from '../components/table/tableUtils';


type Row = NonNullable<GetSharedViewDataOutputType['rows']>[0];
type DynCol = NonNullable<GetSharedViewDataOutputType['dynamicColumns']>[0];
type GroupInfo = NonNullable<GetSharedViewDataOutputType['groups']>[0] & {
  eventDate?: string;
  durationHours?: number;
  location?: string;
};

const FIXED_COL_LABELS: Record<string, string> = {
  participantName: 'Participante',
  email: 'Email',
  phone: 'Teléfono',
  idNumber: 'ID / Doc',
  status: 'Estado',
};

function CellValue({ col, row }: { col: string; row: Row; dynCols: DynCol[] }) {
  if (col === 'status') return <StatusBadge status={row.status} />;
  if (FIXED_COL_LABELS[col]) {
    const val = (row as unknown as Record<string, string | undefined>)[col] ?? '';
    return <span className="text-sm text-foreground truncate">{val}</span>;
  }
  const val = row.dynamicValues?.[col] ?? '';
  return <span className="text-sm text-foreground truncate">{val}</span>;
}

const COLOR_ID_TO_VAR: Record<string, string> = {
  // New 6×5 system
  'red-1': '--group-red-1', 'red-2': '--group-red-2', 'red-3': '--group-red-3', 'red-4': '--group-red-4', 'red-5': '--group-red-5',
  'orange-1': '--group-orange-1', 'orange-2': '--group-orange-2', 'orange-3': '--group-orange-3', 'orange-4': '--group-orange-4', 'orange-5': '--group-orange-5',
  'yellow-1': '--group-yellow-1', 'yellow-2': '--group-yellow-2', 'yellow-3': '--group-yellow-3', 'yellow-4': '--group-yellow-4', 'yellow-5': '--group-yellow-5',
  'green-1': '--group-green-1', 'green-2': '--group-green-2', 'green-3': '--group-green-3', 'green-4': '--group-green-4', 'green-5': '--group-green-5',
  'blue-1': '--group-blue-1', 'blue-2': '--group-blue-2', 'blue-3': '--group-blue-3', 'blue-4': '--group-blue-4', 'blue-5': '--group-blue-5',
  'purple-1': '--group-purple-1', 'purple-2': '--group-purple-2', 'purple-3': '--group-purple-3', 'purple-4': '--group-purple-4', 'purple-5': '--group-purple-5',
  // Backward compat
  chart1: '--group-blue-2', chart2: '--group-green-2', chart3: '--group-orange-2',
  chart4: '--group-purple-2', chart5: '--group-blue-1', primary: '--group-blue-3',
  destructive: '--group-red-3', muted: '--group-blue-5',
  'group-pink': '--group-red-1', 'group-yellow': '--group-yellow-2', 'group-lime': '--group-green-1',
  'group-teal': '--group-green-3', 'group-indigo': '--group-blue-4', 'group-amber': '--group-orange-2',
  'group-rose': '--group-red-2', 'group-emerald': '--group-green-2', 'group-sky': '--group-blue-1',
  'group-violet': '--group-purple-2', 'group-fuchsia': '--group-purple-1', 'group-slate': '--group-blue-5',
};

const CDMX_TZ = 'America/Mexico_City';

function formatEventSchedule(group: GroupInfo): string | null {
  if (!group.eventDate) return null;
  try {
    const d = new Date(group.eventDate);
    // Force CDMX timezone so external users always see the correct local time
    const rawDate = new Intl.DateTimeFormat('es-MX', {
      timeZone: CDMX_TZ, weekday: 'short', day: 'numeric', month: 'short',
    }).format(d);
    const datePart = rawDate.replace(/\./g, '').replace(/\s+/g, ' ').trim();
    const rawTime = new Intl.DateTimeFormat('es-MX', {
      timeZone: CDMX_TZ, hour: 'numeric', minute: '2-digit', hour12: true,
    }).format(d);
    const timePart = rawTime
      .replace(/\s*a\.\s*m\./i, ' AM')
      .replace(/\s*p\.\s*m\./i, ' PM')
      .trim();
    const durPart = group.durationHours != null
      ? (group.durationHours < 1
        ? `${Math.round(group.durationHours * 60)} min`
        : `${group.durationHours} hrs`)
      : null;
    const locPart = group.location?.trim() || null;
    return ['📅 ' + datePart, timePart, durPart, locPart].filter(Boolean).join(' · ');
  } catch { return null; }
}

function GroupHeader({
  group, count, isExpanded, onToggle, colCount,
}: {
  group: GroupInfo | null;
  count: number;
  isExpanded: boolean;
  onToggle: () => void;
  colCount: number;
}) {
  const isNone = !group;
  const color = isNone ? '#374151' : getGroupColor(group?.colorId);
  const cssVar = group?.colorId ? (COLOR_ID_TO_VAR[group.colorId] ?? '--muted-foreground') : '--muted-foreground';
  const pastelBg = isNone
    ? '#374151'
    : `color-mix(in srgb, hsl(var(${cssVar})) 12%, hsl(var(--card)))`;

  const scheduleLine = group ? formatEventSchedule(group) : null;

  return (
    <tr>
      <td
        colSpan={colCount + 1}
        style={{
          position: 'sticky',
          top: 41,
          zIndex: 10,
          background: pastelBg,
          borderLeft: `4px solid ${color}`,
          borderBottom: '1px solid hsl(var(--border) / 0.2)',
        }}
      >
        <div
          className={`flex items-center gap-2 px-3 py-2 cursor-pointer select-none${isNone ? ' text-white' : ''}`}
          onClick={onToggle}
        >
          <span className={`flex-shrink-0 ${isNone ? 'text-white/70' : 'text-muted-foreground'}`}>
            {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </span>
          <div
            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
            style={{
              backgroundColor: isNone ? undefined : color,
              border: isNone ? '1.5px dashed rgba(255,255,255,0.5)' : undefined,
            }}
          />
          {/* Group name */}
          <span className="font-black text-sm flex-shrink-0" title={group?.name ?? 'Sin grupo'}>
            {group?.name ?? 'Sin grupo'}
          </span>
          {/* Count badge — right after name */}
          <span className={`text-xs px-1.5 py-0.5 rounded-full flex-shrink-0 border ${
            isNone
              ? 'bg-white/20 border-white/20 text-white'
              : 'text-muted-foreground bg-background border-border/40'
          }`}>
            {count}
          </span>
          {/* Event schedule badge — after count */}
          {scheduleLine && (
            <span
              className="text-xs font-bold text-foreground whitespace-nowrap px-2 py-0.5 rounded-full bg-background/60 border border-border/30 flex-shrink truncate min-w-0"
              title={scheduleLine}
            >
              {scheduleLine}
            </span>
          )}
          <div className="flex-1" />
        </div>
      </td>
    </tr>
  );
}

function TableRow({ row, idx, visibleCols, dynCols }: {
  row: Row; idx: number; visibleCols: string[]; dynCols: DynCol[];
}) {
  return (
    <tr className="border-b border-border/50 hover:bg-muted/30 transition-colors h-12">
      <td className="px-4 text-xs text-muted-foreground/50 tabular-nums w-8 overflow-hidden">{idx}</td>
      {visibleCols.map(col => (
        <td key={col} className="px-4 overflow-hidden">
          <div className="whitespace-normal break-words min-w-[120px]">
            <CellValue col={col} row={row} dynCols={dynCols} />
          </div>
        </td>
      ))}
    </tr>
  );
}

export default function SharedViewPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<GetSharedViewDataOutputType | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['__none__']));
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [secsSince, setSecsSince] = useState(0);
  const seenGroupIds = useRef<Set<string>>(new Set(['__none__']));
  const lastFetchedAt = useRef<number>(0);

  const fetchData = useCallback((opts?: { silent?: boolean }) => {
    if (!token) return Promise.resolve();
    if (opts?.silent) setRefreshing(true);
    return getSharedViewData({ token }).then(d => {
      setData(d);
      setLastUpdated(new Date());
      setSecsSince(0);
      lastFetchedAt.current = Date.now();

      if (d.groups?.length) {
        const newIds = d.groups.map(g => g.id);
        setExpandedGroups(prev => {
          const next = new Set(prev);
          newIds.forEach(id => {
            if (!seenGroupIds.current.has(id)) next.add(id);
          });
          newIds.forEach(id => seenGroupIds.current.add(id));
          return next;
        });
      }
    }).finally(() => { if (opts?.silent) setRefreshing(false); });
  }, [token]);

  // Initial load
  useEffect(() => {
    fetchData().then(() => setLoading(false)).catch(() => setLoading(false));
  }, [fetchData]);

  // "X sec ago" counter — ticks every second (no workflow runs)
  useEffect(() => {
    const tickId = setInterval(() => setSecsSince(s => s + 1), 1000);
    return () => clearInterval(tickId);
  }, []);

  // Refetch when tab becomes visible again (guard: 30s since last fetch)
  useEffect(() => {
    const onVisChange = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastFetchedAt.current >= 300_000) {
        fetchData({ silent: true }).catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVisChange);
    return () => document.removeEventListener('visibilitychange', onVisChange);
  }, [fetchData]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="border-b border-border bg-card px-6 py-5">
          <Skeleton className="h-6 w-56 mb-2" />
          <Skeleton className="h-4 w-80" />
        </div>
        <div className="max-w-7xl mx-auto px-6 py-8 space-y-2">
          <Skeleton className="h-10 w-full rounded-lg" />
          {[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} className="h-12 w-full rounded" />)}
        </div>
      </div>
    );
  }

  if (!data?.found) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center p-10 max-w-sm">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
            <Share2 className="w-7 h-7 text-muted-foreground/50" />
          </div>
          <h1 className="text-xl font-semibold mb-2">Vista no disponible</h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Este link no existe o ha sido desactivado por quien lo creó.
          </p>
        </div>
      </div>
    );
  }

  const visibleCols = data.visibleColumns ?? ['participantName', 'email', 'phone', 'status'];
  const dynCols = data.dynamicColumns ?? [];
  const rows = data.rows ?? [];
  const groups = data.groups ?? [];

  const getColLabel = (col: string): string => {
    if (FIXED_COL_LABELS[col]) return FIXED_COL_LABELS[col];
    return dynCols.find(d => d.id === col)?.label ?? col;
  };

  const toggleGroup = (id: string) => {
    setExpandedGroups(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const rowsByGroup: Record<string, Row[]> = { __none__: [] };
  for (const g of groups) rowsByGroup[g.id] = [];
  for (const row of rows) {
    const gid = row.groupId;
    if (gid && rowsByGroup[gid]) rowsByGroup[gid].push(row);
    else rowsByGroup.__none__.push(row);
  }

  const noneRows = rowsByGroup.__none__!;
  const showNoneSection = noneRows.length > 0;

  let globalIdx = 0;
  const colCount = visibleCols.length;

  const tableHeader = (
    <thead>
      <tr className="bg-muted border-b border-border h-11" style={{ position: 'sticky', top: 0, zIndex: 20 }}>
        <th className="text-left px-4 text-xs font-semibold text-muted-foreground w-8 tabular-nums">#</th>
        {visibleCols.map(col => (
          <th key={col} className="text-left px-4 text-xs font-semibold text-muted-foreground whitespace-nowrap">
            {getColLabel(col)}
          </th>
        ))}
      </tr>
    </thead>
  );

  const secsLabel = secsSince < 60
    ? `hace ${secsSince} seg`
    : `hace ${Math.floor(secsSince / 60)} min`;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* ── Header ── */}
      <header className="border-b border-border bg-card flex-shrink-0">
        <div className="max-w-7xl mx-auto px-6 py-5 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              {data.projectCode && (
                <span className="font-mono text-xs bg-primary/10 text-primary px-2 py-0.5 rounded font-medium">
                  {data.projectCode}
                </span>
              )}
              <span className="text-xs text-muted-foreground">
                Tablero: <span className="font-medium text-foreground">{data.boardName}</span>
              </span>
            </div>
            <h1 className="text-xl font-semibold text-foreground">{data.viewName}</h1>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground flex-shrink-0">
            <Users className="w-4 h-4" />
            <span className="font-medium text-foreground">{rows.length}</span>
            <span>{rows.length === 1 ? 'participante' : 'participantes'}</span>
          </div>
        </div>
      </header>

      {/* ── Table ── */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-6 py-6">
        {rows.length > 0 && (
          <div className="flex items-center gap-1 mb-3">
            {groups.length > 0 && (
              <>
                <button
                  onClick={() => setExpandedGroups(new Set(groups.map(g => g.id)))}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2.5 py-1 rounded-md hover:bg-muted/60 transition-colors"
                >
                  <ChevronsUpDown className="w-3.5 h-3.5" />
                  Expandir todos
                </button>
                <button
                  onClick={() => setExpandedGroups(new Set())}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2.5 py-1 rounded-md hover:bg-muted/60 transition-colors"
                >
                  <ChevronsDownUp className="w-3.5 h-3.5" />
                  Contraer todos
                </button>
              </>
            )}
            <div className="ml-auto flex items-center gap-3">
              {lastUpdated && (
                <span className="text-xs text-muted-foreground/60">
                  Última actualización: {secsLabel}
                </span>
              )}
              <button
                disabled={refreshing || secsSince < 5}
                onClick={() => fetchData({ silent: true }).catch(() => {})}
                className="flex items-center gap-1.5 bg-destructive text-destructive-foreground hover:bg-destructive/90 px-3 py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RefreshCw className={`w-3.5 h-3.5${refreshing ? ' animate-spin' : ''}`} />
                Actualizar
              </button>
            </div>
          </div>
        )}
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Users className="w-10 h-10 text-muted-foreground/20 mb-3" />
            <p className="text-base font-medium text-muted-foreground">Sin participantes</p>
            <p className="text-sm text-muted-foreground/60 mt-1">
              No hay registros que coincidan con los filtros configurados.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-border overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table
                className="min-w-full text-sm"
                style={{ borderCollapse: 'separate', borderSpacing: 0 }}
              >
                {tableHeader}
                <tbody>
                  {showNoneSection && (
                    <React.Fragment key="__none__">
                      <GroupHeader
                        group={null}
                        count={noneRows.length}
                        isExpanded={expandedGroups.has('__none__')}
                        onToggle={() => toggleGroup('__none__')}
                        colCount={colCount}
                      />
                      {expandedGroups.has('__none__') && noneRows.map(row => {
                        globalIdx++;
                        return (
                          <TableRow key={row.id} row={row} idx={globalIdx} visibleCols={visibleCols} dynCols={dynCols} />
                        );
                      })}
                    </React.Fragment>
                  )}
                  {groups.map(group => {
                    const groupRows = rowsByGroup[group.id] ?? [];
                    const isExpanded = expandedGroups.has(group.id);
                    return (
                      <React.Fragment key={group.id}>
                        <GroupHeader
                          group={group}
                          count={groupRows.length}
                          isExpanded={isExpanded}
                          onToggle={() => toggleGroup(group.id)}
                          colCount={colCount}
                        />
                        {isExpanded && groupRows.map(row => {
                          globalIdx++;
                          return (
                            <TableRow key={row.id} row={row} idx={globalIdx} visibleCols={visibleCols} dynCols={dynCols} />
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* ── Footer ── */}
      <footer className="border-t border-border bg-card py-3 px-6 flex-shrink-0">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Share2 className="w-3 h-3" />
            Vista de solo lectura
          </p>
          <p className="text-xs text-muted-foreground/50">{rows.length} registro{rows.length !== 1 ? 's' : ''}</p>
        </div>
      </footer>
    </div>
  );
}
