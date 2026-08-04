import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { uploadFile } from 'zite-file-upload-sdk';
import { parseExcelFile, importExcelData, ParseExcelFileOutputType, ImportExcelDataOutputType } from 'zite-endpoints-sdk';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, Layers, SkipForward, Users, ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { GROUP_COLORS } from './table/tableUtils';

type ParsedData = ParseExcelFileOutputType;
type DuplicateItem = ImportExcelDataOutputType['duplicates'][0] & {
  level: 'same_client' | 'already_participated' | 'external_duplicate' | 'same_project' | 'same_board';
  matchedProject: string;
  matchedBoard: string;
  matchedStatus: string;
  matchedBy: 'email' | 'name' | 'phone';
};
type ColumnTarget = 'participantName' | 'email' | 'phone' | 'idNumber' | 'status' | 'skip' | 'dynamic';

interface ColMapping {
  excelIndex:  number;
  header:      string;
  target:      ColumnTarget;
  dynamicName: string;
  included:    boolean;
}

const TARGET_LABELS: Record<ColumnTarget, string> = {
  participantName: 'Participante',
  email:           'Email',
  phone:           'Teléfono',
  idNumber:        'ID / Doc',
  status:          'Estado',
  dynamic:         'Columna dinámica',
  skip:            'Saltarse',
};

const SKIP_HEADERS = new Set([
  'subitems','sub-items','enviar nda','envío nda','envio nda',
  'status nda','aviso de privacidad','identificación 2 (url)','identificacion 2 (url)',
  'nda firmado (url)','link',
]);

function autoDetect(header: string): ColumnTarget {
  const h = header.toLowerCase().trim();
  if (SKIP_HEADERS.has(h) || !h) return 'skip';
  if (['name','nombre','nombres','participante','nombre completo','participantes'].includes(h)) return 'participantName';
  if (['email','e-mail','correo','correo electrónico'].includes(h)) return 'email';
  if (['teléfono','telefono','phone','tel','celular','número de celular'].includes(h)) return 'phone';
  if (['identificación 1','identificacion 1','id','documento','id/doc','id number'].includes(h)) return 'idNumber';
  if (['status','estado','estatus'].includes(h)) return 'status';
  return 'dynamic';
}

function buildMappings(headers: string[]): ColMapping[] {
  return headers.map((header, i) => {
    const target = autoDetect(header);
    return { excelIndex: i, header, target, dynamicName: header, included: target !== 'skip' };
  });
}

