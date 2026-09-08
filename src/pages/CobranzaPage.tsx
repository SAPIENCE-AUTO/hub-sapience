import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from 'zite-auth-sdk';
import { getCollectionProcesses, GetCollectionProcessesOutputType } from 'zite-endpoints-sdk';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Search, Landmark } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { fmtCurrency } from '../lib/format';

type CollectionProcess = GetCollectionProcessesOutputType['processes'][0];

const PHASES = [
  'Por iniciar', 'Proforma creada', 'Proforma enviada', 'Factura creada', 'Factura enviada',
  'Subida al portal', 'GR / Migo', 'Cobranza programada', 'Pagada', 'Atrasada',
];
const STATUSES = ['Al día', 'Atrasado', 'Pagado'];

const STATUS_STYLES: Record<string, string> = {
  'Al día': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  'Atrasado': 'bg-destructive/10 text-destructive',
  'Pagado': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
};

const PHASE_STYLES: Record<string, string> = {
  'Por iniciar': 'bg-muted text-muted-foreground',
  'Pagada': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  'Atrasada': 'bg-destructive/10 text-destructive',
};

function fmtDate(d?: string) {
  if (!d) return '—';
  return new Date(d.split('T')[0] + 'T12:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Barras por mes de fecha tentativa de pago — solo MXN (mezclar monedas en
// una sola barra confundiría más de lo que ayudaría; USD queda fuera del
// alcance de esta vista descriptiva, igual que StatsBar ya lo separa).
function MonthlyChart({ processes }: { processes: CollectionProcess[] }) {
  const data = useMemo(() => {
    const byMonth = new Map<string, number>();
    for (const p of processes) {
      if (!p.scheduledPaymentDate || !p.currency?.startsWith('MXN')) continue;
      const month = p.scheduledPaymentDate.split('T')[0].slice(0, 7);
      byMonth.set(month, (byMonth.get(month) ?? 0) + (p.collectionAmount ?? 0));
    }
    return [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, amount]) => ({
        month,
        label: new Date(month + '-02T12:00:00').toLocaleDateString('es-MX', { month: 'short', year: '2-digit' }),
        amount,
      }));
  }, [processes]);

  if (data.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl px-5 py-8 mb-6 text-center text-sm text-muted-foreground">
        Sin fechas de pago capturadas todavía — la gráfica se llena conforme se inician procesos con factura y días de crédito.
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl px-5 py-4 mb-6">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Cobranza por mes (MXN, según fecha tentativa de pago)</p>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 5, right: 10, left: 5, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
          <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" tickFormatter={v => fmtCurrency(v, 'MXN')} width={80} />
          <Tooltip formatter={(v: number) => fmtCurrency(v, 'MXN')} labelFormatter={l => `Mes: ${l}`} />
          <Bar dataKey="amount" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function StatsBar({ processes }: { processes: CollectionProcess[] }) {
  const totalMxn = processes.filter(p => p.currency?.startsWith('MXN') && p.effectiveStatus !== 'Pagado').reduce((s, p) => s + (p.collectionAmount ?? 0), 0);
  const totalUsd = processes.filter(p => p.currency?.startsWith('USD') && p.effectiveStatus !== 'Pagado').reduce((s, p) => s + (p.collectionAmount ?? 0), 0);
  const atrasados = processes.filter(p => p.effectiveStatus === 'Atrasado');
  const pagados = processes.filter(p => p.effectiveStatus === 'Pagado').length;

  const stats = [
    { label: 'Procesos activos', value: processes.filter(p => p.effectiveStatus !== 'Pagado').length, sub: `${pagados} pagados`, color: 'text-foreground' },
    { label: 'Por cobrar (MXN)', value: fmtCurrency(totalMxn, 'MXN'), sub: totalUsd > 0 ? `+ ${fmtCurrency(totalUsd, 'USD')}` : 'Sin pendientes en USD', color: 'text-primary' },
    { label: 'Atrasados', value: atrasados.length, sub: atrasados.length > 0 ? 'Requieren atención' : 'Sin atrasos', color: atrasados.length > 0 ? 'text-destructive' : 'text-muted-foreground' },
  ];

  return (
    <div className="grid grid-cols-3 gap-4 mb-6">
      {stats.map(stat => (
        <div key={stat.label} className="bg-card border border-border rounded-xl px-5 py-4">
          <p className="text-xs text-muted-foreground mb-1">{stat.label}</p>
          <p className={`text-xl font-bold ${stat.color}`}>{stat.value}</p>
          <p className="text-xs text-muted-foreground mt-1">{stat.sub}</p>
        </div>
      ))}
    </div>
  );
}

export default function CobranzaPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [processes, setProcesses] = useState<CollectionProcess[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterPhase, setFilterPhase] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const d = await getCollectionProcesses({});
      setProcesses(d.processes);
    } catch {
      setProcesses([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    return processes.filter(p => {
      if (search.trim()) {
        const q = search.toLowerCase();
        const match = p.projectCode?.toLowerCase().includes(q) || p.client?.toLowerCase().includes(q) || p.dealName?.toLowerCase().includes(q);
        if (!match) return false;
      }
      if (filterPhase && p.phase !== filterPhase) return false;
      if (filterStatus && p.effectiveStatus !== filterStatus) return false;
      return true;
    });
  }, [processes, search, filterPhase, filterStatus]);

  // Este módulo solo aparece en el nav para Owner/Finanzas (Layout.tsx), pero
  // el gate real está en el endpoint — esto es un guard de UI adicional por
  // si alguien navega directo a la URL.
  if (user && user.role !== 'Owner' && user.purchaseLevel !== 'Finanzas') {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">No tienes permisos para ver este módulo.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2"><Landmark className="w-5 h-5 text-primary" /> Cobranza</h2>
          <p className="text-sm text-muted-foreground">{filtered.length} de {processes.length} procesos</p>
        </div>
      </div>

      {!loading && <StatsBar processes={processes} />}
      {!loading && <MonthlyChart processes={processes} />}

      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative min-w-[200px] flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input className="pl-9 h-9" placeholder="Buscar por proyecto, cliente..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={filterPhase || '__all__'} onValueChange={v => setFilterPhase(v === '__all__' ? '' : v)}>
          <SelectTrigger className="h-9 w-[180px] text-sm"><SelectValue placeholder="Fase" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todas las fases</SelectItem>
            {PHASES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterStatus || '__all__'} onValueChange={v => setFilterStatus(v === '__all__' ? '' : v)}>
          <SelectTrigger className="h-9 w-[150px] text-sm"><SelectValue placeholder="Estatus" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todos</SelectItem>
            {STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="space-y-2">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-sm text-muted-foreground">Sin procesos de cobranza que coincidan con los filtros.</div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Proyecto</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Cliente</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Fase</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Estatus</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground">Monto a cobrar</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Fecha programada</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Responsable</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map(p => (
                <tr
                  key={p.id}
                  className="hover:bg-muted/20 cursor-pointer transition-colors"
                  onClick={() => p.projectCode && navigate(`/operacion/proyectos/${p.projectCode}?tab=cobranza`)}
                >
                  <td className="px-4 py-2.5 whitespace-nowrap font-medium">{p.projectCode ?? '—'}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">{p.client ?? '—'}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${PHASE_STYLES[p.phase ?? ''] ?? 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300'}`}>
                      {p.phase ?? 'Por iniciar'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${STATUS_STYLES[p.effectiveStatus ?? ''] ?? 'bg-muted text-muted-foreground'}`}>
                      {p.effectiveStatus ?? 'Al día'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-right tabular-nums font-medium">{fmtCurrency(p.collectionAmount, p.currency)}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">{fmtDate(p.scheduledPaymentDate)}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">{p.responsibleUserName ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
