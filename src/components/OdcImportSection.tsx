import { useState, useCallback, useRef } from 'react';
import { uploadFile } from 'zite-file-upload-sdk';
import { parseOdcCsv, importOdcFromCsv, ParseOdcCsvOutputType } from 'zite-endpoints-sdk';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Upload, Loader2, Play, CheckCircle2, AlertTriangle, FileText, Trash2, Plus, RefreshCw, DollarSign } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import OdcMappingPanel from './OdcMappingPanel';

type Preview = ParseOdcCsvOutputType;
type ImportMode = 'new_only' | 'all' | 'amounts_only';

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4 space-y-1">
      <p className="text-xs text-muted-foreground font-medium">{label}</p>
      <p className="text-2xl font-bold text-foreground">{typeof value === 'number' ? value.toLocaleString('es-MX') : value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function SampleTable({ odcs, existingPoNumbers }: { odcs: Preview['sampleOdcs']; existingPoNumbers?: string[] }) {
  const existingSet = new Set(existingPoNumbers ?? []);
  return (
    <div className="rounded-xl border overflow-hidden text-sm">
      <div className="bg-muted/50 px-4 py-2 border-b">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Muestra de ODCs (primeras 25)</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th className="text-left px-4 py-2 font-medium">ODC</th>
              <th className="text-left px-4 py-2 font-medium">Proyecto</th>
              <th className="text-left px-4 py-2 font-medium">Descripción</th>
              <th className="text-left px-4 py-2 font-medium">Proveedor</th>
              <th className="text-left px-4 py-2 font-medium">Rubro</th>
              <th className="text-right px-4 py-2 font-medium">Total MXN</th>
              <th className="text-center px-4 py-2 font-medium">Items</th>
              <th className="text-center px-4 py-2 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {odcs.map((odc, i) => (
              <tr key={i} className={cn('hover:bg-muted/30 text-xs', existingSet.has(odc.poNumber) && 'opacity-40')}>
                <td className="px-4 py-2 font-mono font-bold text-primary">
                  {odc.poNumber}
                  {existingSet.has(odc.poNumber) && (
                    <span className="ml-1.5 text-[9px] px-1 py-0.5 rounded bg-muted text-muted-foreground border border-border font-sans">existente</span>
                  )}
                </td>
                <td className="px-4 py-2 font-medium max-w-[100px] truncate">{odc.projectCode || '—'}</td>
                <td className="px-4 py-2 text-muted-foreground max-w-[160px] truncate">{odc.description || <em className="opacity-50">sin nombre</em>}</td>
                <td className="px-4 py-2 max-w-[140px] truncate">
                  <span className={odc.supplierFound ? 'text-foreground' : 'text-muted-foreground'}>{odc.supplierName}</span>
                  {odc.supplierFound && odc.matchedBy === 'email' && <span className="ml-1 text-[10px] text-sky-600 bg-sky-50 px-1 rounded">email</span>}
                  {odc.supplierFound && odc.matchedBy === 'name' && <span className="ml-1 text-[10px] text-violet-600 bg-violet-50 px-1 rounded">nombre</span>}
                  {!odc.supplierFound && odc.supplierName !== '—' && <span className="ml-1 text-[10px] text-amber-600 bg-amber-50 px-1 rounded">no match</span>}
                </td>
                <td className="px-4 py-2 text-muted-foreground max-w-[120px] truncate">{odc.rubro}</td>
                <td className="px-4 py-2 text-right font-mono">{odc.totalAmount > 0 ? `$${odc.totalAmount.toLocaleString('es-MX', { maximumFractionDigits: 0 })}` : '—'}</td>
                <td className="px-4 py-2 text-center">{odc.lineItemCount > 0 ? odc.lineItemCount : <span className="text-muted-foreground">—</span>}</td>
                <td className="px-4 py-2 text-center">
                  <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium border',
                    odc.status === 'Pagada' ? 'bg-primary/10 text-primary border-primary/20' : 'bg-muted text-muted-foreground border-border'
                  )}>{odc.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ImportModeSelector({
  mode,
  onChange,
  preview,
}: {
  mode: ImportMode;
  onChange: (m: ImportMode) => void;
  preview: Preview;
}) {
  const { newOdcCount, existingOdcCount, totalOdcs } = preview;

  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-foreground">¿Qué ODCs importar?</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Solo nuevas */}
        <button
          type="button"
          onClick={() => onChange('new_only')}
          className={cn(
            'relative text-left rounded-xl border-2 p-4 transition-all focus:outline-none',
            mode === 'new_only'
              ? 'border-primary bg-primary/5 shadow-sm'
              : 'border-border bg-card hover:border-primary/40 hover:bg-muted/30'
          )}
        >
          <div className="flex items-start gap-3">
            <div className={cn('mt-0.5 flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center',
              mode === 'new_only' ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
            )}>
              <Plus className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm text-foreground">Solo importar nuevas</span>
                <Badge className="bg-primary/15 text-primary border-primary/20 hover:bg-primary/15 text-xs">
                  {newOdcCount.toLocaleString('es-MX')} nuevas
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {existingOdcCount > 0
                  ? `Las ${existingOdcCount.toLocaleString('es-MX')} ODCs existentes se ignorarán`
                  : 'No hay ODCs existentes que ignorar'}
              </p>
            </div>
          </div>
          {/* Radio indicator */}
          <div className={cn(
            'absolute top-3.5 right-3.5 w-4 h-4 rounded-full border-2 flex items-center justify-center',
            mode === 'new_only' ? 'border-primary' : 'border-muted-foreground/30'
          )}>
            {mode === 'new_only' && <div className="w-2 h-2 rounded-full bg-primary" />}
          </div>
        </button>

        {/* Importar todas */}
        <button
          type="button"
          onClick={() => onChange('all')}
          className={cn(
            'relative text-left rounded-xl border-2 p-4 transition-all focus:outline-none',
            mode === 'all'
              ? 'border-primary bg-primary/5 shadow-sm'
              : 'border-border bg-card hover:border-primary/40 hover:bg-muted/30'
          )}
        >
          <div className="flex items-start gap-3">
            <div className={cn('mt-0.5 flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center',
              mode === 'all' ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
            )}>
              <RefreshCw className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm text-foreground">Importar todas</span>
                <Badge variant="secondary" className="text-xs">
                  {totalOdcs.toLocaleString('es-MX')} totales
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {existingOdcCount > 0
                  ? `${existingOdcCount.toLocaleString('es-MX')} existentes se actualizarán`
                  : 'No hay ODCs existentes para actualizar'}
              </p>
            </div>
          </div>
          <div className={cn(
            'absolute top-3.5 right-3.5 w-4 h-4 rounded-full border-2 flex items-center justify-center',
            mode === 'all' ? 'border-primary' : 'border-muted-foreground/30'
          )}>
            {mode === 'all' && <div className="w-2 h-2 rounded-full bg-primary" />}
          </div>
        </button>
      </div>

      {/* Solo actualizar montos — full width */}
      <button
        type="button"
        onClick={() => onChange('amounts_only')}
        className={cn(
          'relative w-full text-left rounded-xl border-2 p-4 transition-all focus:outline-none',
          mode === 'amounts_only'
            ? 'border-primary bg-primary/5 shadow-sm'
            : 'border-border bg-card hover:border-primary/40 hover:bg-muted/30'
        )}
      >
        <div className="flex items-start gap-3">
          <div className={cn('mt-0.5 flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center',
            mode === 'amounts_only' ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
          )}>
            <DollarSign className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm text-foreground">Solo actualizar montos</span>
              <Badge variant="outline" className="text-xs text-muted-foreground">
                {existingOdcCount.toLocaleString('es-MX')} ODCs existentes
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Solo actualiza <strong className="text-foreground">totalAmount</strong>, <strong className="text-foreground">tipoDeOc</strong> y <strong className="text-foreground">subitems</strong> en ODCs ya existentes.
              No toca proveedores ni proyectos. Las ODCs sin número de match se ignoran.
            </p>
          </div>
        </div>
        <div className={cn(
          'absolute top-3.5 right-3.5 w-4 h-4 rounded-full border-2 flex items-center justify-center',
          mode === 'amounts_only' ? 'border-primary' : 'border-muted-foreground/30'
        )}>
          {mode === 'amounts_only' && <div className="w-2 h-2 rounded-full bg-primary" />}
        </div>
      </button>
    </div>
  );
}

export default function OdcImportSection() {
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [csvUrl, setCsvUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [importMode, setImportMode] = useState<ImportMode>('new_only');
  const [projectMappings, setProjectMappings] = useState<Record<string, string>>({});
  const [supplierMappings, setSupplierMappings] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [importDone, setImportDone] = useState(false);
  const [importSummary, setImportSummary] = useState({ newCount: 0, updatedCount: 0 });
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setFileName(null); setCsvUrl(null); setPreview(null);
    setImportDone(false); setError(null); setProgress({ done: 0, total: 0 });
    setImportSummary({ newCount: 0, updatedCount: 0 });
    setProjectMappings({}); setSupplierMappings({});
    setImportMode('new_only');
  };

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.endsWith('.csv')) { setError('Solo se aceptan archivos .csv'); return; }
    setError(null); setPreview(null); setImportDone(false);
    setFileName(file.name); setUploading(true);
    try {
      const { fileUrl } = await uploadFile({ data: file, filename: file.name });
      setCsvUrl(fileUrl);
      const result = await parseOdcCsv({ csvUrl: fileUrl });
      if (result.totalOdcs === 0) {
        setError('No se encontraron ODCs (códigos como RI-001, MD-001, etc.) en el archivo.');
        setFileName(null);
      } else {
        setPreview(result);
        setImportMode(result.newOdcCount > 0 ? 'new_only' : 'all');
        const pm: Record<string, string> = {};
        result.projectsToCreate.forEach(code => { pm[code] = 'create'; });
        setProjectMappings(pm);
        const sm: Record<string, string> = {};
        result.suppliersNotFound.forEach((s, i) => {
          const key = s.rfc || s.name || `row-${i}`;
          sm[key] = s.suggestedMatch ?? 'raw';
        });
        setSupplierMappings(sm);
      }
    } catch (e: any) {
      setError(e?.message ?? 'Error al procesar el archivo');
      setFileName(null);
    } finally {
      setUploading(false);
    }
  }, []);

  const handleImport = async () => {
    if (!csvUrl || !preview) return;
    const skipExisting = importMode === 'new_only';
    const amountsOnly = importMode === 'amounts_only';
    const odcCountForImport = amountsOnly
      ? preview.existingOdcCount
      : skipExisting ? preview.newOdcCount : preview.totalOdcs;
    setImporting(true);
    setProgress({ done: 0, total: odcCountForImport });
    let totalNew = 0;
    let totalUpdated = 0;
    let offset = 0;
    const batchSize = 50;
    try {
      while (true) {
        const result = await importOdcFromCsv({
          csvUrl,
          batchOffset: offset,
          batchSize,
          projectMappings,
          supplierMappings,
          skipExisting,
          amountsOnly,
        });
        totalNew += result.newCount;
        totalUpdated += result.updatedCount;
        setProgress({ done: totalNew + totalUpdated, total: odcCountForImport });
        if (result.done) break;
        offset += batchSize;
      }
      setImportSummary({ newCount: totalNew, updatedCount: totalUpdated });
      setImportDone(true);
      const msg = totalUpdated > 0
        ? `✅ ${totalNew} ODCs nuevas, ${totalUpdated} actualizadas`
        : `✅ ${totalNew} ODCs importadas correctamente`;
      toast.success(msg);
      setPreview(null); setFileName(null); setCsvUrl(null);
    } catch (e: any) {
      toast.error(e?.message ?? 'Error durante la importación');
    } finally {
      setImporting(false);
    }
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  if (importDone) {
    return (
      <div className="flex flex-col items-center justify-center py-16 space-y-4">
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center"><CheckCircle2 className="w-8 h-8 text-primary" /></div>
        <p className="text-lg font-bold">¡Importación completada!</p>
        <div className="flex flex-col items-center gap-1.5">
          <div className="flex items-center gap-2 text-sm">
            <span className="w-2.5 h-2.5 rounded-full bg-primary inline-block" />
            <span className="font-semibold text-foreground">{importSummary.newCount.toLocaleString('es-MX')}</span>
            <span className="text-muted-foreground">ODCs nuevas creadas</span>
          </div>
          {importSummary.updatedCount > 0 && (
            <div className="flex items-center gap-2 text-sm">
              <span className="w-2.5 h-2.5 rounded-full bg-muted-foreground inline-block" />
              <span className="font-semibold text-foreground">{importSummary.updatedCount.toLocaleString('es-MX')}</span>
              <span className="text-muted-foreground">ODCs existentes actualizadas</span>
            </div>
          )}
        </div>
        <Button variant="outline" onClick={reset}>Importar otro archivo</Button>
      </div>
    );
  }

  // Derived values based on mode
  const displayOdcCount = preview
    ? (importMode === 'new_only' ? preview.newOdcCount : preview.totalOdcs)
    : 0;
  const displayLineItems = preview
    ? (importMode === 'new_only'
        ? Math.round(preview.totalLineItems * (preview.newOdcCount / Math.max(preview.totalOdcs, 1)))
        : preview.totalLineItems)
    : 0;
  const filteredSampleOdcs = preview
    ? (importMode === 'new_only'
        ? preview.sampleOdcs.filter(o => !preview.existingPoNumbers.includes(o.poNumber))
        : preview.sampleOdcs)
    : [];

  return (
    <div className="space-y-6">
      {/* Drop zone */}
      {!preview && (
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => !uploading && fileRef.current?.click()}
          className={cn(
            'border-2 border-dashed rounded-2xl p-12 flex flex-col items-center justify-center gap-4 transition-all',
            uploading ? 'cursor-wait opacity-70' : 'cursor-pointer',
            dragging ? 'border-primary bg-primary/5 scale-[1.01]' : 'border-border bg-muted/20 hover:border-primary/50 hover:bg-muted/40'
          )}
        >
          <div className={cn('w-14 h-14 rounded-full flex items-center justify-center', dragging ? 'bg-primary/20' : 'bg-muted')}>
            {uploading ? <Loader2 className="w-6 h-6 animate-spin text-primary" /> : <Upload className={cn('w-6 h-6', dragging ? 'text-primary' : 'text-muted-foreground')} />}
          </div>
          <div className="text-center">
            <p className="font-semibold text-foreground">{uploading ? 'Analizando archivo…' : dragging ? 'Suelta el archivo aquí' : 'Arrastra el CSV aquí'}</p>
            <p className="text-sm text-muted-foreground mt-1">{uploading ? 'Subiendo y parseando, un momento…' : 'CSV exportado de Monday.com — ODC Reclutamiento'}</p>
          </div>
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />
        </div>
      )}

      {error && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertDescription>{error}</AlertDescription></Alert>}

      {preview && (
        <div className="space-y-5">
          {/* File info */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileText className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium">{fileName}</span>
              <Badge variant="secondary">{preview.totalOdcs.toLocaleString('es-MX')} ODCs encontradas</Badge>
              {preview.existingOdcCount > 0 && (
                <Badge variant="outline" className="text-muted-foreground">
                  {preview.existingOdcCount.toLocaleString('es-MX')} ya existen
                </Badge>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={reset} className="gap-1.5 text-muted-foreground"><Trash2 className="w-3.5 h-3.5" />Limpiar</Button>
          </div>

          {/* Import mode selector */}
          <ImportModeSelector mode={importMode} onChange={setImportMode} preview={preview} />

          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="ODCs a importar" value={displayOdcCount} />
            <StatCard label="Line items aprox." value={displayLineItems} />
            {importMode !== 'amounts_only' && (
              <StatCard
                label="Proyectos"
                value={preview.totalProjects}
                sub={preview.projectsToCreate.length > 0 ? `${preview.projectsToCreate.length} a resolver` : 'todos existentes'}
              />
            )}
            <StatCard label="Total (MXN$)" value={`${Math.round(preview.totalAmount).toLocaleString('es-MX')}`} />
          </div>

          {/* Mapping panel — hidden in amounts_only mode */}
          {importMode !== 'amounts_only' && (
            <OdcMappingPanel
              preview={preview}
              projectMappings={projectMappings}
              supplierMappings={supplierMappings}
              onProjectMap={(code, decision) => setProjectMappings(prev => ({ ...prev, [code]: decision }))}
              onSupplierMap={(key, decision) => setSupplierMappings(prev => ({ ...prev, [key]: decision }))}
            />
          )}

          {/* Sample */}
          <SampleTable
            odcs={importMode === 'new_only' ? filteredSampleOdcs : preview.sampleOdcs}
            existingPoNumbers={importMode === 'all' ? preview.existingPoNumbers : []}
          />

          {/* Import button / progress */}
          {importing ? (
            <div className="rounded-xl border bg-card p-5 space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin text-primary" />Importando ODCs…</span>
                <span className="text-muted-foreground font-mono">{progress.done.toLocaleString('es-MX')} / {progress.total.toLocaleString('es-MX')}</span>
              </div>
              <Progress value={progress.total > 0 ? (progress.done / progress.total) * 100 : 0} className="h-2" />
              <p className="text-xs text-muted-foreground">No cierres esta página. El proceso puede tardar varios minutos.</p>
            </div>
          ) : (
            <div className="flex items-center justify-between pt-2">
              <p className="text-sm text-muted-foreground">
                {importMode === 'new_only' ? (
                  <>Se importarán <strong className="text-foreground">{preview.newOdcCount.toLocaleString('es-MX')} ODCs nuevas</strong>.
                  {preview.existingOdcCount > 0 && <span className="ml-1">Las {preview.existingOdcCount.toLocaleString('es-MX')} existentes se ignorarán.</span>}</>
                ) : importMode === 'amounts_only' ? (
                  <>Se actualizarán montos y subitems de <strong className="text-foreground">{preview.existingOdcCount.toLocaleString('es-MX')} ODCs existentes</strong>. No se crean registros nuevos.</>
                ) : (
                  <>Se importarán <strong className="text-foreground">{preview.totalOdcs.toLocaleString('es-MX')} ODCs</strong> con{' '}
                  <strong className="text-foreground">{preview.totalLineItems.toLocaleString('es-MX')} líneas de detalle</strong>.
                  {preview.existingOdcCount > 0 && <span className="ml-1">{preview.existingOdcCount.toLocaleString('es-MX')} se actualizarán.</span>}</>
                )}
              </p>
              <Button onClick={handleImport} className="gap-2 min-w-[200px]">
                {importMode === 'new_only' ? (
                  <><Plus className="w-4 h-4" />Importar {preview.newOdcCount.toLocaleString('es-MX')} ODCs nuevas</>
                ) : importMode === 'amounts_only' ? (
                  <><DollarSign className="w-4 h-4" />Actualizar {preview.existingOdcCount.toLocaleString('es-MX')} montos</>
                ) : (
                  <><Play className="w-4 h-4" />Importar {preview.totalOdcs.toLocaleString('es-MX')} ODCs{preview.existingOdcCount > 0 ? ` (${preview.existingOdcCount} actualizaciones)` : ''}</>
                )}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