// ── Stepper ────────────────────────────────────────────────────────────────────
type Step = 1 | 2 | 3 | 4;
function Stepper({ step, hasDuplicates }: { step: Step; hasDuplicates: boolean }) {
  const steps = ['Subir archivo', 'Configurar mapeo', ...(hasDuplicates ? ['Revisar duplicados'] : []), 'Listo'];
  const totalSteps = steps.length;
  // Map logical step to display index
  const displayStep = hasDuplicates ? step : step === 4 ? 3 : step;
  return (
    <div className="flex items-center gap-0 mb-6">
      {steps.map((label, i) => {
        const n = i + 1;
        const active = n === displayStep, done = n < displayStep;
        return (
          <React.Fragment key={n}>
            <div className="flex flex-col items-center gap-1">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all ${
                done ? 'bg-primary border-primary text-primary-foreground' :
                active ? 'border-primary text-primary bg-primary/10' :
                'border-border text-muted-foreground'
              }`}>
                {done ? <CheckCircle2 className="w-3.5 h-3.5" /> : n}
              </div>
              <span className={`text-[10px] font-medium whitespace-nowrap ${active ? 'text-primary' : done ? 'text-muted-foreground' : 'text-muted-foreground/50'}`}>{label}</span>
            </div>
            {i < totalSteps - 1 && <div className={`flex-1 h-0.5 mb-4 mx-1 rounded ${n < displayStep ? 'bg-primary' : 'bg-border'}`} />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ── Step 1: Upload ─────────────────────────────────────────────────────────────
function UploadStep({ onParsed }: { onParsed: (data: ParsedData) => void }) {
  const [status, setStatus] = useState<'idle' | 'uploading' | 'parsing' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = async (file: File) => {
    const ext = file.name.toLowerCase();
    if (!ext.endsWith('.xlsx') && !ext.endsWith('.csv') && !ext.endsWith('.xls')) {
      setErrorMsg('Solo se aceptan archivos .xlsx, .xls o .csv'); setStatus('error'); return;
    }
    setStatus('uploading');
    try {
      const { fileUrl } = await uploadFile({ data: file, filename: file.name });
      setStatus('parsing');
      const result = await parseExcelFile({ fileUrl, fileName: file.name });
      if (result.totalRows === 0) throw new Error('El archivo no contiene datos.');
      onParsed(result);
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : 'Error al procesar el archivo');
      setStatus('error');
    }
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, []);

  return (
    <div className="space-y-4">
      <div
        onDrop={onDrop}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onClick={() => inputRef.current?.click()}
        className={`relative flex flex-col items-center justify-center gap-3 p-10 rounded-xl border-2 border-dashed cursor-pointer transition-all ${
          dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-muted/30'
        }`}
      >
        <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) processFile(f); }} />
        {status === 'uploading' || status === 'parsing' ? (
          <>
            <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            <p className="text-sm font-medium text-muted-foreground">
              {status === 'uploading' ? 'Subiendo archivo...' : 'Analizando estructura...'}
            </p>
          </>
        ) : (
          <>
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
              <FileSpreadsheet className="w-7 h-7 text-primary" />
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold">Arrastra tu archivo aquí</p>
              <p className="text-xs text-muted-foreground mt-0.5">o haz click para seleccionar</p>
            </div>
            <div className="flex items-center gap-2 mt-1">
              {['.xlsx', '.xls', '.csv'].map(ext => (
                <span key={ext} className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-mono">{ext}</span>
              ))}
            </div>
          </>
        )}
      </div>
      {status === 'error' && (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}
      <div className="rounded-lg bg-muted/40 border border-border/40 px-3 py-2.5 text-xs text-muted-foreground space-y-1">
        <p className="font-medium text-foreground">Consejo para exportar desde Monday:</p>
        <p>Menú del tablero → <strong>Exportar / integrar</strong> → <strong>Exportar a Excel</strong></p>
        <p>Los grupos de Monday se detectan automáticamente.</p>
      </div>
    </div>
  );
}

// ── Column mapping table ───────────────────────────────────────────────────────
function MappingTable({ mappings, onChange }: {
  mappings: ColMapping[];
  onChange: (idx: number, patch: Partial<ColMapping>) => void;
}) {
  return (
    <div className="border border-border/60 rounded-lg overflow-hidden">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-muted/50 border-b border-border/40">
            <th className="text-left px-3 py-2 font-semibold w-8">Incl.</th>
            <th className="text-left px-3 py-2 font-semibold">Columna en archivo</th>
            <th className="text-left px-3 py-2 font-semibold w-40">Mapear a</th>
            <th className="text-left px-3 py-2 font-semibold">Nombre en tablero</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/30">
          {mappings.map((m, i) => (
            <tr key={i} className={`transition-colors ${m.included ? 'bg-card' : 'bg-muted/20 opacity-50'}`}>
              <td className="px-3 py-2">
                <Checkbox checked={m.included} onCheckedChange={v => onChange(i, { included: !!v })} className="h-3.5 w-3.5" />
              </td>
              <td className="px-3 py-2 font-medium text-foreground max-w-[160px] truncate">{m.header || <span className="text-muted-foreground italic">vacío</span>}</td>
              <td className="px-3 py-2">
                <Select value={m.target} onValueChange={(v: ColumnTarget) => onChange(i, { target: v, included: v !== 'skip' })}>
                  <SelectTrigger className="h-6 text-xs border-border/50 w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.entries(TARGET_LABELS) as [ColumnTarget, string][]).map(([val, label]) => (
                      <SelectItem key={val} value={val} className="text-xs">{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </td>
              <td className="px-3 py-2">
                {m.included && m.target === 'dynamic' ? (
                  <Input value={m.dynamicName} onChange={e => onChange(i, { dynamicName: e.target.value })}
                    className="h-6 text-xs border-border/50 w-36" />
                ) : (
                  <span className="text-muted-foreground/60 italic text-[11px]">
                    {m.target === 'skip' ? '—' : TARGET_LABELS[m.target]}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Step 2: Mapping ────────────────────────────────────────────────────────────
function MappingStep({
  data, mappings, onMappingChange,
  groupDecisions, onGroupDecisionChange,
  boardName, createNewBoard, newBoardName, forceNewBoard,
  onToggleNewBoard, onNewBoardNameChange, onImport, checking,
}: {
  data:               ParsedData;
  mappings:           ColMapping[];
  onMappingChange:    (idx: number, patch: Partial<ColMapping>) => void;
  groupDecisions:     Map<string, 'create' | 'skip'>;
  onGroupDecisionChange: (name: string, action: 'create' | 'skip') => void;
  boardName?:         string;
  createNewBoard:     boolean;
  newBoardName:       string;
  forceNewBoard:      boolean;
  onToggleNewBoard:   () => void;
  onNewBoardNameChange: (v: string) => void;
  onImport:           () => void;
  checking:           boolean;
}) {
  const previewRows = data.rows.slice(0, 4);
  const includedMappings = mappings.filter(m => m.included && m.target !== 'skip');
  const totalParticipants = data.totalRows;
  const totalGroups = data.groups.length;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 p-3 rounded-xl bg-primary/5 border border-primary/20">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-primary">
          <FileSpreadsheet className="w-4 h-4" />
          {totalParticipants} participantes
        </div>
        {totalGroups > 0 && (
          <>
            <div className="w-px h-4 bg-primary/20" />
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Layers className="w-3.5 h-3.5" />
              {totalGroups} grupos detectados
            </div>
          </>
        )}
      </div>

      {totalGroups > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Grupos detectados</p>
          <div className="space-y-1.5">
            {data.groups.map((g, i) => {
              const color = GROUP_COLORS[i % GROUP_COLORS.length];
              const isCreate = (groupDecisions.get(g.name) ?? 'create') === 'create';
              return (
                <div
                  key={i}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border transition-colors ${
                    isCreate ? 'bg-primary/5 border-primary/20' : 'bg-muted/30 border-border/50'
                  }`}
                >
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color.color }} />
                  <span className={`text-xs font-medium truncate max-w-[180px] ${isCreate ? 'text-foreground' : 'text-muted-foreground'}`} title={g.name}>
                    {g.name}
                  </span>
                  <span className="text-[11px] text-muted-foreground/60">({g.rowIndices.length})</span>
                  <div className="ml-auto flex items-center gap-2 flex-shrink-0">
                    <span className={`text-[10px] font-medium ${isCreate ? 'text-primary' : 'text-muted-foreground'}`}>
                      {isCreate ? 'Crear grupo' : 'Sin grupo'}
                    </span>
                    <Switch
                      checked={isCreate}
                      onCheckedChange={v => onGroupDecisionChange(g.name, v ? 'create' : 'skip')}
                      className="scale-75"
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground/80 leading-relaxed">
            💡 Los participantes de grupos creados se marcarán como <strong className="text-foreground">"Asistió"</strong> automáticamente. Los demás quedarán como "Pendiente".
          </p>
        </div>
      )}

      <div className="space-y-1.5">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Mapeo de columnas</p>
        <div className="max-h-52 overflow-y-auto rounded-lg">
          <MappingTable mappings={mappings} onChange={onMappingChange} />
        </div>
      </div>

      {previewRows.length > 0 && includedMappings.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Vista previa (primeras {previewRows.length} filas)</p>
          <div className="rounded-lg border border-border/50 overflow-auto max-h-32">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 sticky top-0">
                <tr>{includedMappings.slice(0, 6).map((m, i) => (
                  <th key={i} className="text-left px-2 py-1.5 font-semibold border-b border-border/40 whitespace-nowrap">
                    {m.target === 'dynamic' ? m.dynamicName : TARGET_LABELS[m.target]}
                  </th>
                ))}</tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {previewRows.map((row, ri) => (
                  <tr key={ri} className="hover:bg-muted/20">
                    {includedMappings.slice(0, 6).map((m, ci) => (
                      <td key={ci} className="px-2 py-1.5 max-w-[140px] truncate text-muted-foreground">
                        {(row[m.excelIndex] || '').trim() || <span className="text-muted-foreground/30 italic">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="space-y-2 pt-1 border-t border-border/40">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Destino</p>
        {forceNewBoard ? (
          <div className="px-3 py-2.5 rounded-lg border border-primary bg-primary/10">
            <div className="text-xs font-semibold text-primary mb-1.5">✓ Nuevo tablero</div>
            <Input value={newBoardName} onChange={e => onNewBoardNameChange(e.target.value)}
              placeholder="Nombre del tablero..."
              className="h-7 text-xs text-foreground bg-background" autoFocus />
          </div>
        ) : (
          <div className="flex gap-2">
            <button onClick={() => createNewBoard && onToggleNewBoard()}
              className={`flex-1 px-3 py-2 text-xs rounded-lg border transition-all text-left ${
                !createNewBoard ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-border bg-card text-muted-foreground hover:border-border/80'
              }`}>
              <div className="font-medium">{!createNewBoard ? '✓ ' : ''}Tablero actual</div>
              <div className="text-muted-foreground font-normal mt-0.5 truncate">{boardName}</div>
            </button>
            <button onClick={() => !createNewBoard && onToggleNewBoard()}
              className={`flex-1 px-3 py-2 text-xs rounded-lg border transition-all text-left ${
                createNewBoard ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-border bg-card text-muted-foreground hover:border-border/80'
              }`}>
              <div className="font-medium">{createNewBoard ? '✓ ' : ''}Nuevo tablero</div>
              {createNewBoard ? (
                <Input value={newBoardName} onChange={e => onNewBoardNameChange(e.target.value)}
                  placeholder="Nombre del tablero..." onClick={e => e.stopPropagation()}
                  className="mt-1 h-6 text-xs text-foreground bg-background" />
              ) : (
                <div className="text-muted-foreground font-normal mt-0.5">Se creará uno nuevo</div>
              )}
            </button>
          </div>
        )}
      </div>

      <Button onClick={onImport} disabled={checking || ((createNewBoard || forceNewBoard) && !newBoardName.trim())} className="w-full gap-2">
        {checking ? (
          <><div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Verificando duplicados...</>
        ) : (
          <><Upload className="w-3.5 h-3.5" /> Importar {totalParticipants} participantes</>
        )}
      </Button>
    </div>
  );
}

// ── Duplicate level config ─────────────────────────────────────────────────────
const LEVEL_CONFIG = {
  same_client: {
    emoji: '🔴', label: 'Mismo cliente',
    desc: 'Participaron en un estudio del mismo cliente',
    badgeClass: 'border-destructive/30 text-destructive bg-destructive/5',
    sectionClass: 'border-destructive/20 bg-destructive/5',
    headerClass: 'text-destructive',
  },
  already_participated: {
    emoji: '🔺', label: 'Participó (reciente / activo)',
    desc: 'Activos en otro proyecto o participaron hace < 6 meses',
    badgeClass: 'border-destructive/30 text-destructive bg-destructive/5',
    sectionClass: 'border-destructive/20 bg-destructive/5',
    headerClass: 'text-destructive',
  },
  external_duplicate: {
    emoji: '🔵', label: 'Solo registrado',
    desc: 'Aparecen en otro proyecto sin participar (> 6 meses)',
    badgeClass: 'border-blue-500/30 text-blue-700 bg-blue-500/5',
    sectionClass: 'border-blue-500/20 bg-blue-500/5',
    headerClass: 'text-blue-700',
  },
  same_project: {
    emoji: '🟠', label: 'Mismo proyecto',
    desc: 'Ya están en otro tablero de este proyecto',
    badgeClass: 'border-orange-500/30 text-orange-700 bg-orange-500/5',
    sectionClass: 'border-orange-500/20 bg-orange-500/5',
    headerClass: 'text-orange-700',
  },
  same_board: {
    emoji: '🟠', label: 'En este tablero',
    desc: 'Ya existen en este mismo tablero',
    badgeClass: 'border-orange-500/30 text-orange-700 bg-orange-500/5',
    sectionClass: 'border-orange-500/20 bg-orange-500/5',
    headerClass: 'text-orange-700',
  },
} as const;

const MATCH_BY_LABEL: Record<string, string> = { email: 'Email', name: 'Nombre', phone: 'Teléfono' };
const LEVEL_ORDER: DuplicateItem['level'][] = ['same_client', 'already_participated', 'external_duplicate', 'same_project', 'same_board'];

// ── Collapsible duplicate section ─────────────────────────────────────────────
function DupSection({ level, items }: { level: DuplicateItem['level']; items: DuplicateItem[] }) {
  const [open, setOpen] = useState(true);
  const cfg = LEVEL_CONFIG[level];
  return (
    <div className={`rounded-lg border ${cfg.sectionClass} overflow-hidden`}>
      <button
        onClick={() => setOpen(p => !p)}
        className={`w-full flex items-center justify-between px-3 py-2.5 text-left ${cfg.headerClass}`}
      >
        <span className="flex items-center gap-2 text-xs font-semibold">
          <span>{cfg.emoji}</span>
          <span>{cfg.label}</span>
          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 font-bold ${cfg.badgeClass}`}>{items.length}</Badge>
          <span className="font-normal text-muted-foreground">{cfg.desc}</span>
        </span>
        {open ? <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" />}
      </button>
      {open && (
        <div className="border-t border-border/20">
          <table className="w-full text-xs">
            <thead className="bg-muted/40">
              <tr>
                <th className="text-left px-3 py-1.5 font-semibold text-muted-foreground">Nombre en archivo</th>
                <th className="text-left px-3 py-1.5 font-semibold text-muted-foreground">Proyecto / Tablero</th>
                <th className="text-left px-3 py-1.5 font-semibold text-muted-foreground w-20">Match por</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/20 bg-card/60">
              {items.map((d, i) => (
                <tr key={i} className="hover:bg-muted/20 transition-colors">
                  <td className="px-3 py-2">
                    <div className="font-medium text-foreground truncate max-w-[180px]">{d.name}</div>
                    {d.email && <div className="text-muted-foreground/60 truncate max-w-[180px] text-[11px]">{d.email}</div>}
                    {d.phone && !d.email && <div className="text-muted-foreground/60 truncate max-w-[180px] text-[11px]">{d.phone}</div>}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-foreground truncate max-w-[180px]">{d.matchedProject}</div>
                    {d.matchedBoard && <div className="text-muted-foreground/60 text-[11px] truncate max-w-[180px]">{d.matchedBoard}</div>}
                    {d.matchedStatus && <div className="text-muted-foreground/50 text-[11px]">{d.matchedStatus}</div>}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${cfg.badgeClass}`}>
                      {MATCH_BY_LABEL[d.matchedBy] ?? d.matchedBy}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Step 3: Duplicate Review ───────────────────────────────────────────────────
function DuplicateReviewStep({
  newCount, duplicates, onSkipDuplicates, onImportAll, importing,
}: {
  newCount:           number;
  duplicates:         DuplicateItem[];
  onSkipDuplicates:   () => void;
  onImportAll:        () => void;
  importing:          boolean;
}) {
  // Group by level
  const byLevel = Object.fromEntries(
    LEVEL_ORDER.map(l => [l, duplicates.filter(d => d.level === l)])
  ) as Record<DuplicateItem['level'], DuplicateItem[]>;
  byLevel.same_client ??= [];

  // Build summary counters (only non-zero)
  const counters: { emoji: string; label: string; count: number; cls: string }[] = [
    { emoji: '🆕', label: 'Nuevas', count: newCount, cls: 'bg-primary/5 border-primary/20 text-primary' },
    ...(byLevel.same_client.length           ? [{ emoji: '🔺', label: 'Mismo cliente',       count: byLevel.same_client.length,           cls: 'bg-destructive/5 border-destructive/20 text-destructive' }] : []),
    ...(byLevel.already_participated.length  ? [{ emoji: '🔺', label: 'Participó (reciente)', count: byLevel.already_participated.length,  cls: 'bg-destructive/5 border-destructive/20 text-destructive' }] : []),
    ...(byLevel.external_duplicate.length    ? [{ emoji: '🔵', label: 'Solo registrado',     count: byLevel.external_duplicate.length,    cls: 'bg-blue-500/5 border-blue-500/20 text-blue-700' }] : []),
    ...(byLevel.same_project.length          ? [{ emoji: '🟠', label: 'Mismo proyecto',      count: byLevel.same_project.length,          cls: 'bg-orange-500/5 border-orange-500/20 text-orange-700' }] : []),
    ...(byLevel.same_board.length            ? [{ emoji: '🟠', label: 'Este tablero',         count: byLevel.same_board.length,            cls: 'bg-orange-500/5 border-orange-500/20 text-orange-700' }] : []),
  ];

  const activeLevels = LEVEL_ORDER.filter(l => byLevel[l].length > 0);

  return (
    <div className="space-y-4">
      {/* Summary counters */}
      <div className={`grid gap-2.5`} style={{ gridTemplateColumns: `repeat(${counters.length}, 1fr)` }}>
        {counters.map(c => (
          <div key={c.label} className={`flex flex-col items-center gap-1 p-3 rounded-xl border ${c.cls}`}>
            <span className="text-base">{c.emoji}</span>
            <span className="text-xl font-bold">{c.count}</span>
            <span className="text-[10px] font-medium text-center leading-tight">{c.label}</span>
          </div>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        Se encontraron posibles coincidencias entre el archivo y participantes existentes.
        Revisa por categoría y decide cómo continuar.
      </p>

      {/* Sections per level */}
      <div className="space-y-2 max-h-64 overflow-y-auto pr-0.5">
        {activeLevels.map(level => (
          <DupSection key={level} level={level} items={byLevel[level]} />
        ))}
      </div>

      {/* Action buttons */}
      <div className="flex flex-col gap-2 pt-1 border-t border-border/40">
        <Button onClick={onSkipDuplicates} disabled={importing} className="w-full gap-2">
          {importing ? (
            <><div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Importando...</>
          ) : (
            <><SkipForward className="w-3.5 h-3.5" /> Saltar duplicados — importar solo {newCount} nuevas</>
          )}
        </Button>
        <Button onClick={onImportAll} disabled={importing} variant="outline" className="w-full gap-2">
          {importing ? (
            <><div className="w-3.5 h-3.5 border-2 border-foreground/30 border-t-foreground rounded-full animate-spin" /> Importando...</>
          ) : (
            <><Upload className="w-3.5 h-3.5" /> Importar todo igualmente ({newCount + duplicates.length} participantes)</>
          )}
        </Button>
      </div>
    </div>
  );
}

// ── Step 4: Result ─────────────────────────────────────────────────────────────
function ResultStep({ imported, groupsCreated, columnsCreated, skipped, newBoardName, onClose }: {
  imported: number; groupsCreated: number; columnsCreated: number;
  skipped: number; newBoardName?: string; onClose: () => void;
}) {
  return (
    <div className="space-y-5 py-2">
      <div className="flex flex-col items-center gap-3 py-4">
        <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
          <CheckCircle2 className="w-7 h-7 text-primary" />
        </div>
        <div className="text-center">
          <p className="text-lg font-bold">{imported} participantes importados</p>
          <p className="text-sm text-muted-foreground mt-0.5">La importación se completó correctamente</p>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Importados',    value: imported,       icon: '👥' },
          { label: 'Grupos',        value: groupsCreated,  icon: '🗂️' },
          { label: 'Cols. nuevas',  value: columnsCreated, icon: '📊' },
          { label: 'Saltados',      value: skipped,        icon: '⏭️' },
        ].map(({ label, value, icon }) => (
          <div key={label} className="flex flex-col items-center gap-1 p-3 rounded-xl bg-muted/40 border border-border/40">
            <span className="text-lg">{icon}</span>
            <span className="text-xl font-bold">{value}</span>
            <span className="text-xs text-muted-foreground text-center">{label}</span>
          </div>
        ))}
      </div>
      {newBoardName && (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-primary/5 border border-primary/20 text-xs text-primary">
          <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
          Tablero <strong>"{newBoardName}"</strong> creado
        </div>
      )}
      <Button onClick={onClose} className="w-full">Cerrar</Button>
    </div>
  );
}

// ── Import Progress View ───────────────────────────────────────────────────────
function ImportProgressView({ totalRows, done }: { totalRows: number; done: boolean }) {
  const [progress, setProgress] = useState(0);

  const estimatedMs = Math.max(3000, (totalRows / 20) * 1000);
  const intervalMs  = 200;

  useEffect(() => {
    if (done) { setProgress(100); return; }

    const id = setInterval(() => {
      setProgress(prev => {
        if (prev >= 90) return prev;
        // ease-out: increment shrinks as we approach 90
        const remaining = 90 - prev;
        const increment = (remaining / (estimatedMs / intervalMs)) * 2.5;
        return Math.min(90, prev + Math.max(0.3, increment));
      });
    }, intervalMs);

    return () => clearInterval(id);
  }, [done, estimatedMs]);

  const estimated = Math.round((progress / 100) * totalRows);

  return (
    <div className="flex flex-col items-center justify-center gap-6 py-8 px-4">
      <div className="relative flex items-center justify-center w-16 h-16">
        <div className="absolute inset-0 rounded-full border-4 border-primary/20" />
        <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-primary animate-spin" />
        <FileSpreadsheet className="w-6 h-6 text-primary" />
      </div>

      <div className="w-full space-y-2 text-center">
        <p className="text-sm font-semibold text-foreground">Importando participantes...</p>
        {totalRows > 0 && (
          <p className="text-xs text-muted-foreground">
            ~{estimated} de {totalRows} participantes procesados
          </p>
        )}
      </div>

      <div className="w-full space-y-1.5">
        <Progress value={progress} className="h-2 w-full" />
        <p className="text-right text-[11px] text-muted-foreground">{Math.round(progress)}%</p>
      </div>

      <p className="text-xs text-muted-foreground text-center">
        Esto puede tardar unos segundos dependiendo del tamaño del archivo…
      </p>
    </div>
  );
}

// ── Main dialog ────────────────────────────────────────────────────────────────
export function ExcelImportDialog({
  open, onOpenChange, boardId, boardName, projectCode, currentClient, onImported,
}: {
  open:          boolean;
  onOpenChange:  (v: boolean) => void;
  boardId?:      string;
  boardName?:    string;
  projectCode:   string;
  currentClient?: string;
  onImported:    (imported: number, newBoardName?: string) => void;
}) {
  const forceNewBoard = !boardId;

  const [step, setStep]               = useState<Step>(1);
  const [parsed, setParsed]           = useState<ParsedData | null>(null);
  const [mappings, setMappings]       = useState<ColMapping[]>([]);
  const [groupDecisions, setGroupDecisions] = useState<Map<string, 'create' | 'skip'>>(new Map());
  const [createNewBoard, setNew]      = useState(false);
  const [newBoardName, setNewName]    = useState('');
  const [checking, setChecking]       = useState(false);
  const [importing, setImporting]     = useState(false);
  const [duplicates, setDuplicates]   = useState<DuplicateItem[]>([]);
  const [newCount, setNewCount]       = useState(0);
  const [skipped, setSkipped]         = useState(0);
  const [result, setResult]           = useState<{ imported: number; groupsCreated: number; columnsCreated: number; newBoardName?: string } | null>(null);

  const reset = () => {
    setStep(1); setParsed(null); setMappings([]); setGroupDecisions(new Map()); setNew(forceNewBoard);
    setNewName(''); setChecking(false); setImporting(false);
    setDuplicates([]); setNewCount(0); setSkipped(0); setResult(null);
  };

  const handleParsed = (data: ParsedData) => {
    setParsed(data);
    setMappings(buildMappings(data.headers));
    // Initialize all groups as 'create' by default
    const decisions = new Map<string, 'create' | 'skip'>();
    for (const g of data.groups) decisions.set(g.name, 'create');
    setGroupDecisions(decisions);
    if (forceNewBoard) setNew(true);
    setStep(2);
  };

  const updateMapping = (idx: number, patch: Partial<ColMapping>) => {
    setMappings(prev => prev.map((m, i) => i === idx ? { ...m, ...patch } : m));
  };

  const buildImportPayload = (skipDuplicatesFlag: boolean, dryRunFlag: boolean) => {
    const effectiveCreateNewBoard = forceNewBoard || createNewBoard;
    return {
      boardId:        boardId ?? '',
      boardName:      boardName ?? '',
      projectCode,
      currentClient,
      createNewBoard: effectiveCreateNewBoard,
      newBoardName,
      columnMapping:  mappings.map(m => ({ excelIndex: m.excelIndex, target: m.target, dynamicColumnName: m.dynamicName, included: m.included })),
      groups:         parsed!.groups,
      groupDecisions: Array.from(groupDecisions.entries()).map(([name, action]) => ({ name, action })),
      rows:           parsed!.rows,
      dryRun:         dryRunFlag,
      skipDuplicates: skipDuplicatesFlag,
    };
  };

  // Called when user clicks "Importar" in step 2
  const handleCheckDuplicates = async () => {
    if (!parsed) return;
    const effectiveNewBoard = forceNewBoard || createNewBoard;

    // For new boards there can't be duplicates — skip check
    if (effectiveNewBoard) {
      await doImport(false);
      return;
    }

    setChecking(true);
    try {
      const res = await importExcelData({ ...buildImportPayload(false, true) });
      setDuplicates(res.duplicates);
      setNewCount(res.newCount);
      if (res.duplicateCount === 0) {
        // No duplicates — go straight to importing
        await doImport(false);
      } else {
        setChecking(false);
        setStep(3);
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error al verificar duplicados');
      setChecking(false);
    }
  };

  const doImport = async (skipDuplicatesFlag: boolean) => {
    if (!parsed) return;
    // Set importing BEFORE clearing checking to avoid any flash of empty UI
    setImporting(true);
    setChecking(false);
    try {
      const res = await importExcelData({ ...buildImportPayload(skipDuplicatesFlag, false) });
      const skippedCount = skipDuplicatesFlag ? duplicates.length : 0;
      setSkipped(skippedCount);
      setResult(res);
      setStep(4);
      onImported(res.imported, res.newBoardName ?? undefined);
      toast.success(`${res.imported} participantes importados${skippedCount > 0 ? `, ${skippedCount} duplicados saltados` : ''}`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error al importar');
    }
    setImporting(false);
  };

  const busy = checking || importing;

  return (
    <Dialog open={open} onOpenChange={v => { if (!busy) { if (!v) reset(); onOpenChange(v); } }}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10">
              <FileSpreadsheet className="w-4 h-4 text-primary" />
            </div>
            Importar desde Excel / CSV
          </DialogTitle>
        </DialogHeader>

        <Stepper step={step} hasDuplicates={duplicates.length > 0} />

        {importing && step !== 4 && (
          <ImportProgressView totalRows={parsed?.totalRows ?? 0} done={false} />
        )}

        {!importing && step === 1 && <UploadStep onParsed={handleParsed} />}

        {!importing && step === 2 && parsed && (
          <MappingStep
            data={parsed} mappings={mappings} onMappingChange={updateMapping}
            groupDecisions={groupDecisions}
            onGroupDecisionChange={(name, action) => setGroupDecisions(prev => { const next = new Map(prev); next.set(name, action); return next; })}
            boardName={boardName}
            createNewBoard={createNewBoard}
            newBoardName={newBoardName}
            forceNewBoard={forceNewBoard}
            onToggleNewBoard={() => setNew(p => !p)}
            onNewBoardNameChange={setNewName}
            onImport={handleCheckDuplicates}
            checking={checking}
          />
        )}

        {!importing && step === 3 && (
          <DuplicateReviewStep
            newCount={newCount}
            duplicates={duplicates}
            onSkipDuplicates={() => doImport(true)}
            onImportAll={() => doImport(false)}
            importing={importing}
          />
        )}

        {!importing && step === 4 && result && (
          <ResultStep
            {...result}
            skipped={skipped}
            onClose={() => { reset(); onOpenChange(false); }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
