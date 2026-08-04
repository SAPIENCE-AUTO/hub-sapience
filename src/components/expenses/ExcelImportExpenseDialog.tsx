import { useState, useRef, useCallback } from 'react';
import { uploadFile } from 'zite-file-upload-sdk';
import { parseExcelFile } from 'zite-endpoints-sdk';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FileSpreadsheet, Upload, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import type { LineItem } from './ExpenseFormSheet';

// Field targets for mapping
const TARGETS = [
  { value: '__skip__', label: '— Ignorar —' },
  { value: 'description', label: 'Descripción' },
  { value: 'category', label: 'Categoría' },
  { value: 'amount', label: 'Monto' },
  { value: 'date', label: 'Fecha' },
  { value: 'notes', label: 'Notas' },
] as const;

type TargetKey = 'description' | 'category' | 'amount' | 'date' | 'notes' | '__skip__';

const CATEGORIES = ['Viáticos', 'Transporte', 'Alimentación', 'Hospedaje', 'Compras menores', 'Papelería', 'Materiales', 'Otros'];

// Auto-detect column mappings from header names
function autoDetect(headers: string[]): Record<number, TargetKey> {
  const map: Record<number, TargetKey> = {};
  const used = new Set<TargetKey>();

  const rules: { patterns: string[]; target: TargetKey }[] = [
    { patterns: ['descripcion', 'description', 'concepto', 'detalle', 'nombre', 'item'], target: 'description' },
    { patterns: ['monto', 'amount', 'importe', 'total', 'valor', 'precio', 'costo'], target: 'amount' },
    { patterns: ['fecha', 'date', 'dia', 'día', 'cuando'], target: 'date' },
    { patterns: ['categoria', 'category', 'tipo', 'rubro', 'type'], target: 'category' },
    { patterns: ['notas', 'notes', 'nota', 'comentario', 'observacion', 'observación', 'remarks'], target: 'notes' },
  ];

  headers.forEach((h, i) => {
    const norm = h.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    for (const rule of rules) {
      if (!used.has(rule.target) && rule.patterns.some(p => norm.includes(p))) {
        map[i] = rule.target;
        used.add(rule.target);
        return;
      }
    }
    map[i] = '__skip__';
  });

  return map;
}

