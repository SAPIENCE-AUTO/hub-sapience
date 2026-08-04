import { useState, useCallback, useRef } from 'react';
import { useAuth } from 'zite-auth-sdk';
import { importDeals, importSuppliers } from 'zite-endpoints-sdk';
import { Upload, FileText, AlertCircle, CheckCircle2, Loader2, Trash2, Play } from 'lucide-react';
import OdcImportSection from '../components/OdcImportSection';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// ── Types ─────────────────────────────────────────────────────────────────────
interface DealRow {
  dealName?: string;
  statusPropuesta?: string;
  phase?: string;
  client?: string;
  tematica?: string;
  empresaOperadora?: string;
  puntoDeContacto?: string;
  proposalDate?: string;
  hechaPor?: string;
  approvalDate?: string;
  currency?: string;
  clientPrice?: number;
  taxesPct?: number;
  quotedCost?: number;
  fechaDeBrief?: string;
  fechaPerdida?: string;
  projectType?: string;
  gerente?: string;
}

interface SupplierRow {
  supplierName: string;
  taxId?: string;
  email?: string;
  address?: string;
  personType?: string;
  taxRegime?: string;
  country?: string;
  phone?: string;
  categories?: string[];
}

// ── CSV helpers ───────────────────────────────────────────────────────────────
function splitCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function parseNum(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = parseFloat(v.replace(/,/g, '').replace(/\s/g, ''));
  return isNaN(n) ? undefined : n;
}

