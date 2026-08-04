import { useState, useEffect, useMemo, useCallback } from 'react';
import { getCotizacionesAdmin, saveCotizacion, importCotizacionesFromCsv } from 'zite-endpoints-sdk';
import type { GetCotizacionesAdminOutputType } from 'zite-endpoints-sdk';
import { uploadFile } from 'zite-file-upload-sdk';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Link2, RefreshCw, Search, ExternalLink, UploadCloud, FileSpreadsheet, X } from 'lucide-react';

type Cotizacion = GetCotizacionesAdminOutputType['cotizaciones'][0];
type Deal = GetCotizacionesAdminOutputType['dealsList'][0];

const fmt = (v: number | null) =>
  v == null ? '—' : new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(v);

// ── Row ───────────────────────────────────────────────────────────────────────

function CotizRow({ cotiz, deals, onLinked, onToggleIncluded }: {
  cotiz: Cotizacion;
  deals: Deal[];
  onLinked: (cotizId: string, dealId: string) => void;
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
      toast.success('Cotización vinculada');
      onLinked(cotiz.id, selectedDealId);
    } catch {
      toast.error('Error al vincular');
    } finally {
      setLinking(false);
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
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="secondary" className="text-xs shrink-0">Sin deal</Badge>
            <Select value={selectedDealId} onValueChange={setSelectedDealId}>
              <SelectTrigger className="h-7 text-xs w-44">
                <SelectValue placeholder="Elegir deal..." />
              </SelectTrigger>
              <SelectContent>
                {deals.map(d => (
                  <SelectItem key={d.id} value={d.id}>{d.dealName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm" variant="outline"
              className="h-7 text-xs gap-1 shrink-0"
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
          onCheckedChange={async (val) => {
            setToggling(true);
            try { await onToggleIncluded(cotiz.id, val); }
            finally { setToggling(false); }
          }}
        />
      </td>
    </tr>
  );
}

// ── Drag & drop import panel ──────────────────────────────────────────────────

function ImportPanel({ onDone }: { onDone: () => void }) {
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [currency, setCurrency] = useState('MXN');
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{
    totalCotizaciones: number; matchedCount: number;
    unmatchedNames: string[]; totalLineItems: number;
  } | null>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) setFile(dropped);
  }, []);

  const handleImport = async () => {
    if (!file) { toast.error('Selecciona un archivo primero'); return; }
    setUploading(true);
    setResult(null);
    try {
      const { fileUrl } = await uploadFile({ data: file, filename: file.name });
      const res = await importCotizacionesFromCsv({ csvUrl: fileUrl, currency });
      setResult(res);
      toast.success(`Importadas ${res.totalCotizaciones} cotizaciones (${res.matchedCount} con deal)`);
      onDone();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error al importar');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-foreground">Importar cotizaciones</p>
        <Select value={currency} onValueChange={setCurrency}>
          <SelectTrigger className="w-24 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="MXN">MXN</SelectItem>
            <SelectItem value="USD">USD</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Drop zone */}
      <label
        htmlFor="cotiz-file-input"
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all select-none ${
          isDragging
            ? 'border-primary bg-primary/5 scale-[1.01]'
            : file
            ? 'border-green-500/60 bg-green-500/5'
            : 'border-border hover:border-primary/50 hover:bg-muted/30'
        }`}
      >
        <input
          id="cotiz-file-input"
          type="file"
          accept=".csv,.xlsx"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile(f); }}
        />
        {file ? (
          <div className="flex items-center gap-3">
            <FileSpreadsheet className="w-8 h-8 text-green-600 shrink-0" />
            <div className="text-left">
              <p className="text-sm font-medium text-foreground">{file.name}</p>
              <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</p>
            </div>
            <button
              type="button"
              className="ml-2 p-1 rounded hover:bg-muted text-muted-foreground hover:text-destructive transition-colors"
              onClick={(e) => { e.preventDefault(); setFile(null); setResult(null); }}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <>
            <UploadCloud className={`w-10 h-10 transition-colors ${isDragging ? 'text-primary' : 'text-muted-foreground/40'}`} />
            <div>
              <p className="text-sm font-medium text-foreground">
                {isDragging ? 'Suelta el archivo aquí' : 'Arrastra un archivo o haz clic para seleccionar'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">.csv · .xlsx · máx. 25 MB</p>
            </div>
          </>
        )}
      </label>

      <div className="flex items-center gap-3 flex-wrap">
        <Button size="sm" disabled={!file || uploading} onClick={handleImport} className="gap-2">
          {uploading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
          {uploading ? 'Importando...' : 'Importar'}
        </Button>
        {result && (
          <p className="text-xs text-muted-foreground">
            ✅ {result.totalCotizaciones} cotizaciones · {result.totalLineItems} items · {result.matchedCount} con deal
            {result.unmatchedNames.length > 0 && (
              <span className="text-amber-600 ml-1">· ⚠️ {result.unmatchedNames.length} sin deal</span>
            )}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Main tab ──────────────────────────────────────────────────────────────────

export default function CotizacionesTab() {
  const [data, setData] = useState<GetCotizacionesAdminOutputType | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'all' | 'sin-deal' | 'con-deal'>('all');
  const [search, setSearch] = useState('');
  const [showImport, setShowImport] = useState(false);

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

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <p className="text-sm text-muted-foreground">
          Gestión y vinculación de cotizaciones a deals
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowImport(v => !v)} className="gap-2">
            <UploadCloud className="w-4 h-4" />
            {showImport ? 'Ocultar importador' : 'Importar archivo'}
          </Button>
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Actualizar
          </Button>
        </div>
      </div>

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
          <table className="w-full text-sm min-w-[820px]">
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
                  <tr key={i}>
                    <td colSpan={7} className="px-4 py-3"><Skeleton className="h-5 w-full" /></td>
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-16 text-center text-muted-foreground text-sm">
                    <ExternalLink className="w-8 h-8 mx-auto mb-2 opacity-20" />
                    No hay cotizaciones que mostrar
                  </td>
                </tr>
              ) : (
                filtered.map(c => (
                  <CotizRow
                    key={c.id}
                    cotiz={c}
                    deals={data?.dealsList ?? []}
                    onLinked={(cotizId, dealId) => {
                      const deal = data?.dealsList.find(d => d.id === dealId);
                      setData(prev => prev ? {
                        ...prev,
                        cotizaciones: prev.cotizaciones.map(c =>
                          c.id === cotizId ? { ...c, dealId, dealName: deal?.dealName ?? '' } : c
                        ),
                      } : prev);
                    }}
                    onToggleIncluded={handleToggleIncluded}
                  />
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