// Parse a cell value as a date → YYYY-MM-DD
function parseDate(raw: string): string {
  if (!raw) return '';
  // Excel serial date number
  const num = Number(raw);
  if (!isNaN(num) && num > 1000 && num < 100000) {
    const d = new Date((num - 25569) * 86400 * 1000);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  }
  // Try parsing common date strings
  const cleaned = raw.replace(/\//g, '-');
  const d = new Date(cleaned);
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  return '';
}

// Parse a cell value as a number
function parseAmount(raw: string): number {
  const cleaned = raw.replace(/[$,\s]/g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

// Match category by fuzzy comparison
function matchCategory(raw: string): string {
  if (!raw) return '';
  const norm = raw.toLowerCase();
  return CATEGORIES.find(c => c.toLowerCase().includes(norm) || norm.includes(c.toLowerCase())) ?? raw;
}

function rowToLineItem(row: string[], mapping: Record<number, TargetKey>, defaultDate: string): LineItem {
  const line: LineItem = { description: '', category: '', amount: 0, date: defaultDate, receipt: [], notes: '' };
  Object.entries(mapping).forEach(([colStr, target]) => {
    if (target === '__skip__') return;
    const val = row[Number(colStr)] ?? '';
    if (target === 'description') line.description = val;
    else if (target === 'category') line.category = matchCategory(val);
    else if (target === 'amount') line.amount = parseAmount(val);
    else if (target === 'date') line.date = parseDate(val) || defaultDate;
    else if (target === 'notes') line.notes = val;
  });
  return line;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onImport: (lines: LineItem[]) => void;
  defaultDate: string;
}

type Step = 'upload' | 'mapping' | 'preview';

export default function ExcelImportExpenseDialog({ open, onClose, onImport, defaultDate }: Props) {
  const [step, setStep] = useState<Step>('upload');
  const [uploading, setUploading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<number, TargetKey>>({});
  const [fileName, setFileName] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setStep('upload');
    setHeaders([]);
    setRows([]);
    setMapping({});
    setFileName('');
  };

  const handleClose = () => { reset(); onClose(); };

  const processFile = useCallback(async (file: File) => {

    setUploading(true);
    setFileName(file.name);
    try {
      const { fileUrl } = await uploadFile({ data: file, filename: file.name });
      setParsing(true);
      setUploading(false);
      const result = await parseExcelFile({ fileUrl, fileName: file.name });
      const allRows = result.rows;
      if (!result.headers.length && !allRows.length) {
        toast.error('El archivo está vacío o no tiene datos detectables');
        setParsing(false);
        return;
      }
      setHeaders(result.headers);
      setRows(allRows);
      setMapping(autoDetect(result.headers));
      setStep('mapping');
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message ?? 'Error al leer el archivo');
    }
    setUploading(false);
    setParsing(false);
  }, []);

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) processFile(file);
  }, [processFile]);

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  const previewRows = rows.slice(0, 5);

  const mappedLines = rows
    .map(r => rowToLineItem(r, mapping, defaultDate))
    .filter(l => l.description.trim() || l.amount > 0);

  const hasDescription = Object.values(mapping).includes('description');
  const hasAmount = Object.values(mapping).includes('amount');

  const handleConfirm = () => {
    if (mappedLines.length === 0) {
      toast.error('No hay filas válidas para importar');
      return;
    }
    onImport(mappedLines);
    handleClose();
    toast.success(`${mappedLines.length} partida${mappedLines.length !== 1 ? 's' : ''} importada${mappedLines.length !== 1 ? 's' : ''}`);
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-5 pb-4 border-b border-border flex-shrink-0">
          <DialogTitle className="text-base flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-primary" />
            Importar partidas desde Excel / CSV
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-0">
          <div className="px-6 py-5">

            {/* Step: Upload */}
            {step === 'upload' && (
              <div className="flex flex-col items-center justify-center py-10 gap-4">
                <div
                  className={`w-full border-2 border-dashed rounded-xl p-10 flex flex-col items-center gap-3 cursor-pointer transition-colors ${isDragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary hover:bg-muted/30'}`}
                  onClick={() => fileRef.current?.click()}
                  onDragOver={handleDragOver}
                  onDragEnter={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                >
                  {uploading || parsing ? (
                    <Loader2 className="w-8 h-8 text-primary animate-spin" />
                  ) : (
                    <Upload className="w-8 h-8 text-muted-foreground" />
                  )}
                  <div className="text-center">
                    <p className="text-sm font-medium">
                      {uploading ? 'Subiendo archivo...' : parsing ? 'Procesando...' : 'Haz clic para seleccionar archivo'}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">Excel (.xlsx) o CSV — máx. 10 MB</p>
                  </div>
                </div>
                <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/40 rounded-lg p-3 w-full">
                  <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  <span>
                    El archivo debe tener encabezados en la primera fila. Columnas sugeridas:{' '}
                    <strong>Descripción, Categoría, Monto, Fecha, Notas</strong>
                  </span>
                </div>
                <input ref={fileRef} type="file" className="hidden" accept=".xlsx,.xls,.csv"
                  onChange={handleFile} />
              </div>
            )}

            {/* Step: Mapping */}
            {step === 'mapping' && (
              <div className="space-y-5">
                <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                  <span>
                    <strong>{fileName}</strong> — {rows.length} fila{rows.length !== 1 ? 's' : ''} detectada{rows.length !== 1 ? 's' : ''}.
                    Asigna cada columna al campo correspondiente.
                  </span>
                </div>

                {/* Column mapping */}
                <div className="border border-border rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50 border-b border-border">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Columna en Excel</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Ejemplo de dato</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground w-44">Mapear a campo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {headers.map((h, i) => (
                        <tr key={i} className="hover:bg-muted/20">
                          <td className="px-3 py-2 font-medium">{h || `Columna ${i + 1}`}</td>
                          <td className="px-3 py-2 text-muted-foreground truncate max-w-[160px]">
                            {rows[0]?.[i] ?? '—'}
                          </td>
                          <td className="px-3 py-2">
                            <Select
                              value={mapping[i] ?? '__skip__'}
                              onValueChange={v => setMapping(prev => ({ ...prev, [i]: v as TargetKey }))}
                            >
                              <SelectTrigger className="h-7 text-xs w-40">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {TARGETS.map(t => (
                                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {(!hasDescription || !hasAmount) && (
                  <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>
                      {!hasDescription && !hasAmount
                        ? 'Asigna al menos una columna a Descripción y una a Monto.'
                        : !hasDescription
                          ? 'Recuerda asignar una columna a Descripción.'
                          : 'Recuerda asignar una columna a Monto.'}
                    </span>
                  </div>
                )}

                {/* Preview table */}
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">Vista previa (primeras {Math.min(5, rows.length)} filas)</p>
                  <div className="border border-border rounded-lg overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50 border-b border-border">
                        <tr>
                          <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Descripción</th>
                          <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Categoría</th>
                          <th className="text-right px-3 py-1.5 font-medium text-muted-foreground">Monto</th>
                          <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Fecha</th>
                          <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Notas</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {previewRows.map((row, ri) => {
                          const line = rowToLineItem(row, mapping, defaultDate);
                          return (
                            <tr key={ri} className="hover:bg-muted/20">
                              <td className="px-3 py-1.5 truncate max-w-[160px]">{line.description || <span className="text-muted-foreground italic">—</span>}</td>
                              <td className="px-3 py-1.5 truncate max-w-[100px]">{line.category || <span className="text-muted-foreground italic">—</span>}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums">
                                {line.amount > 0 ? line.amount.toLocaleString('es-MX', { minimumFractionDigits: 2 }) : <span className="text-muted-foreground italic">—</span>}
                              </td>
                              <td className="px-3 py-1.5">{line.date || <span className="text-muted-foreground italic">—</span>}</td>
                              <td className="px-3 py-1.5 truncate max-w-[120px]">{line.notes || <span className="text-muted-foreground italic">—</span>}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {rows.length > 5 && (
                    <p className="text-xs text-muted-foreground text-right">
                      …y {rows.length - 5} fila{rows.length - 5 !== 1 ? 's' : ''} más
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="px-6 py-4 border-t border-border flex-shrink-0 flex items-center justify-between gap-2">
          <div className="text-xs text-muted-foreground">
            {step === 'mapping' && mappedLines.length > 0 && (
              <span className="text-emerald-600 font-medium">{mappedLines.length} partida{mappedLines.length !== 1 ? 's' : ''} listas para importar</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {step === 'mapping' && (
              <Button variant="ghost" size="sm" onClick={() => { reset(); }} className="text-xs">
                Cambiar archivo
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={handleClose} className="text-xs">Cancelar</Button>
            {step === 'mapping' && (
              <Button size="sm" onClick={handleConfirm} disabled={mappedLines.length === 0} className="text-xs min-w-[120px]">
                Importar {mappedLines.length > 0 ? `${mappedLines.length} partida${mappedLines.length !== 1 ? 's' : ''}` : ''}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