function parseDate(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const s = v.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const dmyMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (dmyMatch) {
    const [, d, m, y] = dmyMatch;
    const year = y.length === 2 ? (parseInt(y) > 50 ? `19${y}` : `20${y}`) : y;
    return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return undefined;
}

function mapPhase(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const map: Record<string, string> = {
    'GANADA': 'Ganado',
    'PROPUESTA ENVIADA': 'Cotización enviada',
    'PERDIDA': 'Perdido',
    'CANCELADA': 'Perdido',
  };
  return map[v.trim().toUpperCase()] ?? v;
}

function mapCurrency(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const map: Record<string, string> = { 'MXN': 'MXN 🇲🇽', 'USD': 'USD 🇺🇸', 'EUR': 'EUR 🇪🇺' };
  return map[v.trim().toUpperCase()] ?? v;
}

const SKIP_NAMES = new Set(['Name', 'Cliente', 'Status aprobación', '2026', '2025', '2024', '2023', 'FACTURAS', 'Seguimiento comercial']);

function parseDealsCSV(text: string): DealRow[] {
  const lines = text.split(/\r?\n/);
  const rows: DealRow[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = splitCSVLine(line);
    if (cols.length < 4) continue;
    const col0 = cols[0]?.trim() ?? '';
    const col3 = cols[3]?.trim() ?? '';
    const col4 = cols[4]?.trim() ?? '';
    if (!col0) continue;
    if (SKIP_NAMES.has(col0)) continue;
    if (col3 === 'Status aprobación' || col4 === 'Cliente') continue;
    const nonEmpty = cols.filter(c => c.trim() !== '').length;
    if (nonEmpty <= 3) continue;
    rows.push({
      dealName: col0 || undefined,
      statusPropuesta: cols[1]?.trim() || undefined,
      phase: mapPhase(cols[3]?.trim()),
      client: col4 || undefined,
      tematica: cols[5]?.trim() || undefined,
      empresaOperadora: cols[6]?.trim() || undefined,
      puntoDeContacto: cols[7]?.trim() || undefined,
      proposalDate: parseDate(cols[10]?.trim()),
      hechaPor: cols[11]?.trim() || undefined,
      approvalDate: parseDate(cols[12]?.trim()),
      currency: mapCurrency(cols[16]?.trim()),
      clientPrice: parseNum(cols[17]?.trim()),
      taxesPct: parseNum(cols[20]?.trim()),
      quotedCost: parseNum(cols[26]?.trim()),
      fechaDeBrief: parseDate(cols[29]?.trim()),
      fechaPerdida: parseDate(cols[30]?.trim()),
      projectType: cols[33]?.trim() || undefined,
      gerente: cols[37]?.trim() || undefined,
    });
  }
  return rows;
}

// ── Suppliers parser ──────────────────────────────────────────────────────────
const SUPPLIER_GROUP_NAMES = new Set(['RECLUTAMIENTO', 'MODERACIÓN', 'LOGÍSTICA', 'MODERADORES', 'PROVEEDORES']);
const SUPPLIER_HEADER_KEYWORDS = ['name', 'rfc', 'correo'];

const TAX_REGIME_MAP: Record<string, string> = {
  'personas físicas con actividades empresariales y profesionales': 'Actividades Empresariales y Profesionales',
  'actividades empresariales y profesionales': 'Actividades Empresariales y Profesionales',
  'régimen simplificado de confianza': 'RESICO',
  'resico': 'RESICO',
  'general de ley personas morales': 'General de Ley Personas Morales',
  'régimen de incorporación fiscal': 'Régimen de Incorporación Fiscal',
  'sueldos y salarios': 'Sueldos y Salarios',
  'arrendamiento': 'Arrendamiento',
  'sin obligaciones fiscales': 'Sin obligaciones fiscales',
};

function mapTaxRegime(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const key = v.trim().toLowerCase();
  return TAX_REGIME_MAP[key] ?? v;
}

function parseSuppliersCSV(text: string): SupplierRow[] {
  const lines = text.split(/\r?\n/);
  const rows: SupplierRow[] = [];
  let currentGroup: string | null = null;
  let headerRowIndex = -1;
  let nameIdx = 0, rfcIdx = 1, emailIdx = 2, addressIdx = 3,
      personTypeIdx = 4, regimeIdx = 5, countryIdx = 6, phoneIdx = 7;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cols = splitCSVLine(line).map(c => c.trim());
    const nonEmpty = cols.filter(c => c !== '').length;

    // Detect group separator (1–2 non-empty cells)
    if (nonEmpty <= 2 && cols[0] && !SUPPLIER_HEADER_KEYWORDS.some(k => cols[0].toLowerCase().includes(k))) {
      const groupCandidate = cols[0].toUpperCase();
      if (SUPPLIER_GROUP_NAMES.has(groupCandidate) || nonEmpty === 1) {
        currentGroup = cols[0];
        continue;
      }
    }

    // Detect header row
    if (headerRowIndex === -1 && cols[0] && SUPPLIER_HEADER_KEYWORDS.some(k => cols.some(c => c.toLowerCase().includes(k)))) {
      headerRowIndex = i;
      const lower = cols.map(c => c.toLowerCase());
      nameIdx       = lower.findIndex(c => c === 'name' || c === 'nombre');
      rfcIdx        = lower.findIndex(c => c === 'rfc');
      emailIdx      = lower.findIndex(c => c.includes('correo') || c === 'email');
      addressIdx    = lower.findIndex(c => c.includes('direcci'));
      personTypeIdx = lower.findIndex(c => c.includes('tipo de persona') || c.includes('persona'));
      regimeIdx     = lower.findIndex(c => c.includes('régimen') || c.includes('regimen'));
      countryIdx    = lower.findIndex(c => c.includes('país') || c.includes('pais') || c === 'country');
      phoneIdx      = lower.findIndex(c => c.includes('teléfono') || c.includes('telefono') || c === 'phone');
      if (nameIdx === -1) nameIdx = 0;
      continue;
    }

    // Skip if we haven't found headers yet or this is the title row
    if (headerRowIndex === -1) continue;

    const name = cols[nameIdx] ?? '';
    if (!name || name.toLowerCase() === 'name') continue;
    // Skip rows that are group separators or have too few fields
    if (nonEmpty <= 2) { currentGroup = name; continue; }

    // Normalize phone (scientific notation → string)
    const rawPhone = cols[phoneIdx] ?? '';
    let phone: string | undefined;
    if (rawPhone) {
      const n = parseFloat(rawPhone);
      phone = isNaN(n) ? rawPhone : n.toFixed(0);
    }

    rows.push({
      supplierName: name,
      taxId: cols[rfcIdx] || undefined,
      email: cols[emailIdx] || undefined,
      address: cols[addressIdx] || undefined,
      personType: cols[personTypeIdx] || undefined,
      taxRegime: mapTaxRegime(cols[regimeIdx]),
      country: cols[countryIdx] || undefined,
      phone,
      categories: currentGroup ? [currentGroup] : undefined,
    });
  }
  return rows;
}

