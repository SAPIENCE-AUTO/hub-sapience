import { useState, useEffect, useMemo } from 'react';
import { useAuth } from 'zite-auth-sdk';
import { getCotizacionesAdmin, saveCotizacion, importCotizacionesFromCsv } from 'zite-endpoints-sdk';
import type { GetCotizacionesAdminOutputType } from 'zite-endpoints-sdk';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Link2, RefreshCw, Upload, Search, ExternalLink } from 'lucide-react';

type Cotizacion = GetCotizacionesAdminOutputType['cotizaciones'][0];
type Deal = GetCotizacionesAdminOutputType['dealsList'][0];

const fmt = (v: number | null) =>
  v == null ? '—' : new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(v);

// ── Row component ─────────────────────────────────────────────────────────────
function CotizRow({
  cotiz, deals, onLinked, onToggleIncluded,
}: {
  cotiz: Cotizacion;
  deals: Deal[];
  onLinked: () => void;
  onToggleIncluded: (id: string, val: boolean) => Promise<void>;
}) {
  const [selectedDealId, setSelectedDealId] = useState('');
  const [linking, setLinking] = useState(false);
  const [toggling, setToggling] = useState(false);

  const handleLink = async () => {
    if (!selectedDealId) return;
    setLinking(true);
    try {
      await saveCotizacion({ id: cotiz.id, deal: [selectedDealId] });
      toast.success('Cotización vinculada al deal');
      onLinked();
    } catch {
      toast.error('Error al vincular');
    } finally {
      setLinking(false);
    }
  };

  const handleToggle = async (val: boolean) => {
    setToggling(true);
    try {
      await onToggleIncluded(cotiz.id, val);
    } finally {
      setToggling(false);
    }
  };

  return (
    <tr className="border-b border-border hover:bg-muted/30 transition-colors">
      <td className="px-4 py-3 text-sm font-medium text-foreground max-w-xs truncate">
        {cotiz.cotizacionName || <span className="text-muted-foreground italic">Sin nombre</span>}
      </td>
      <td className="px-4 py-3 text-sm text-muted-foreground">{cotiz.currency}</td>
      <td className="px-4 py-3 text-sm text-right tabular-nums">{fmt(cotiz.totalCost)}</td>
      <td className="px-4 py-3 text-sm text-right tabular-nums font-medium">{fmt(cotiz.clientPrice)}</td>
      <td className="px-4 py-3">
        {cotiz.dealName ? (
          <span className="text-sm text-foreground">{cotiz.dealName}</span>
        ) : (
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-xs">Sin deal</Badge>
            <Select value={selectedDealId} onValueChange={setSelectedDealId}>
              <SelectTrigger className="h-7 text-xs w-40">
                <SelectValue placeholder="Elegir deal..." />
              </SelectTrigger>
              <SelectContent>
                {deals.map(d => (
                  <SelectItem key={d.id} value={d.id}>{d.dealName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1"
              disabled={!selectedDealId || linking}
              onClick={handleLink}
            >
              <Link2 className="w-3 h-3" />
              {linking ? 'Vinculando...' : 'Vincular'}
            </Button>
          </div>
        )}
      </td>
      <td className="px-4 py-3">
        <Badge variant={cotiz.status === 'Aprobada' ? 'default' : 'secondary'} className="text-xs">
          {cotiz.status}
        </Badge>
      </td>
      <td className="px-4 py-3">
        <Switch
          checked={cotiz.included}
          disabled={toggling}
          onCheckedChange={handleToggle}
        />
      </td>
    </tr>
  );
}

// ── Import panel ──────────────────────────────────────────────────────────────
function ImportPanel({ onDone }: { onDone: () => void }) {
  const [csvUrl, setCsvUrl] = useState('');
  const [currency, setCurrency] = useState('MXN');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{
    totalCotizaciones: number; matchedCount: number;
    unmatchedNames: string[]; totalLineItems: number;
  } | null>(null);

  const handleImport = async () => {
    if (!csvUrl.trim()) { toast.error('Ingresa la URL del CSV'); return; }
    setImporting(true);
    setResult(null);
    try {
      const res = await importCotizacionesFromCsv({ csvUrl: csvUrl.trim(), currency });
      setResult(res);
      toast.success(`Importadas ${res.totalCotizaciones} cotizaciones (${res.matchedCount} con deal)`);
      onDone();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Error al importar';
      toast.error(msg);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <p className="text-sm font-medium text-foreground flex items-center gap-2">
        <Upload className="w-4 h-4 text-muted-foreground" />
        Importar cotizaciones desde CSV
      </p>
      <div className="flex gap-2 flex-wrap">
        <Input
          className="flex-1 min-w-60 h-9 text-sm"
          placeholder="URL del archivo CSV..."
          value={csvUrl}
          onChange={e => setCsvUrl(e.target.value)}
        />
        <Select value={currency} onValueChange={setCurrency}>
          <SelectTrigger className="w-28 h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="MXN">MXN</SelectItem>
            <SelectItem value="USD">USD</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" disabled={importing} onClick={handleImport} className="h-9 gap-2">
          {importing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          {importing ? 'Importando...' : 'Importar'}
        </Button>
      </div>
      {result && (
        <div className="text-xs text-muted-foreground space-y-1">
          <p>✅ {result.totalCotizaciones} cotizaciones · {result.totalLineItems} line items · {result.matchedCount} con deal</p>
          {result.unmatchedNames.length > 0 && (
            <details>
              <summary className="cursor-pointer text-amber-600">
                ⚠️ {result.unmatchedNames.length} sin match con deal (click para ver)
              </summary>
              <div className="mt-1 max-h-32 overflow-y-auto pl-2 space-y-0.5">
                {result.unmatchedNames.map(n => <p key={n}>{n}</p>)}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function CotizacionesAdminPage() {
  const { user, isLoading, loginWithRedirect } = useAuth();
  const [data, setData] = useState<GetCotizacionesAdminOutputType | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'all' | 'sin-deal' | 'con-deal'>('all');
  const [search, setSearch] = useState('');
  const [showImport, setShowImport] = useState(false);

  useEffect(() => {
    if (!isLoading && !user) loginWithRedirect({ redirectUrl: window.location.href });
  }, [isLoading, user, loginWithRedirect]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await getCotizacionesAdmin({});
      setData(res);
    } catch { toast.error('Error al cargar cotizaciones'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handleToggleIncluded = async (id: string, val: boolean) => {
    await saveCotizacion({ id, included: val });
    setData(prev => prev ? {
      ...prev,
      cotizaciones: prev.cotizaciones.map(c => c.id === id ? { ...c, included: val } : c),
    } : prev);
  };

  const filtered = useMemo(() => {
    if (!data) return [];
    let list = data.cotizaciones;
    if (tab === 'sin-deal') list = list.filter(c => !c.dealId);
    if (tab === 'con-deal') list = list.filter(c => !!c.dealId);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(c =>
        c.cotizacionName?.toLowerCase().includes(q) ||
        c.dealName?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [data, tab, search]);

  const sinDealCount = data?.cotizaciones.filter(c => !c.dealId).length ?? 0;

  if (isLoading || !user) return null;

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Cotizaciones</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Gestión y vinculación de cotizaciones a deals
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => setShowImport(v => !v)} className="gap-2">
            <Upload className="w-4 h-4" />
            Importar CSV
          </Button>
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Actualizar
          </Button>
        </div>
      </div>

      {/* Import panel */}
      {showImport && <ImportPanel onDone={() => { setShowImport(false); load(); }} />}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <Tabs value={tab} onValueChange={v => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="all">Todas {data && `(${data.cotizaciones.length})`}</TabsTrigger>
            <TabsTrigger value="sin-deal">
              Sin deal
              {sinDealCount > 0 && (
                <Badge variant="destructive" className="ml-1.5 text-xs px-1.5 py-0">{sinDealCount}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="con-deal">Con deal</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative flex-1 min-w-52 max-w-72">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            className="pl-8 h-9 text-sm"
            placeholder="Buscar cotización o deal..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[800px]">
            <thead className="bg-muted/50 text-muted-foreground border-b border-border">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Nombre</th>
                <th className="px-4 py-3 text-left font-medium">Moneda</th>
                <th className="px-4 py-3 text-right font-medium">Costo Total</th>
                <th className="px-4 py-3 text-right font-medium">P. Cliente</th>
                <th className="px-4 py-3 text-left font-medium">Deal vinculado</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-left font-medium">Incluida</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-card">
              {loading ? (
                [...Array(8)].map((_, i) => (
                  <tr key={i}><td colSpan={7} className="px-4 py-3"><Skeleton className="h-5 w-full" /></td></tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground text-sm">
                    <ExternalLink className="w-8 h-8 mx-auto mb-2 opacity-20" />
                    No hay cotizaciones que mostrar
                  </td>
                </tr>
              ) : (
                filtered.map(c => (
                  c.restricted ? (
                    <tr key={c.id}><td colSpan={7} className="px-4 py-3"><Skeleton className="h-5 w-full" /></td></tr>
                  ) : (
                    <CotizRow
                      key={c.id}
                      cotiz={c}
                      deals={data?.dealsList ?? []}
                      onLinked={load}
                      onToggleIncluded={handleToggleIncluded}
                    />
                  )
                ))
              )}
            </tbody>
          </table>
        </div>
        {!loading && filtered.length > 0 && (
          <div className="px-4 py-2 bg-muted/30 border-t border-border text-xs text-muted-foreground">
            {filtered.length} cotizaciones
          </div>
        )}
      </div>
    </div>
  );
}