// ── Rubro config ──────────────────────────────────────────────────────────────
const RUBROS = [
  { id: 'deals',     label: 'Deals — Comercial', icon: '💼', description: 'Importar deals del CRM desde Monday.com' },
  { id: 'suppliers', label: 'Proveedores',        icon: '🏢', description: 'Importar proveedores desde Monday.com' },
  { id: 'odcs',      label: 'Órdenes de Compra',  icon: '📋', description: 'Importar ODCs masivas desde Monday.com (RI-001, MD-001, etc.)' },
] as const;

type RubroId = typeof RUBROS[number]['id'];

// ── Page ─────────────────────────────────────────────────────────────────────
export default function DataImportPage() {
  const { user } = useAuth();
  const [selectedRubro, setSelectedRubro] = useState<RubroId>('deals');
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [dealRows, setDealRows] = useState<DealRow[]>([]);
  const [supplierRows, setSupplierRows] = useState<SupplierRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ created: number; total: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (user?.role !== 'Owner' && user?.role !== 'Socio') {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <p className="text-4xl mb-3">🔒</p>
          <p className="font-semibold text-foreground">Acceso restringido</p>
          <p className="text-sm text-muted-foreground mt-1">Solo los administradores pueden acceder a esta página.</p>
        </div>
      </div>
    );
  }

  const reset = () => {
    setDealRows([]);
    setSupplierRows([]);
    setFileName(null);
    setError(null);
    setImportResult(null);
  };

  const handleFile = (file: File) => {
    setError(null);
    setDealRows([]);
    setSupplierRows([]);
    setImportResult(null);
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target?.result as string;
      try {
        if (selectedRubro === 'deals') {
          const parsed = parseDealsCSV(text);
          if (parsed.length === 0) setError('No se encontraron filas válidas. Verifica que sea el CSV correcto de Monday.');
          else setDealRows(parsed);
        } else {
          const parsed = parseSuppliersCSV(text);
          if (parsed.length === 0) setError('No se encontraron proveedores válidos. Verifica que sea el CSV correcto de Monday.');
          else setSupplierRows(parsed);
        }
      } catch {
        setError('Error al parsear el archivo. Asegúrate de que sea un CSV válido.');
      }
    };
    reader.readAsText(file, 'utf-8');
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [selectedRubro]);

  const hasRows = selectedRubro === 'deals' ? dealRows.length > 0 : supplierRows.length > 0;
  const rowCount = selectedRubro === 'deals' ? dealRows.length : supplierRows.length;

  const handleImport = async () => {
    setImporting(true);
    try {
      if (selectedRubro === 'deals') {
        const result = await importDeals({ deals: dealRows });
        setImportResult(result);
        toast.success(`✅ ${result.created} deals importados correctamente`);
        setDealRows([]);
      } else {
        const result = await importSuppliers({ suppliers: supplierRows });
        setImportResult(result);
        toast.success(`✅ ${result.created} proveedores importados correctamente`);
        setSupplierRows([]);
      }
      setFileName(null);
    } catch (err: any) {
      toast.error(err?.message ?? 'Error al importar');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Importar datos</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Sube archivos CSV exportados de Monday.com para poblar las distintas áreas de la app.
        </p>
      </div>

      {/* Rubro selector */}
      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">Área a importar</p>
        <div className="flex flex-wrap gap-3">
          {RUBROS.map(r => (
            <button
              key={r.id}
              onClick={() => { setSelectedRubro(r.id); reset(); }}
              className={cn(
                'flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all',
                selectedRubro === r.id
                  ? 'border-primary bg-primary/5 text-primary'
                  : 'border-border bg-card text-foreground hover:border-primary/40 hover:bg-muted/50'
              )}
            >
              <span className="text-2xl">{r.icon}</span>
              <div>
                <p className="font-semibold text-sm">{r.label}</p>
                <p className="text-xs text-muted-foreground">{r.description}</p>
              </div>
              {selectedRubro === r.id && <div className="ml-2 w-2 h-2 rounded-full bg-primary shrink-0" />}
            </button>
          ))}
        </div>
      </div>

      <Separator />

      {/* ODC import — handled by its own component */}
      {selectedRubro === 'odcs' && <OdcImportSection />}

      {/* Import result banner */}
      {selectedRubro !== 'odcs' && importResult && (
        <Alert className="border-primary/30 bg-primary/5">
          <CheckCircle2 className="h-4 w-4 text-primary" />
          <AlertDescription className="text-primary font-medium">
            Importación completada: <strong>{importResult.created}</strong> de {importResult.total} registros procesados.
          </AlertDescription>
        </Alert>
      )}

      {/* Drop zone */}
      {selectedRubro !== 'odcs' && !hasRows && !importResult && (
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => fileRef.current?.click()}
          className={cn(
            'border-2 border-dashed rounded-2xl p-12 flex flex-col items-center justify-center gap-4 cursor-pointer transition-all',
            dragging
              ? 'border-primary bg-primary/5 scale-[1.01]'
              : 'border-border bg-muted/20 hover:border-primary/50 hover:bg-muted/40'
          )}
        >
          <div className={cn('w-14 h-14 rounded-full flex items-center justify-center transition-colors', dragging ? 'bg-primary/20' : 'bg-muted')}>
            <Upload className={cn('w-6 h-6', dragging ? 'text-primary' : 'text-muted-foreground')} />
          </div>
          <div className="text-center">
            <p className="font-semibold text-foreground">{dragging ? 'Suelta el archivo aquí' : 'Arrastra el CSV aquí'}</p>
            <p className="text-sm text-muted-foreground mt-1">o haz clic para seleccionar un archivo</p>
            <p className="text-xs text-muted-foreground/60 mt-2">Archivos .csv exportados de Monday.com</p>
          </div>
          <input ref={fileRef} type="file" accept=".csv" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />
        </div>
      )}

      {/* Error */}
      {selectedRubro !== 'odcs' && error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Preview */}
      {selectedRubro !== 'odcs' && hasRows && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileText className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">{fileName}</span>
              <Badge variant="secondary">{rowCount} filas válidas</Badge>
            </div>
            <Button variant="ghost" size="sm" onClick={reset} className="gap-1.5 text-muted-foreground">
              <Trash2 className="w-3.5 h-3.5" />
              Limpiar
            </Button>
          </div>

          {selectedRubro === 'deals' ? (
            <DealsPreviewTable rows={dealRows} />
          ) : (
            <SuppliersPreviewTable rows={supplierRows} />
          )}

          <div className="flex items-center justify-between pt-2">
            <p className="text-sm text-muted-foreground">
              Se importarán <strong className="text-foreground">{rowCount} {selectedRubro === 'deals' ? 'deals' : 'proveedores'}</strong> a la base de datos.
              {selectedRubro === 'suppliers' && <span className="ml-1 text-muted-foreground/70">(upsert por nombre)</span>}
            </p>
            <Button onClick={handleImport} disabled={importing} className="gap-2 min-w-[160px]">
              {importing ? (
                <><Loader2 className="w-4 h-4 animate-spin" />Importando...</>
              ) : (
                <><Play className="w-4 h-4" />Confirmar importación</>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Deals preview table ───────────────────────────────────────────────────────
function DealsPreviewTable({ rows }: { rows: DealRow[] }) {
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs whitespace-nowrap">#</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs whitespace-nowrap">Deal Name</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs whitespace-nowrap">Phase</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs whitespace-nowrap">Cliente</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs whitespace-nowrap">Moneda</th>
              <th className="text-right px-4 py-2.5 font-medium text-muted-foreground text-xs whitespace-nowrap">Precio</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs whitespace-nowrap">Tipo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.slice(0, 50).map((row, i) => (
              <tr key={i} className="hover:bg-muted/30 transition-colors">
                <td className="px-4 py-2.5 text-xs text-muted-foreground font-mono">{i + 1}</td>
                <td className="px-4 py-2.5 font-medium text-foreground max-w-[200px] truncate">{row.dealName ?? '—'}</td>
                <td className="px-4 py-2.5">{row.phase ? <PhaseBadge phase={row.phase} /> : <span className="text-muted-foreground">—</span>}</td>
                <td className="px-4 py-2.5 text-foreground max-w-[150px] truncate">{row.client ?? '—'}</td>
                <td className="px-4 py-2.5 text-muted-foreground text-xs">{row.currency ?? '—'}</td>
                <td className="px-4 py-2.5 text-right font-mono text-xs">
                  {row.clientPrice != null ? row.clientPrice.toLocaleString('es-MX', { minimumFractionDigits: 0 }) : '—'}
                </td>
                <td className="px-4 py-2.5 text-muted-foreground text-xs max-w-[150px] truncate">{row.projectType ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 50 && (
        <div className="px-4 py-2.5 bg-muted/30 border-t border-border text-xs text-muted-foreground text-center">
          Mostrando 50 de {rows.length} filas.
        </div>
      )}
    </div>
  );
}

// ── Suppliers preview table ───────────────────────────────────────────────────
function SuppliersPreviewTable({ rows }: { rows: SupplierRow[] }) {
  const categoryColors: Record<string, string> = {
    'RECLUTAMIENTO': 'bg-primary/10 text-primary border-primary/20',
    'MODERACIÓN':    'bg-chart-2/10 text-chart-2 border-chart-2/20',
    'LOGÍSTICA':     'bg-chart-4/10 text-chart-4 border-chart-4/20',
    'MODERADORES':   'bg-chart-3/10 text-chart-3 border-chart-3/20',
  };

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs whitespace-nowrap">#</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs whitespace-nowrap">Nombre</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs whitespace-nowrap">RFC</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs whitespace-nowrap">Email</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs whitespace-nowrap">Categoría</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs whitespace-nowrap">Tipo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.slice(0, 50).map((row, i) => {
              const cat = row.categories?.[0] ?? '';
              const catStyle = categoryColors[cat] ?? 'bg-muted text-muted-foreground border-border';
              return (
                <tr key={i} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-2.5 text-xs text-muted-foreground font-mono">{i + 1}</td>
                  <td className="px-4 py-2.5 font-medium text-foreground max-w-[200px] truncate">{row.supplierName}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{row.taxId ?? '—'}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-[180px] truncate">{row.email ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    {cat ? (
                      <span className={cn('text-xs px-2 py-0.5 rounded-full border font-medium', catStyle)}>{cat}</span>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{row.personType ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > 50 && (
        <div className="px-4 py-2.5 bg-muted/30 border-t border-border text-xs text-muted-foreground text-center">
          Mostrando 50 de {rows.length} filas.
        </div>
      )}
    </div>
  );
}

function PhaseBadge({ phase }: { phase: string }) {
  const styles: Record<string, string> = {
    'Ganado':              'bg-primary/10 text-primary border-primary/20',
    'Perdido':             'bg-destructive/10 text-destructive border-destructive/20',
    'Cotización enviada':  'bg-chart-2/10 text-chart-2 border-chart-2/20',
    'Negociación':         'bg-chart-4/10 text-chart-4 border-chart-4/20',
    'Prospecto':           'bg-muted text-muted-foreground border-border',
    'Brief recibido':      'bg-muted text-muted-foreground border-border',
  };
  return (
    <span className={cn('text-xs px-2 py-0.5 rounded-full border font-medium', styles[phase] ?? 'bg-muted text-muted-foreground border-border')}>
      {phase}
    </span>
  );
}
