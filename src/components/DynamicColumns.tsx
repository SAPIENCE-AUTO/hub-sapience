import { useState, useRef, useEffect, useMemo, useCallback, useContext, createContext, memo } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from 'zite-auth-sdk';
import { getTeamMembers, GetTeamMembersOutputType } from 'zite-endpoints-sdk';

type TeamMember = GetTeamMembersOutputType['members'][0];

// Shared context so team members are fetched once per page
const TeamMembersContext = createContext<TeamMember[]>([]);

export function TeamMembersProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [members, setMembers] = useState<TeamMember[]>([]);
  useEffect(() => {
    if (!user?.email) return;
    getTeamMembers({}).then(r => setMembers(r.members)).catch(err => console.warn('[TeamMembersProvider] getTeamMembers failed:', err));
  }, [user?.email]);
  return <TeamMembersContext.Provider value={members}>{children}</TeamMembersContext.Provider>;
}

function fmtDate(d: Date): string {
  const day = String(d.getDate()).padStart(2, '0');
  const mon = d.toLocaleDateString('es', { month: 'short' }).replace('.', '');
  const year = d.getFullYear();
  return `${day}-${mon}-${year}`;
}
import { Calendar as CalendarUI } from '@/components/ui/calendar';
import { useDebouncedCallback } from 'use-debounce';
import type { useDynamicColumns } from '../hooks/useDynamicColumns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Plus, MoreHorizontal, Trash2, Pencil, Star, Loader2, Zap, X,
  ChevronDown, ChevronUp, ArrowUpDown, CircleDot, Type, Hash, Calendar as CalendarIcon, Clock, CheckSquare,
  ChevronDownCircle, User, Mail, Phone, Paperclip, MousePointerClick,
  Square as LucideIcon, ArrowLeftFromLine, ArrowRightFromLine, GripVertical,
  Pipette, Calculator, MapPin, ExternalLink, GaugeCircle, Highlighter, Copy, Link2,
} from 'lucide-react';
import { executeButtonAction, getStreetViewUrl } from 'zite-endpoints-sdk';
import { ColumnFilterPopover } from './ColumnFilterPopover';
import { toast } from 'sonner';

/**
 * If `raw` is a JSON address object (has `address`, `city`, or `state` keys),
 * returns a clean readable string like "Paseo de la Reforma 123, Monterrey, N.L."
 * Otherwise returns the original string unchanged.
 */
export function formatAddressText(raw: string | null | undefined): string {
  if (!raw) return raw ?? '';
  if (!raw.trimStart().startsWith('{')) return raw;
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      const { address, city, state } = obj as Record<string, unknown>;
      const parts = [address, city, state]
        .map(v => (typeof v === 'string' ? v.trim() : ''))
        .filter(Boolean);
      if (parts.length > 0) return parts.join(', ');
    }
  } catch { /* not valid JSON — fall through */ }
  return raw;
}

export type DynCols = ReturnType<typeof useDynamicColumns>;
type DynCol = DynCols['columns'][0];
type CellVal = Parameters<DynCols['setCellVal']>[2];

// ── Color palette ─────────────────────────────────────────────────────────────
export const STATUS_COLORS: { value: string; label: string; bg: string; text: string }[] = [
  { value: 'green',  label: 'Verde',    bg: 'bg-emerald-500', text: 'text-white' },
  { value: 'yellow', label: 'Amarillo', bg: 'bg-yellow-400',  text: 'text-gray-900' },
  { value: 'red',    label: 'Rojo',     bg: 'bg-red-500',     text: 'text-white' },
  { value: 'blue',   label: 'Azul',     bg: 'bg-blue-500',    text: 'text-white' },
  { value: 'purple', label: 'Morado',   bg: 'bg-violet-500',  text: 'text-white' },
  { value: 'orange', label: 'Naranja',  bg: 'bg-orange-400',  text: 'text-white' },
  { value: 'gray',   label: 'Gris',     bg: 'bg-slate-400',   text: 'text-white' },
  { value: 'teal',   label: 'Teal',     bg: 'bg-teal-500',    text: 'text-white' },
  { value: 'pink',   label: 'Rosa',     bg: 'bg-pink-500',    text: 'text-white' },
  { value: 'cyan',   label: 'Cyan',     bg: 'bg-cyan-500',    text: 'text-white' },
  { value: 'lime',   label: 'Lima',     bg: 'bg-lime-500',    text: 'text-white' },
  { value: 'indigo', label: 'Índigo',   bg: 'bg-indigo-500',  text: 'text-white' },
];

export interface ColoredOption { label: string; color: string; }

function getColor(colorValue: string) {
  return STATUS_COLORS.find(c => c.value === colorValue) ?? STATUS_COLORS[6];
}

function parseColoredOptions(optionsJson?: string | null): ColoredOption[] {
  try {
    const parsed = JSON.parse(optionsJson ?? '[]');
    if (!Array.isArray(parsed) || parsed.length === 0) return [];
    if (typeof parsed[0] === 'string') return parsed.map((s: string) => ({ label: s, color: 'gray' }));
    return parsed as ColoredOption[];
  } catch { return []; }
}

// ── "Texto con color" cell metadata ───────────────────────────────────────────
// El color es por CELDA (cada fila puede pintar su nota distinto), no por
// columna como Status/Select — no cabe en optionsJson (config a nivel
// columna). Se guarda en `fileUrl`, un campo de CellVal que este tipo de
// columna no usa para nada más (igual que Rating usa numberValue o Checkbox
// usa booleanValue) — así `textValue` se queda como texto plano de verdad,
// sin encodear nada ahí, y sigue funcionando tal cual en búsqueda/filtro/CSV
// como cualquier columna de Texto normal.
interface TextoColorMeta { textColor?: string; bgColor?: string; }

function parseTextoColorMeta(fileUrl?: string | null): TextoColorMeta | null {
  if (!fileUrl) return null;
  try {
    const parsed = JSON.parse(fileUrl);
    if (parsed && typeof parsed === 'object') return parsed as TextoColorMeta;
    return null;
  } catch { return null; }
}

// ── Column type icons ─────────────────────────────────────────────────────────
const COLUMN_TYPE_ICONS: Record<string, typeof LucideIcon> = {
  'Status':    CircleDot,
  'Texto':     Type,
  'Número':    Hash,
  'Fecha':     CalendarIcon,
  'Datetime':  Clock,
  'Checkbox':  CheckSquare,
  'Select':    ChevronDownCircle,
  'Persona':   User,
  'Email':     Mail,
  'Teléfono':  Phone,
  'Archivo':   Paperclip,
  'Rating':    Star,
  'Botón':     MousePointerClick,
  'Link':      Link2,
  'Color':     Pipette,
  'Fórmula':   Calculator,
  'Barra':     GaugeCircle,
  'TextoColor': Highlighter,
};

function ColTypeIcon({ type, className = 'w-3.5 h-3.5' }: { type?: string; className?: string }) {
  const Icon = COLUMN_TYPE_ICONS[type ?? ''] ?? Type;
  return <Icon className={className} />;
}

const COLUMN_TYPES = [
  { value: 'Status',   label: 'Status (con colores)' },
  { value: 'Texto',    label: 'Texto' },
  { value: 'Número',   label: 'Número' },
  { value: 'Fecha',    label: 'Fecha' },
  { value: 'Datetime', label: 'Fecha y hora' },
  { value: 'Checkbox', label: 'Checkbox' },
  { value: 'Select',   label: 'Select (opciones)' },
  { value: 'Color',    label: 'Color (selector)' },
  { value: 'Fórmula',  label: 'Fórmula (calculada)' },
  { value: 'Persona',  label: 'Persona' },
  { value: 'Email',    label: 'Email' },
  { value: 'Teléfono', label: 'Teléfono' },
  { value: 'Archivo',  label: 'Archivo (URL)' },
  { value: 'Rating',   label: 'Rating (1–5)' },
  { value: 'Botón',    label: 'Botón (acción)' },
  { value: 'Link',     label: 'Link (con copiar)' },
  { value: 'Barra',    label: 'Barra de progreso (%)' },
  { value: 'TextoColor', label: 'Texto con color' },
];

const BUTTON_ACTIONS = [
  { value: 'send_nda',      label: '📄 Enviar NDA' },
  { value: 'change_status', label: '🔄 Cambiar Status' },
  { value: 'send_email',    label: '📧 Enviar Email' },
  { value: 'duplicate_row', label: '📋 Duplicar Fila' },
  { value: 'webhook',       label: '⚡ Webhook (n8n / Zapier)' },
  { value: 'create_observation_stream', label: '📡 Crear Sala de observación' },
];

const BUTTON_VARIANTS = [
  { value: 'default',     label: '🔵 Primary' },
  { value: 'destructive', label: '🔴 Rojo' },
  { value: 'outline',     label: '⬜ Outline' },
  { value: 'secondary',   label: '⚫ Secondary' },
];

interface ButtonConfig { action: string; label: string; variant: string; newStatus?: string; webhookUrl?: string; }

function parseButtonConfig(optionsJson?: string | null): ButtonConfig {
  try { return JSON.parse(optionsJson ?? '{}'); } catch { return { action: '', label: 'Ejecutar', variant: 'default' }; }
}

// ── Formula config ────────────────────────────────────────────────────────────
interface FormulaConfig { expression: string; resultType: 'number' | 'text' | 'date'; }

function parseFormulaConfig(optionsJson?: string | null): FormulaConfig {
  try {
    const p = JSON.parse(optionsJson ?? '{}');
    return { expression: p.expression ?? '', resultType: p.resultType ?? 'number' };
  } catch { return { expression: '', resultType: 'number' }; }
}

// ── Formula evaluator ─────────────────────────────────────────────────────────
function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0, inStr = false, strChar = '', current = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      current += ch;
      if (ch === strChar && s[i - 1] !== '\\') inStr = false;
    } else if (ch === '"' || ch === "'") {
      inStr = true; strChar = ch; current += ch;
    } else if (ch === '(') { depth++; current += ch; }
    else if (ch === ')') { depth--; current += ch; }
    else if (ch === ',' && depth === 0) { parts.push(current.trim()); current = ''; }
    else { current += ch; }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function replaceFunctionCalls(expr: string): string {
  const FNS = ['DAYS_BETWEEN', 'CONCAT', 'IF', 'ROUND', 'UPPER', 'LOWER', 'ABS', 'MIN', 'MAX', 'SUM'];
  let result = expr;
  let changed = true;
  let iters = 0;
  while (changed && iters++ < 20) {
    changed = false;
    for (const fn of FNS) {
      const idx = result.indexOf(fn + '(');
      if (idx === -1) continue;
      let depth = 0, end = -1;
      for (let i = idx + fn.length; i < result.length; i++) {
        if (result[i] === '(') depth++;
        else if (result[i] === ')') { depth--; if (depth === 0) { end = i; break; } }
      }
      if (end === -1) continue;
      const argsStr = result.substring(idx + fn.length + 1, end);
      const args = splitTopLevel(argsStr);
      let replacement = '"#ERROR"';
      switch (fn) {
        case 'DAYS_BETWEEN':
          if (args.length >= 2) replacement = `(Math.floor((new Date(${args[1]})-new Date(${args[0]}))/86400000))`;
          break;
        case 'CONCAT':
          replacement = args.map(a => `String(${a})`).join('+');
          break;
        case 'IF':
          if (args.length === 3) replacement = `((${args[0]})?(${args[1]}):(${args[2]}))`;
          break;
        case 'ROUND':
          replacement = `(Math.round((${args[0]})*Math.pow(10,${args[1] ?? 0}))/Math.pow(10,${args[1] ?? 0}))`;
          break;
        case 'UPPER': replacement = `(String(${args[0]}).toUpperCase())`; break;
        case 'LOWER': replacement = `(String(${args[0]}).toLowerCase())`; break;
        case 'ABS':   replacement = `Math.abs(${args[0]})`; break;
        case 'MIN':   if (args.length >= 2) replacement = `Math.min(${args[0]},${args[1]})`; break;
        case 'MAX':   if (args.length >= 2) replacement = `Math.max(${args[0]},${args[1]})`; break;
        case 'SUM':   replacement = `(${args[0]})`; break;
      }
      result = result.substring(0, idx) + replacement + result.substring(end + 1);
      changed = true;
    }
  }
  return result;
}

function evaluateFormula(expression: string, rowId: string, dynCols: DynCols): string {
  try {
    let expr = expression.trim();
    if (!expr) return '';
    let hasRefError = false;

    // 1. Resolve {ColumnName} references
    expr = expr.replace(/\{([^}]+)\}/g, (_, colName) => {
      const col = dynCols.columns.find(c => c.columnName === colName);
      if (!col) { hasRefError = true; return '0'; }
      const cell = dynCols.getCellVal(rowId, col.id);
      if (!cell) return 'null';
      if (cell.numberValue != null) return String(cell.numberValue);
      if (cell.dateValue)           return JSON.stringify(cell.dateValue);
      if (cell.textValue != null)   return JSON.stringify(cell.textValue);
      if (cell.booleanValue != null) return String(cell.booleanValue);
      return 'null';
    });
    if (hasRefError) return '#REF';

    // 2. TODAY()
    expr = expr.replace(/TODAY\(\)/g, JSON.stringify(new Date().toISOString().split('T')[0]));

    // 3. Transform custom functions
    expr = replaceFunctionCalls(expr);

    // 4. Block dangerous identifiers before evaluation
    const dangerous = /\b(window|document|location|navigator|alert|confirm|prompt|fetch|XMLHttpRequest|eval|Function|constructor|__proto__|prototype|setTimeout|setInterval|localStorage|sessionStorage|indexedDB|process|global|globalThis|self|frames|parent|opener)\b/;
    if (dangerous.test(expr)) return '#ERROR';

    // 5. Evaluate in a sandboxed scope — shadow browser globals so they
    //    are undefined even if they slip past the regex check above
    // eslint-disable-next-line no-new-func
    const sandbox = Function(
      'Math', 'String', 'Number', 'Boolean', 'Array', 'Object',
      'isNaN', 'isFinite', 'parseInt', 'parseFloat', 'JSON',
      'window', 'document', 'location', 'navigator', 'global',
      'globalThis', 'self', 'process', 'eval', 'Function',
      '"use strict"; return (' + expr + ')'
    );
    const result = sandbox(
      Math, String, Number, Boolean, Array, Object,
      isNaN, isFinite, parseInt, parseFloat, JSON,
      undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined
    );
    if (result == null) return '';
    if (typeof result === 'number' && isNaN(result)) return '#ERROR';
    return String(result);
  } catch {
    return '#ERROR';
  }
}

// ── Star rating ───────────────────────────────────────────────────────────────
function StarRating({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hover, setHover] = useState(0);
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(star => (
        <button key={star} type="button" onMouseEnter={() => setHover(star)} onMouseLeave={() => setHover(0)} onClick={() => onChange(star === value ? 0 : star)}>
          <Star className={`w-3.5 h-3.5 transition-colors ${star <= (hover || value) ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground/30'}`} />
        </button>
      ))}
    </div>
  );
}

// ── Progress bar ──────────────────────────────────────────────────────────────
// Interpolación roja(0%) → amarilla(50%) → verde(100%), mismos tonos que
// Tailwind red-500/yellow-500/green-500.
function progressColor(pct: number): string {
  const p = Math.max(0, Math.min(100, pct));
  const red = { r: 239, g: 68, b: 68 };
  const yellow = { r: 234, g: 179, b: 8 };
  const green = { r: 34, g: 197, b: 94 };
  const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);
  const [from, to, t] = p <= 50 ? [red, yellow, p / 50] : [yellow, green, (p - 50) / 50];
  return `rgb(${lerp(from.r, to.r, t)}, ${lerp(from.g, to.g, t)}, ${lerp(from.b, to.b, t)})`;
}

function ProgressBarCell({ value, onSave }: { value: CellVal | undefined; onSave: (v: CellVal) => void }) {
  const [editing, setEditing] = useState(false);
  const [tempVal, setTempVal] = useState('');
  const pct = Math.max(0, Math.min(100, value?.numberValue ?? 0));

  const commit = () => {
    const n = tempVal.trim() === '' ? undefined : Math.max(0, Math.min(100, Number(tempVal)));
    onSave({ numberValue: n != null && Number.isFinite(n) ? n : undefined });
    setEditing(false);
  };

  if (editing) {
    return (
      <Input
        autoFocus type="number" min={0} max={100} value={tempVal}
        onChange={e => setTempVal(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
        className="h-7 w-full min-w-0 text-xs"
      />
    );
  }

  return (
    <div
      className="h-full min-w-0 w-full flex items-center gap-1.5 px-1 cursor-text"
      onClick={() => { setTempVal(value?.numberValue != null ? String(value.numberValue) : ''); setEditing(true); }}
    >
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden min-w-[24px]">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: progressColor(pct) }} />
      </div>
      <span className="text-[11px] text-muted-foreground tabular-nums flex-shrink-0">
        {value?.numberValue != null ? `${pct}%` : ''}
      </span>
    </div>
  );
}

// ── Texto con color ───────────────────────────────────────────────────────────
// Botón-muestra circular que abre un popover con hasta 10 colores recientes
// (ya usados en esta misma columna en el tablero, mismo criterio que
// recentColors del tipo "Color") + un selector de color libre para
// cualquier tono nuevo — pintar cada celda a mano con el picker nativo del
// navegador no era práctico para hacerlo seguido.
function HexSwatchPicker({ label, hex, fallback, recentColors = [], onChange }: {
  label: string; hex?: string; fallback: string; recentColors?: string[]; onChange: (hex: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const current = hex || fallback;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={label}
          onClick={e => e.stopPropagation()}
          className="relative w-3.5 h-3.5 rounded-full border border-border/60 shadow-sm flex-shrink-0 hover:scale-110 transition-transform"
          style={{ backgroundColor: current }}
        />
      </PopoverTrigger>
      <PopoverContent className="p-0 w-48" align="start" onClick={e => e.stopPropagation()}>
        <div className="p-2 border-b border-border">
          <p className="text-xs font-medium text-muted-foreground px-1">{label}</p>
        </div>
        <div className="p-3 space-y-3">
          {recentColors.length > 0 && (
            <div>
              <p className="text-[10px] text-muted-foreground mb-1.5">Recientes</p>
              <div className="flex flex-wrap gap-1.5">
                {recentColors.map(c => (
                  <button
                    key={c} type="button" title={c}
                    onClick={() => { onChange(c); setOpen(false); }}
                    className={`w-5 h-5 rounded-full border transition-all hover:scale-110 ${current === c ? 'ring-2 ring-offset-1 ring-foreground scale-110' : 'border-border/50'}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
          )}
          <div>
            <input
              ref={inputRef}
              type="color"
              className="sr-only"
              value={current}
              onChange={e => onChange(e.target.value)}
            />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md border border-border/50 hover:bg-muted transition-colors text-left"
            >
              <div className="w-5 h-5 rounded-full border border-border/50 flex-shrink-0" style={{ backgroundColor: current }} />
              <span className="text-xs text-foreground">Elegir color personalizado</span>
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function TextoColorCell({ value, onSave, recentTextColors, recentBgColors }: {
  value: CellVal | undefined; onSave: (v: CellVal) => void;
  recentTextColors?: string[]; recentBgColors?: string[];
}) {
  const [editing, setEditing] = useState(false);
  const [tempVal, setTempVal] = useState('');
  const meta = parseTextoColorMeta(value?.fileUrl);

  const commitText = () => {
    onSave({ textValue: tempVal || undefined, fileUrl: value?.fileUrl });
    setEditing(false);
  };

  const setColor = (key: keyof TextoColorMeta, hex: string) => {
    const next: TextoColorMeta = { ...meta, [key]: hex };
    onSave({ textValue: value?.textValue, fileUrl: JSON.stringify(next) });
  };

  if (editing) {
    return (
      <Input
        autoFocus value={tempVal}
        onChange={e => setTempVal(e.target.value)}
        onBlur={commitText}
        onKeyDown={e => { if (e.key === 'Enter') commitText(); if (e.key === 'Escape') setEditing(false); }}
        className="h-7 w-full min-w-0 text-xs"
        style={{ color: meta?.textColor }}
      />
    );
  }

  return (
    <div
      className="h-full min-w-0 w-full flex items-center gap-1.5 px-1 cursor-text group/txtcolor"
      onClick={() => { setTempVal(value?.textValue ?? ''); setEditing(true); }}
    >
      <span className="flex-1 truncate text-xs" style={{ color: meta?.textColor }} title={value?.textValue}>
        {value?.textValue ?? ''}
      </span>
      <div
        className="flex items-center gap-1 opacity-0 group-hover/txtcolor:opacity-100 transition-opacity flex-shrink-0"
        onClick={e => e.stopPropagation()}
      >
        <HexSwatchPicker label="Color de texto" hex={meta?.textColor} fallback="#111827" recentColors={recentTextColors} onChange={hex => setColor('textColor', hex)} />
        <HexSwatchPicker label="Color de fondo" hex={meta?.bgColor} fallback="#ffffff" recentColors={recentBgColors} onChange={hex => setColor('bgColor', hex)} />
      </div>
    </div>
  );
}

// ── Color picker cell ─────────────────────────────────────────────────────────
function ColorPickerCell({ value, onSave, recentColors = [] }: {
  value: CellVal | undefined;
  onSave: (v: CellVal) => void;
  recentColors?: string[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [localHex, setLocalHex] = useState(value?.textValue ?? '');

  useEffect(() => { setLocalHex(value?.textValue ?? ''); }, [value?.textValue]);

  const debouncedSave = useDebouncedCallback((hex: string) => {
    onSave({ textValue: hex });
  }, 400);

  useEffect(() => () => debouncedSave.cancel(), [debouncedSave]);

  const applyColor = (hex: string) => {
    setLocalHex(hex);
    onSave({ textValue: hex });
    setOpen(false);
  };

  const clearColor = () => {
    setLocalHex('');
    onSave({ textValue: undefined });
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="flex items-center gap-2 cursor-pointer group/cp">
          {localHex ? (
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full border border-border/50 shadow-sm flex-shrink-0 group-hover/cp:scale-110 transition-transform" style={{ backgroundColor: localHex }} />
              <span className="text-xs font-mono text-foreground">{localHex.toUpperCase()}</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-muted-foreground/50 group-hover/cp:text-muted-foreground transition-colors">
              <div className="w-5 h-5 rounded-full border-2 border-dashed border-muted-foreground/30 flex-shrink-0" />
              <span className="text-xs">Elegir color</span>
            </div>
          )}
        </div>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-52" align="start" onClick={e => e.stopPropagation()}>
        <div className="p-2 border-b border-border">
          <p className="text-xs font-medium text-muted-foreground px-1">Color</p>
        </div>
        <div className="p-3 space-y-3">
          {recentColors.length > 0 && (
            <div>
              <p className="text-[10px] text-muted-foreground mb-1.5">Recientes</p>
              <div className="flex flex-wrap gap-1.5">
                {recentColors.map(hex => (
                  <button
                    key={hex}
                    title={hex}
                    onClick={() => applyColor(hex)}
                    className={`w-5 h-5 rounded-full border transition-all hover:scale-110 ${localHex === hex ? 'ring-2 ring-offset-1 ring-foreground scale-110' : 'border-border/50'}`}
                    style={{ backgroundColor: hex }}
                  />
                ))}
              </div>
            </div>
          )}
          <div>
            <input
              ref={inputRef}
              type="color"
              className="sr-only"
              value={localHex || '#6366f1'}
              onChange={e => { setLocalHex(e.target.value); debouncedSave(e.target.value); }}
            />
            <button
              onClick={() => inputRef.current?.click()}
              className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md border border-border/50 hover:bg-muted transition-colors text-left"
            >
              <div className="w-5 h-5 rounded-full border border-border/50 flex-shrink-0" style={{ backgroundColor: localHex || '#6366f1' }} />
              <span className="text-xs text-foreground">Elegir color personalizado</span>
            </button>
          </div>
        </div>
        {localHex && (
          <div className="px-3 pb-3">
            <button
              className="w-full text-xs text-muted-foreground hover:text-destructive text-center py-1 rounded hover:bg-muted/50 transition-colors"
              onClick={clearColor}
            >
              Quitar color
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ── Formula cell ──────────────────────────────────────────────────────────────
function FormulaCell({ col, rowId, dynCols }: { col: DynCol; rowId: string; dynCols: DynCols }) {
  const expression = parseFormulaConfig(col.optionsJson).expression;

  // Build a snapshot of all cell values for this row so useMemo can detect changes
  const cellSnapshot = dynCols.columns
    .map(c => { const v = dynCols.getCellVal(rowId, c.id); return `${c.id}:${v?.textValue ?? v?.numberValue ?? v?.dateValue ?? ''}`; })
    .join('|');

  // Memoize evaluation — recompute only when expression, row, or any referenced cell changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const result = useMemo(() => {
    if (!expression.trim()) return '';
    return evaluateFormula(expression, rowId, dynCols);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expression, rowId, cellSnapshot]);

  if (!expression.trim()) {
    return <span className="text-xs text-muted-foreground/30 italic px-1">Sin fórmula</span>;
  }
  const isError = result.startsWith('#');
  return (
    <div className="flex items-center gap-1 min-h-6 px-1 py-0.5">
      <Calculator className="w-2.5 h-2.5 text-muted-foreground/25 flex-shrink-0" />
      {isError
        ? <span className="text-xs text-destructive font-mono">{result}</span>
        : result
          ? <span className="text-xs text-foreground">{result}</span>
          : <span className="text-xs text-muted-foreground/25">—</span>
      }
    </div>
  );
}

// ── Button cell ───────────────────────────────────────────────────────────────
function ButtonCell({ col, rowId, dynCols }: { col: DynCol; rowId: string; dynCols?: DynCols }) {
  const [loading, setLoading] = useState(false);
  const config = parseButtonConfig(col.optionsJson);
  const label = config.label || col.columnName || 'Ejecutar';
  const variant = (config.variant ?? 'default') as 'default' | 'destructive' | 'outline' | 'secondary';
  const handleClick = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const result = await executeButtonAction({ columnId: col.id, rowId, boardId: col.boardId ?? '' });
      if (result.success) toast.success(result.message); else toast.error(result.message);
      // Varias acciones (duplicar fila, crear sala de observación) escriben
      // en otras columnas/filas que este mismo click no refleja solo — sin
      // esto, el resultado no aparece hasta recargar la página a mano.
      // softReload (no reload) para no meter skeletons/flicker por un click.
      dynCols?.softReload?.();
    } catch { toast.error('Error al ejecutar la acción.'); } finally { setLoading(false); }
  };
  return (
    <Button variant={variant} size="sm" disabled={loading} onClick={handleClick} className="h-7 text-xs px-3 gap-1.5 whitespace-nowrap">
      {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
      {label}
    </Button>
  );
}

// ── Status cell ───────────────────────────────────────────────────────────────
function StatusCell({ col, value, onSave }: { col: DynCol; value: CellVal | undefined; onSave: (v: CellVal) => void }) {
  const options = parseColoredOptions(col.optionsJson);
  const current = options.find(o => o.label === value?.textValue);
  const colorDef = current ? getColor(current.color) : null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-1 rounded-full px-1 py-0.5 text-xs font-medium focus:outline-none hover:opacity-90 active:scale-95 transition-all">
          {colorDef ? (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${colorDef.bg} ${colorDef.text}`}>
              {current?.label}<ChevronDown className="w-2.5 h-2.5 opacity-70" />
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-muted/60 text-muted-foreground border border-dashed border-muted-foreground/30">
              Sin status<ChevronDown className="w-2.5 h-2.5 opacity-60" />
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44 p-1.5">
        {options.map(opt => {
          const c = getColor(opt.color);
          return (
            <DropdownMenuItem key={opt.label} onClick={() => onSave({ textValue: opt.label })} className="p-0 mb-1 last:mb-0 rounded-full overflow-hidden focus:bg-transparent">
              <span className={`w-full text-center px-3 py-1 rounded-full text-xs font-semibold cursor-pointer ${c.bg} ${c.text} hover:opacity-90 transition-opacity`}>{opt.label}</span>
            </DropdownMenuItem>
          );
        })}
        {value?.textValue && (
          <><div className="my-1 border-t border-border/50" />
            <DropdownMenuItem onClick={() => onSave({ textValue: undefined })} className="text-xs text-muted-foreground rounded-md">
              <X className="w-3 h-3 mr-1.5" /> Limpiar
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Select cell ───────────────────────────────────────────────────────────────
// Dropdown simple, sin color — a diferencia de Status, que sí codifica cada
// opción con un color. Antes ambos tipos eran literalmente el mismo mecanismo
// (mismo dropdown de pastillas de color); se separan para que Select sirva
// para elegir un valor de una lista fija sin necesidad de codificar por color.
// parseColoredOptions() sigue leyendo el mismo formato de optionsJson (por
// compatibilidad con columnas Select ya existentes que sí tenían color
// guardado) — solo se ignora el campo `color` al mostrarlo.
function SelectCell({ col, value, onSave }: { col: DynCol; value: CellVal | undefined; onSave: (v: CellVal) => void }) {
  const options = parseColoredOptions(col.optionsJson);
  const NONE = '__none__';
  return (
    <Select
      value={value?.textValue ?? NONE}
      onValueChange={v => onSave({ textValue: v === NONE ? undefined : v })}
    >
      <SelectTrigger className="h-7 w-full min-w-0 border-none shadow-none px-1.5 text-xs hover:bg-muted/70 focus:ring-0 data-[placeholder]:text-muted-foreground">
        <SelectValue placeholder="—" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE} className="text-xs text-muted-foreground">— (vacío)</SelectItem>
        {options.map(opt => (
          <SelectItem key={opt.label} value={opt.label} className="text-xs">{opt.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ── Colored options form (Status & Select) ────────────────────────────────────
function ColoredOptionsForm({ options, onChange, title = 'Opciones', showColor = true }: {
  options: ColoredOption[]; onChange: (opts: ColoredOption[]) => void; title?: string; showColor?: boolean;
}) {
  const [newLabel, setNewLabel] = useState('');
  const [newColor, setNewColor] = useState('blue');
  const add = () => {
    const label = newLabel.trim();
    if (!label) return;
    onChange([...options, { label, color: showColor ? newColor : 'gray' }]);
    setNewLabel('');
  };
  const remove = (i: number) => onChange(options.filter((_, idx) => idx !== i));
  const updateColor = (i: number, color: string) => onChange(options.map((o, idx) => idx === i ? { ...o, color } : o));

  return (
    <div className="space-y-3 rounded-lg border border-border/50 bg-muted/20 p-3">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{title}</p>
      <div className="space-y-1.5">
        {options.map((opt, i) => {
          const c = getColor(opt.color);
          return (
            <div key={i} className="flex items-center gap-2">
              <span className={showColor
                ? `flex-1 px-2.5 py-1 rounded-md text-xs font-semibold ${c.bg} ${c.text}`
                : 'flex-1 px-2.5 py-1 rounded-md text-xs font-medium bg-muted text-foreground'}>{opt.label}</span>
              {showColor && (
                <div className="flex gap-0.5">
                  {STATUS_COLORS.slice(0, 6).map(sc => (
                    <button key={sc.value} type="button" title={sc.label} onClick={() => updateColor(i, sc.value)}
                      className={`w-4 h-4 rounded-full ${sc.bg} transition-all ${opt.color === sc.value ? 'ring-2 ring-offset-1 ring-foreground scale-110' : 'opacity-60 hover:opacity-100'}`} />
                  ))}
                </div>
              )}
              <button type="button" onClick={() => remove(i)} className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
        {options.length === 0 && <p className="text-xs text-muted-foreground text-center py-2">Agrega al menos una opción</p>}
      </div>
      <div className="flex gap-2 items-end pt-1 border-t border-border/30">
        <div className="flex-1 space-y-1">
          <Label className="text-[10px] text-muted-foreground">Etiqueta</Label>
          <Input placeholder="Ej: En progreso..." value={newLabel} onChange={e => setNewLabel(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} className="h-7 text-xs" />
        </div>
        {showColor && (
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Color</Label>
            <div className="flex gap-1 flex-wrap max-w-[150px]">
              {STATUS_COLORS.map(c => (
                <button key={c.value} type="button" title={c.label} onClick={() => setNewColor(c.value)}
                  className={`w-5 h-5 rounded-full ${c.bg} transition-all ${newColor === c.value ? 'ring-2 ring-offset-1 ring-foreground scale-110' : 'opacity-60 hover:opacity-100'}`} />
              ))}
            </div>
          </div>
        )}
        <Button type="button" size="sm" onClick={add} disabled={!newLabel.trim()} className="h-7 text-xs px-3 flex-shrink-0">
          <Plus className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );
}

// ── Formula config form ───────────────────────────────────────────────────────
function FormulaConfigForm({ value, onChange }: { value: FormulaConfig; onChange: (v: FormulaConfig) => void }) {
  const [showHelp, setShowHelp] = useState(false);
  const set = (patch: Partial<FormulaConfig>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-3 rounded-lg border border-border/50 bg-muted/30 p-3">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Configuración de fórmula</p>
      <div className="space-y-1.5">
        <Label className="text-xs">Expresión</Label>
        <Textarea
          value={value.expression}
          onChange={e => set({ expression: e.target.value })}
          placeholder="{Precio} * {Cantidad}"
          rows={3}
          className="text-xs font-mono resize-none"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Tipo de resultado</Label>
        <Select value={value.resultType} onValueChange={v => set({ resultType: v as FormulaConfig['resultType'] })}>
          <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="number">Número</SelectItem>
            <SelectItem value="text">Texto</SelectItem>
            <SelectItem value="date">Fecha</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <button type="button" onClick={() => setShowHelp(h => !h)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
        {showHelp ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        Referencia de funciones
      </button>
      {showHelp && (
        <div className="rounded-md bg-background border border-border/40 p-2.5 text-[10px] space-y-1 leading-relaxed">
          <p className="font-semibold text-foreground text-xs mb-1.5">Sintaxis disponible</p>
          <p className="text-muted-foreground"><span className="font-mono text-foreground">{'{Columna}'}</span> — referencia a columna</p>
          <p className="text-muted-foreground"><span className="font-mono text-foreground">+ - * / ( )</span> — operadores</p>
          <div className="border-t border-border/30 my-1.5" />
          <p className="text-muted-foreground"><span className="font-mono text-foreground">DAYS_BETWEEN({'{Inicio}'}, {'{Fin}'})</span> → días</p>
          <p className="text-muted-foreground"><span className="font-mono text-foreground">CONCAT({'{A}'}, " - ", {'{B}'})</span> → unir texto</p>
          <p className="text-muted-foreground"><span className="font-mono text-foreground">{'IF({col} > 0, "Sí", "No")'}</span> → condicional</p>
          <p className="text-muted-foreground"><span className="font-mono text-foreground">{'ROUND({col}, 2)'}</span> → redondear</p>
          <p className="text-muted-foreground"><span className="font-mono text-foreground">TODAY()</span> → fecha de hoy</p>
          <p className="text-muted-foreground"><span className="font-mono text-foreground">{'UPPER({col}) / LOWER({col})'}</span> → mayúsculas</p>
          <p className="text-muted-foreground"><span className="font-mono text-foreground">{'ABS / MIN / MAX'}</span> → matemáticas</p>
        </div>
      )}
    </div>
  );
}

// ── Date picker cell ──────────────────────────────────────────────────────────
function DatePickerCell({ col, value, onSave, rowId, dynCols }: {
  col: DynCol; value: CellVal | undefined; onSave: (v: CellVal) => void;
  rowId: string; dynCols?: DynCols;
}) {
  const [open, setOpen] = useState(false);

  const colNameLower = (col.columnName ?? '').toLowerCase().trim();

  const parseDate = useCallback((v?: string): Date | undefined => {
    if (!v) return undefined;
    const s = v.split('T')[0];
    const parts = s.split('-').map(Number);
    if (parts.length < 3 || isNaN(parts[0])) return undefined;
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }, []);

  const selected = parseDate(value?.dateValue);

  // All Fecha columns for this board, sorted by columnOrder
  const boardFechaCols = useMemo(() => {
    if (!dynCols) return [];
    return dynCols.columns
      .filter(c => c.columnType === 'Fecha' && c.boardId === col.boardId)
      .sort((a, b) => (a.columnOrder ?? 0) - (b.columnOrder ?? 0));
  }, [dynCols, col.boardId]);

  // Detect end column: name-based first, then positional fallback (2nd Fecha col = end)
  const isStartByName = ['inicio', 'start', 'fecha inicio', 'start date', 'fecha_inicio'].includes(colNameLower);
  const isEndByName   = ['fin', 'end', 'fecha fin', 'end date', 'fecha_fin'].includes(colNameLower);
  const isEndByPos    = boardFechaCols.length >= 2 && boardFechaCols[1]?.id === col.id;
  const isEndCol      = isEndByName || (!isStartByName && isEndByPos);

  const rangeFrom = useMemo((): Date | undefined => {
    if (!isEndCol || !dynCols) return undefined;
    // Name-based start column first
    let startCol = dynCols.columns.find(c =>
      c.boardId === col.boardId &&
      ['inicio', 'start', 'fecha inicio', 'start date', 'fecha_inicio'].includes((c.columnName ?? '').toLowerCase().trim())
    );
    // Positional fallback: first Fecha col in this board
    if (!startCol && boardFechaCols.length >= 2) startCol = boardFechaCols[0];
    if (!startCol) return undefined;
    return parseDate(dynCols.getCellVal(rowId, startCol.id)?.dateValue);
  }, [isEndCol, dynCols, rowId, parseDate, boardFechaCols, col.boardId]);

  const toStr = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T00:00:00`;

  const handleSelect = (d: Date | undefined) => {
    onSave({ dateValue: d ? toStr(d) : undefined });
    setOpen(false);
  };

  const display = selected ? fmtDate(selected) : '';

  // Range modifiers for the end-date calendar
  const modifiers = useMemo(() => {
    if (!rangeFrom || !selected || rangeFrom >= selected) return undefined;
    return {
      range_start: rangeFrom,
      range_middle: (d: Date) => d > rangeFrom && d < selected,
      range_end: selected,
    } as Record<string, Date | ((d: Date) => boolean)>;
  }, [rangeFrom, selected]);

  const modifiersStyles = useMemo(() => ({
    range_start: { backgroundColor: 'hsl(var(--primary)/0.18)', borderRadius: '100% 0 0 100%' },
    range_middle: { backgroundColor: 'hsl(var(--primary)/0.10)', borderRadius: '0' },
    range_end: { backgroundColor: 'hsl(var(--primary)/0.18)', borderRadius: '0 100% 100% 0' },
  }), []);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="h-full min-w-0 cursor-pointer text-xs rounded px-1 hover:bg-muted/70 transition-colors flex items-center gap-1.5 overflow-hidden">
          <CalendarIcon className="w-3 h-3 text-muted-foreground/40 flex-shrink-0" />
          {display
            ? <span className="truncate text-foreground" title={display}>{display}</span>
            : <span className="text-muted-foreground/25 select-none">—</span>}
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start" onClick={e => e.stopPropagation()}>
        <CalendarUI
          mode="single"
          selected={selected}
          onSelect={handleSelect}
          disabled={rangeFrom ? { before: rangeFrom } : undefined}
          modifiers={modifiers}
          modifiersStyles={modifiersStyles}
          defaultMonth={selected ?? rangeFrom}
          initialFocus
        />
        {selected && (
          <div className="p-2 border-t border-border/30">
            <button
              className="w-full text-xs text-muted-foreground hover:text-destructive text-center py-1 rounded hover:bg-muted/50 transition-colors"
              onClick={() => { onSave({ dateValue: undefined }); setOpen(false); }}
            >
              Limpiar fecha
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ── Datetime display helper ───────────────────────────────────────────────────
function fmtDatetime(isoStr: string): string {
  const d = new Date(isoStr);
  const day = d.getDate();
  const mon = d.toLocaleDateString('es', { month: 'short' }).replace('.', '');
  const year = String(d.getFullYear()).slice(-2);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${day} ${mon} ${year}', ${hh}:${mm}`;
}

// ── Datetime picker cell ──────────────────────────────────────────────────────
function DatetimePickerCell({ col: _col, value, onSave }: {
  col: DynCol; value: CellVal | undefined; onSave: (v: CellVal) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draftDate, setDraftDate] = useState<Date | undefined>(undefined);
  const [draftHour, setDraftHour] = useState(0);
  const [draftMinute, setDraftMinute] = useState(0);

  const parseInit = useCallback(() => {
    if (value?.dateValue) {
      const d = new Date(value.dateValue);
      setDraftDate(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
      setDraftHour(d.getHours());
      // Round to nearest 5 min
      setDraftMinute(Math.round(d.getMinutes() / 5) * 5 % 60);
    } else {
      const now = new Date();
      setDraftDate(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
      setDraftHour(now.getHours());
      setDraftMinute(Math.round(now.getMinutes() / 5) * 5 % 60);
    }
  }, [value?.dateValue]);

  const handleOpenChange = (o: boolean) => {
    if (o) parseInit();
    setOpen(o);
  };

  const handleSave = () => {
    if (!draftDate) { onSave({ dateValue: undefined }); setOpen(false); return; }
    const d = new Date(draftDate);
    d.setHours(draftHour, draftMinute, 0, 0);
    onSave({ dateValue: d.toISOString() });
    setOpen(false);
  };

  const handleClear = () => {
    onSave({ dateValue: undefined });
    setOpen(false);
  };

  const HOURS = Array.from({ length: 24 }, (_, i) => i);
  const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

  const display = value?.dateValue ? fmtDatetime(value.dateValue) : '';

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <div className="h-full min-w-0 cursor-pointer text-xs rounded px-1 hover:bg-muted/70 transition-colors flex items-center gap-1.5 overflow-hidden">
          <Clock className="w-3 h-3 text-muted-foreground/40 flex-shrink-0" />
          {display
            ? <span className="truncate text-foreground" title={display}>{display}</span>
            : <span className="text-muted-foreground/25 select-none">—</span>}
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start" onClick={e => e.stopPropagation()}>
        {/* Calendar */}
        <CalendarUI
          mode="single"
          selected={draftDate}
          onSelect={d => setDraftDate(d)}
          initialFocus
          className="border-b border-border/30"
        />
        {/* Time selectors */}
        <div className="flex gap-0 border-b border-border/30">
          {/* Hours */}
          <div className="flex-1 border-r border-border/30">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide px-2 pt-2 pb-1">Hora</p>
            <div className="grid grid-cols-4 gap-0.5 px-2 pb-2 max-h-[100px] overflow-y-auto">
              {HOURS.map(h => (
                <button
                  key={h}
                  type="button"
                  onClick={() => setDraftHour(h)}
                  className={`text-[11px] font-mono py-0.5 rounded transition-colors ${
                    draftHour === h
                      ? 'bg-primary text-primary-foreground font-semibold'
                      : 'hover:bg-muted text-foreground'
                  }`}
                >
                  {String(h).padStart(2, '0')}
                </button>
              ))}
            </div>
          </div>
          {/* Minutes */}
          <div className="flex-1">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide px-2 pt-2 pb-1">Min</p>
            <div className="grid grid-cols-3 gap-0.5 px-2 pb-2">
              {MINUTES.map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setDraftMinute(m)}
                  className={`text-[11px] font-mono py-0.5 rounded transition-colors ${
                    draftMinute === m
                      ? 'bg-primary text-primary-foreground font-semibold'
                      : 'hover:bg-muted text-foreground'
                  }`}
                >
                  {String(m).padStart(2, '0')}
                </button>
              ))}
            </div>
          </div>
        </div>
        {/* Preview + Actions */}
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <span className="text-xs text-muted-foreground font-mono">
            {draftDate ? fmtDatetime((() => { const d = new Date(draftDate); d.setHours(draftHour, draftMinute, 0, 0); return d.toISOString(); })()) : '—'}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleClear}>Borrar</Button>
            <Button size="sm" className="h-7 text-xs" onClick={handleSave}>Guardar</Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── Persona cell ──────────────────────────────────────────────────────────────
function PersonaCell({ value, onSave }: { value: CellVal | undefined; onSave: (v: CellVal) => void }) {
  const members = useContext(TeamMembersContext);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const current = value?.textValue ?? ''; // now stores user ID

  const getName = (m: TeamMember) =>
    [m.firstName, m.lastName].filter(Boolean).join(' ') || m.email || '';

  // Resolve stored ID → display name (backwards-compatible: if not a UUID, treat as name directly)
  const currentMember = members.find(m => m.id === current);
  const currentName = currentMember ? getName(currentMember) : current;

  const filtered = members.filter(m =>
    getName(m).toLowerCase().includes(search.toLowerCase()) ||
    (m.email ?? '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Popover open={open} onOpenChange={o => { setOpen(o); if (!o) setSearch(''); }}>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1.5 text-xs rounded px-1 py-0.5 hover:bg-muted/70 transition-colors min-w-0 h-full overflow-hidden">
          {current ? (
            <>
              <div className="w-5 h-5 rounded-full bg-primary/20 text-primary flex items-center justify-center flex-shrink-0 text-[10px] font-bold">
                {currentName[0]?.toUpperCase()}
              </div>
              <span className="truncate text-foreground" title={currentName}>{currentName}</span>
            </>
          ) : (
            <span className="text-muted-foreground/25 select-none">—</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-52" align="start" onClick={e => e.stopPropagation()}>
        <div className="p-2 border-b border-border">
          <Input
            autoFocus
            placeholder="Buscar persona..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-7 text-xs"
          />
        </div>
        <div className="max-h-48 overflow-y-auto p-1">
          {filtered.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-3">Sin resultados</p>
          )}
          {filtered.map(m => {
            const name = getName(m);
            const isSelected = current === m.id;
            return (
              <button
                key={m.id}
                onClick={() => { onSave({ textValue: isSelected ? undefined : m.id }); setOpen(false); setSearch(''); }}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors text-left ${isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}`}
              >
                <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold ${isSelected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                  {name[0]?.toUpperCase() ?? '?'}
                </div>
                <div className="min-w-0">
                  <div className="truncate font-medium">{name}</div>
                  {m.email && <div className="truncate text-muted-foreground text-[10px]">{m.email}</div>}
                </div>
              </button>
            );
          })}
        </div>
        {current && (
          <div className="p-1 border-t border-border/30">
            <button onClick={() => { onSave({ textValue: undefined }); setOpen(false); }}
              className="w-full text-xs text-muted-foreground hover:text-destructive text-center py-1 rounded hover:bg-muted/50 transition-colors">
              Quitar persona
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// Module-level session cache for Maps Embed URLs (persists across component mounts)
const mapsEmbedCache = new Map<string, { embedUrl: string; mode: string }>();

// ── Maps dialog ───────────────────────────────────────────────────────────────
function MapsDialog({ address, mapsUrl }: { address: string; mapsUrl: string }) {
  const [open, setOpen] = useState(false);
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !address) return;

    const cached = mapsEmbedCache.get(address);
    if (cached) {
      setEmbedUrl(cached.embedUrl);
      return;
    }

    setLoading(true);
    setEmbedUrl(null);
    getStreetViewUrl({ address })
      .then(result => {
        mapsEmbedCache.set(address, result);
        setEmbedUrl(result.embedUrl);
      })
      .catch(() => {
        setEmbedUrl(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [open, address]);

  return (
    <>
      <button
        type="button"
        title="Ver en Google Maps"
        onClick={e => { e.stopPropagation(); setOpen(true); }}
        className="flex-shrink-0 ml-1 opacity-0 group-hover/cell:opacity-100 transition-opacity text-muted-foreground hover:text-primary p-0.5 rounded"
      >
        <MapPin className="w-3 h-3" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-w-[900px] w-[95vw] max-h-[90vh] p-0 overflow-hidden gap-0"
          aria-describedby={undefined}
          onClick={e => e.stopPropagation()}
        >
          <DialogHeader className="flex flex-row items-center justify-between px-4 py-2.5 border-b border-border/50 flex-shrink-0 gap-3 space-y-0">
            <DialogTitle className="text-sm font-medium truncate flex-1 min-w-0">
              <span className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                {address}
              </span>
            </DialogTitle>
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="flex items-center gap-1.5 text-xs text-primary hover:underline whitespace-nowrap flex-shrink-0"
            >
              Abrir en Maps
              <ExternalLink className="w-3 h-3" />
            </a>
          </DialogHeader>

          {loading && (
            <Skeleton className="w-full h-[70vh] max-h-[600px] min-h-[420px] rounded-none" />
          )}

          {!loading && embedUrl && (
            <div className="w-full h-[70vh] max-h-[600px] min-h-[420px]">
              <iframe
                src={embedUrl}
                className="w-full h-full border-0"
                loading="lazy"
                allowFullScreen
              />
            </div>
          )}

          {!loading && !embedUrl && (
            <div className="w-full h-[70vh] max-h-[600px] min-h-[420px] flex items-center justify-center bg-muted/30 text-sm text-muted-foreground">
              No se pudo cargar el mapa
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── File type helpers ─────────────────────────────────────────────────────────
function getFileType(url: string): 'image' | 'video' | 'pdf' | 'other' {
  const path = url.split('?')[0].split('#')[0].toLowerCase();
  const ext = path.split('.').pop() ?? '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return 'image';
  if (['mp4', 'mov', 'webm', 'ogg'].includes(ext)) return 'video';
  if (ext === 'pdf') return 'pdf';
  return 'other';
}

function getFileLabel(url: string): string {
  const t = getFileType(url);
  if (t === 'image') return '🖼 Ver imagen';
  if (t === 'video') return '🎬 Ver video';
  if (t === 'pdf')   return '📄 Ver PDF';
  return '🔗 Ver archivo';
}

// ── File preview dialog ───────────────────────────────────────────────────────
function FilePreviewDialog({ open, onOpenChange, url, fileName }: {
  open: boolean; onOpenChange: (o: boolean) => void; url: string; fileName?: string;
}) {
  const fileType = getFileType(url);
  const title = fileName || url.split('/').pop()?.split('?')[0] || 'Archivo';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-4xl w-[95vw] p-0 overflow-hidden gap-0"
        aria-describedby={undefined}
        onClick={e => e.stopPropagation()}
      >
        <DialogHeader className="flex flex-row items-center justify-between px-4 py-2.5 border-b border-border/50 flex-shrink-0 gap-3 space-y-0">
          <DialogTitle className="text-sm font-medium truncate flex-1 min-w-0">{title}</DialogTitle>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="flex items-center gap-1.5 text-xs text-primary hover:underline whitespace-nowrap flex-shrink-0"
          >
            Abrir en nueva pestaña
            <ExternalLink className="w-3 h-3" />
          </a>
        </DialogHeader>
        <div className="flex items-center justify-center bg-muted/20 overflow-auto p-4" style={{ minHeight: 300, maxHeight: '80vh' }}>
          {fileType === 'image' && (
            <img
              src={url}
              alt={title}
              className="max-w-full object-contain rounded-md shadow-sm"
              style={{ maxHeight: '75vh' }}
            />
          )}
          {fileType === 'video' && (
            <video
              src={url}
              controls
              autoPlay
              loop
              className="max-w-full rounded-md shadow-sm"
              style={{ maxHeight: '75vh' }}
            />
          )}
          {fileType === 'pdf' && (
            <iframe
              src={url}
              className="w-full border-0 rounded-md"
              style={{ height: '75vh', minWidth: 0 }}
              title={title}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Generic cell editor ───────────────────────────────────────────────────────
function CellEditor({ col, value, onSave, rowId, dynCols, recentColors, recentTextColors, recentBgColors, suggestions }: {
  col: DynCol; value: CellVal | undefined; onSave: (v: CellVal) => void;
  rowId: string; dynCols?: DynCols; recentColors?: string[]; recentTextColors?: string[]; recentBgColors?: string[]; suggestions?: string[];
}) {
  const [editing, setEditing] = useState(false);
  const [tempVal, setTempVal] = useState('');
  const [suggActiveIdx, setSuggActiveIdx] = useState(-1);
  const [previewOpen, setPreviewOpen] = useState(false);
  const type = col.columnType ?? 'Texto';
  const dateInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && type === 'Fecha') {
      setTimeout(() => { dateInputRef.current?.showPicker?.(); }, 50);
    }
  }, [editing, type]);

  if (type === 'Botón')    return <ButtonCell col={col} rowId={rowId} dynCols={dynCols} />;
  if (type === 'Checkbox') return <Checkbox checked={value?.booleanValue ?? false} onCheckedChange={v => onSave({ booleanValue: !!v })} />;
  if (type === 'Rating')   return <StarRating value={value?.numberValue ?? 0} onChange={n => onSave({ numberValue: n })} />;
  if (type === 'Barra')    return <ProgressBarCell value={value} onSave={onSave} />;
  if (type === 'TextoColor') return <TextoColorCell value={value} onSave={onSave} recentTextColors={recentTextColors} recentBgColors={recentBgColors} />;
  if (type === 'Status')   return <StatusCell col={col} value={value} onSave={onSave} />;
  if (type === 'Fecha')    return <DatePickerCell col={col} value={value} onSave={onSave} rowId={rowId} dynCols={dynCols} />;
  if (type === 'Datetime') return <DatetimePickerCell col={col} value={value} onSave={onSave} />;
  if (type === 'Select')   return <SelectCell col={col} value={value} onSave={onSave} />;
  if (type === 'Color')    return <ColorPickerCell value={value} onSave={onSave} recentColors={recentColors} />;
  if (type === 'Fórmula' && dynCols) return <FormulaCell col={col} rowId={rowId} dynCols={dynCols} />;
  if (type === 'Persona') return <PersonaCell value={value} onSave={onSave} />;

  const getDisplayValue = () => {
    switch (type) {
      case 'Número':   return value?.numberValue != null ? value.numberValue.toLocaleString() : '';
      case 'Fecha':    return value?.dateValue ? fmtDate(new Date(value.dateValue.split('T')[0] + 'T00:00:00')) : '';
      case 'Datetime': return value?.dateValue ? fmtDatetime(value.dateValue) : '';
      case 'Archivo':  return (value?.fileUrl || value?.textValue) ? '🔗 Ver archivo' : '';
      default:         return formatAddressText(value?.textValue);
    }
  };
  const getInputType = () => {
    switch (type) {
      case 'Número':   return 'number';
      case 'Fecha':    return 'date';
      case 'Datetime': return 'datetime-local';
      case 'Email':    return 'email';
      case 'Teléfono': return 'tel';
      default:         return 'text';
    }
  };
  const getEditValue = () => {
    switch (type) {
      case 'Número':   return value?.numberValue?.toString() ?? '';
      case 'Fecha':    return value?.dateValue ? value.dateValue.split('T')[0] : '';
      case 'Datetime': return value?.dateValue ? value.dateValue.replace('Z', '').substring(0, 16) : '';
      case 'Archivo':
      case 'Link':     return value?.fileUrl ?? value?.textValue ?? '';
      default:         return formatAddressText(value?.textValue) || '';
    }
  };
  const commit = () => {
    const v: CellVal = {};
    switch (type) {
      case 'Número':   v.numberValue = tempVal ? Number(tempVal) : undefined; break;
      case 'Fecha':    v.dateValue = tempVal ? tempVal + 'T00:00:00' : undefined; break;
      case 'Datetime': v.dateValue = tempVal ? new Date(tempVal).toISOString() : undefined; break;
      case 'Archivo':
      case 'Link':     v.fileUrl = tempVal || undefined; break;
      default:         v.textValue = tempVal || undefined;
    }
    onSave(v);
    setEditing(false);
  };

  const filteredSuggs = (editing && suggestions && tempVal.trim().length > 0)
    ? suggestions.filter(s => s && s !== tempVal && s.toLowerCase().includes(tempVal.toLowerCase())).slice(0, 8)
    : [];

  if (editing) {
    const pos = dateInputRef.current ? (() => {
      const r = dateInputRef.current!.getBoundingClientRect();
      return { top: r.bottom + 2, left: r.left, width: Math.max(r.width, 180) };
    })() : null;
    return (
      <>
        <Input autoFocus ref={dateInputRef} type={getInputType()} value={tempVal}
          onChange={e => { setTempVal(e.target.value); setSuggActiveIdx(-1); }}
          onBlur={commit}
          onKeyDown={e => {
            if (filteredSuggs.length > 0) {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSuggActiveIdx(i => Math.min(i + 1, filteredSuggs.length - 1)); return; }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSuggActiveIdx(i => Math.max(i - 1, -1)); return; }
              if (e.key === 'Enter' && suggActiveIdx >= 0) {
                e.preventDefault();
                const s = filteredSuggs[suggActiveIdx];
                onSave({ textValue: s || undefined });
                setEditing(false);
                return;
              }
            }
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setEditing(false);
          }}
          className="h-7 w-full min-w-0 text-xs"
        />
        {filteredSuggs.length > 0 && pos && createPortal(
          <div
            style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 9999 }}
            className="bg-popover border border-border shadow-lg rounded-md overflow-hidden"
          >
            <div className="max-h-[200px] overflow-y-auto py-0.5">
              {filteredSuggs.map((s, i) => (
                <button key={s} type="button"
                  onMouseDown={e => { e.preventDefault(); onSave({ textValue: s || undefined }); setEditing(false); }}
                  className={`w-full text-left px-2.5 py-1.5 text-xs truncate transition-colors block ${
                    i === suggActiveIdx ? 'bg-accent text-accent-foreground' : 'hover:bg-muted text-foreground'
                  }`}
                >{s}</button>
              ))}
            </div>
          </div>,
          document.body
        )}
      </>
    );
  }
  const display = getDisplayValue();

  // Detect if raw value is a Fillout address JSON, OR the column is named "Dirección" (plain text)
  const rawText = value?.textValue;
  const colNameNorm = (col.columnName ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const isAddressCol = colNameNorm.includes('direccion');
  const isAddressJson =
    typeof rawText === 'string' &&
    rawText.trimStart().startsWith('{') &&
    formatAddressText(rawText) !== rawText;
  const addressText = isAddressJson
    ? formatAddressText(rawText!)
    : rawText ?? '';
  const showMapsPin =
    isAddressJson ||
    (isAddressCol && typeof rawText === 'string' && rawText.trim().length > 0);
  const mapsUrl = showMapsPin
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressText)}`
    : null;

  if (type === 'Archivo') {
    const url = value?.fileUrl ?? value?.textValue ?? '';
    if (url) {
      const fType = getFileType(url);
      const canPreview = fType !== 'other';
      const label = getFileLabel(url);
      return (
        <div className="h-full min-w-0 flex items-center gap-1 px-1 overflow-hidden group/archivo">
          {canPreview ? (
            <button
              onClick={e => { e.stopPropagation(); setPreviewOpen(true); }}
              className="text-primary hover:underline truncate text-xs text-left"
            >
              {label}
            </button>
          ) : (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="text-primary hover:underline truncate text-xs"
            >
              {label}
            </a>
          )}
          <button
            onClick={() => { setTempVal(url); setEditing(true); }}
            className="flex-shrink-0 opacity-0 group-hover/archivo:opacity-100 transition-opacity text-muted-foreground hover:text-foreground p-0.5 rounded"
            title="Editar URL"
          >
            <Pencil className="w-3 h-3" />
          </button>
          {canPreview && (
            <FilePreviewDialog
              open={previewOpen}
              onOpenChange={setPreviewOpen}
              url={url}
            />
          )}
        </div>
      );
    }
  }

  if (type === 'Link') {
    const url = value?.fileUrl ?? value?.textValue ?? '';
    return (
      <div className="h-full min-w-0 flex items-center gap-1 px-1 overflow-hidden group/link">
        {url ? (
          <>
            <a href={url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
              className="text-primary hover:underline truncate text-xs flex-1 min-w-0" title={url}>
              {url}
            </a>
            <button
              onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(url); toast.success('Link copiado'); }}
              className="flex-shrink-0 text-muted-foreground hover:text-foreground p-0.5 rounded"
              title="Copiar link"
            >
              <Copy className="w-3 h-3" />
            </button>
          </>
        ) : (
          <span className="text-muted-foreground/25 select-none flex-1 text-xs">—</span>
        )}
        <button
          onClick={() => { setTempVal(url); setEditing(true); }}
          className="flex-shrink-0 opacity-0 group-hover/link:opacity-100 transition-opacity text-muted-foreground hover:text-foreground p-0.5 rounded"
          title="Editar link"
        >
          <Pencil className="w-3 h-3" />
        </button>
      </div>
    );
  }

  return (
    <div className="h-full min-w-0 cursor-text text-xs rounded px-1 hover:bg-muted/70 transition-colors flex items-center overflow-hidden group/cell"
      onClick={() => { setTempVal(getEditValue()); setEditing(true); }}>
      {display
        ? <span className="truncate min-w-0 flex-1" title={display}>{display}</span>
        : <span className="text-muted-foreground/25 select-none flex-1">—</span>}
      {mapsUrl && (
        <MapsDialog address={addressText} mapsUrl={mapsUrl} />
      )}
    </div>
  );
}

// ── Button config form ────────────────────────────────────────────────────────
function ButtonConfigForm({ value, onChange }: { value: ButtonConfig; onChange: (v: ButtonConfig) => void }) {
  const set = (patch: Partial<ButtonConfig>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-3 rounded-lg border border-border/50 bg-muted/30 p-3">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Configuración del botón</p>
      <div className="space-y-1.5">
        <Label className="text-xs">Texto del botón</Label>
        <Input placeholder="Ej: Enviar NDA, Confirmar..." value={value.label} onChange={e => set({ label: e.target.value })} className="h-8 text-sm" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Acción al hacer clic</Label>
        <Select value={value.action} onValueChange={v => set({ action: v })}>
          <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Selecciona una acción..." /></SelectTrigger>
          <SelectContent>{BUTTON_ACTIONS.map(a => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Color del botón</Label>
        <Select value={value.variant} onValueChange={v => set({ variant: v })}>
          <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>{BUTTON_VARIANTS.map(v => <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      {value.action === 'change_status' && (
        <div className="space-y-1.5">
          <Label className="text-xs">Nuevo status</Label>
          <Input placeholder="Ej: Confirmado, Completado..." value={value.newStatus ?? ''} onChange={e => set({ newStatus: e.target.value })} className="h-8 text-sm" />
        </div>
      )}
      {value.action === 'webhook' && (
        <div className="space-y-1.5">
          <Label className="text-xs">URL del Webhook</Label>
          <Input placeholder="https://n8n.example.com/webhook/..." value={value.webhookUrl ?? ''} onChange={e => set({ webhookUrl: e.target.value })} className="h-8 text-sm font-mono" />
        </div>
      )}
    </div>
  );
}

// ── Column Headers ────────────────────────────────────────────────────────────
const DEFAULT_FORM = { name: '', type: 'Status', options: '' };
const DEFAULT_BTN: ButtonConfig = { action: '', label: '', variant: 'default' };
const DEFAULT_COLORED_OPTS: ColoredOption[] = [
  { label: 'Pendiente', color: 'gray' },
  { label: 'En progreso', color: 'blue' },
  { label: 'Completado', color: 'green' },
];
const DEFAULT_FORMULA: FormulaConfig = { expression: '', resultType: 'number' };

export function DynamicColumnHeaders({ dynCols, asDiv, sticky, columnFilters, setColFilter, colUniqueValues, hiddenColumns, sortColumn, sortDirection, onToggleSort, visibleColIds }: {
  dynCols: DynCols;
  asDiv?: boolean;
  sticky?: boolean;
  columnFilters?: Record<string, Set<string>>;
  setColFilter?: (col: string, values: Set<string>) => void;
  colUniqueValues?: (key: string) => string[];
  hiddenColumns?: Set<string>;
  sortColumn?: string | null;
  sortDirection?: 'asc' | 'desc';
  onToggleSort?: (colId: string) => void;
  visibleColIds?: Set<string> | null;
}) {
  const [openAdd, setOpenAdd] = useState(false);
  const [openRename, setOpenRename] = useState(false);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [btnConfig, setBtnConfig] = useState<ButtonConfig>(DEFAULT_BTN);
  const [coloredOpts, setColoredOpts] = useState<ColoredOption[]>(DEFAULT_COLORED_OPTS);
  const [formulaConfig, setFormulaConfig] = useState<FormulaConfig>(DEFAULT_FORMULA);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [insertAt, setInsertAt] = useState<number | undefined>(undefined);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropInfo, setDropInfo] = useState<{ id: string; side: 'left' | 'right' } | null>(null);
  const [editingOptsCol, setEditingOptsCol] = useState<{ id: string; name: string; type?: string } | null>(null);
  const [editOpts, setEditOpts] = useState<ColoredOption[]>([]);
  const scrollRafRef = useRef<number | null>(null);
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const dragStartXRef = useRef<number | null>(null);
  const dragThresholdMetRef = useRef(false);
  const MIN_DRAG_DISTANCE = 5;
  const scrollDirectionRef = useRef<number>(0);
  const scrollSpeedRef = useRef<number>(0);
  const lastClientXRef = useRef<number | null>(null);
  const dragActiveRef = useRef<boolean>(false);
  const stickyOffsetRef = useRef<number>(0);
  const lastLogRef = useRef<number>(0);
  const dragIdRef = useRef<string | null>(null);
  const dropInfoRef = useRef<{ id: string; side: 'left' | 'right' } | null>(null);
  const dynColsRef = useRef(dynCols);
  dynColsRef.current = dynCols;
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const [ghostData, setGhostData] = useState<{ label: string; type: string; width: number; initX: number; initY: number } | null>(null);
  const sorted = [...dynCols.columns]
    .sort((a, b) => (a.columnOrder ?? 0) - (b.columnOrder ?? 0))
    .filter(col => !hiddenColumns?.has(col.id));

  const resetForm = () => {
    setForm(DEFAULT_FORM);
    setBtnConfig(DEFAULT_BTN);
    setColoredOpts(DEFAULT_COLORED_OPTS);
    setFormulaConfig(DEFAULT_FORMULA);
    setInsertAt(undefined);
  };

  const openInsert = (atIndex: number) => { resetForm(); setInsertAt(atIndex); setOpenAdd(true); };

  const handleAdd = () => {
    if (!form.name.trim()) return;
    let optionsJson: string | undefined;
    if (form.type === 'Select' || form.type === 'Status') {
      optionsJson = JSON.stringify(coloredOpts);
    } else if (form.type === 'Botón') {
      optionsJson = JSON.stringify(btnConfig);
    } else if (form.type === 'Fórmula') {
      optionsJson = JSON.stringify(formulaConfig);
    }
    // addColumn ya actualiza el estado local de forma optimista antes de
    // devolver la promesa — no hay que esperarla para cerrar el diálogo.
    // Insertar en medio de un tablero con muchas columnas reordena el resto
    // en serie (una llamada de red a la vez, para no pegarle al rate limit),
    // lo que puede tardar varios segundos; bloquear el diálogo hasta que
    // termine hacía que se sintiera trabado aunque la columna ya existiera
    // en el tablero de fondo. addColumn ya maneja su propio rollback/toast
    // de error si el guardado falla.
    dynCols.addColumn(form.name.trim(), form.type, optionsJson, insertAt).catch(() => {});
    resetForm();
    setOpenAdd(false);

    // Auto-scroll hacia la columna recién creada. En tableros con muchas
    // columnas (virtualización horizontal activa, ver RecruitmentPage.tsx)
    // una columna nueva puede caer fuera del área ya renderizada y mostrarse
    // como un placeholder invisible hasta que alguien scrollee manualmente
    // hasta ahí — nadie sabía que hacía falta, y parecía que la columna
    // "no aparecía". El placeholder sí preserva su posición real (ancho de
    // <colgroup>), así que scrollIntoView funciona aunque todavía no se
    // haya renderizado el contenido real.
    requestAnimationFrame(() => {
      const sorted = [...dynColsRef.current.columns].sort((a, b) => (a.columnOrder ?? 0) - (b.columnOrder ?? 0));
      const idx = insertAt ?? sorted.length - 1;
      const target = sorted[idx];
      if (!target) return;
      document.querySelector(`[data-dyn-col-id="${target.id}"]`)
        ?.scrollIntoView({ inline: 'end', block: 'nearest', behavior: 'smooth' });
    });
  };

  const handleRename = async () => {
    if (!renaming?.name.trim()) return;
    await dynCols.renameColumn(renaming.id, renaming.name.trim());
    setRenaming(null);
    setOpenRename(false);
  };

  const canAdd = Boolean(form.name.trim()) &&
    (form.type !== 'Botón' || (btnConfig.action && btnConfig.label.trim())) &&
    ((form.type !== 'Status' && form.type !== 'Select') || coloredOpts.length > 0) &&
    (form.type !== 'Fórmula' || formulaConfig.expression.trim().length > 0);

  const EDGE_THRESHOLD = 240;
  const MAX_SCROLL_SPEED = 18;

  const findHorizontalScrollContainer = (el: HTMLElement | null): HTMLElement | null => {
    let current = el?.parentElement ?? null;
    while (current) {
      const ox = window.getComputedStyle(current).overflowX;
      if (current.scrollWidth > current.clientWidth && (ox === 'auto' || ox === 'scroll')) return current;
      current = current.parentElement;
    }
    return null;
  };

  const detectStickyOffset = useCallback((container: HTMLElement): number => {
    const containerRect = container.getBoundingClientRect();
    const headerRow = container.querySelector('thead tr');
    let maxStickyRight = 0;
    if (headerRow) {
      headerRow.querySelectorAll('th').forEach(th => {
        const el = th as HTMLElement;
        const computed = window.getComputedStyle(el);
        const isSticky = computed.position === 'sticky';
        const leftVal = computed.left;
        const hasHorizontalLeft = leftVal !== '' && leftVal !== 'auto' && leftVal !== 'none';
        if (isSticky && hasHorizontalLeft) {
          const thRight = el.getBoundingClientRect().right;
          maxStickyRight = Math.max(maxStickyRight, thRight - containerRect.left);
        }
      });
    }
    return maxStickyRight > 0 ? maxStickyRight : 240;
  }, []);

  // ── Geometric drop target calculation ─────────────────────────────────────
  const computeDropTarget = useCallback((cx: number): { id: string; side: 'left' | 'right' } | null => {
    const container = scrollContainerRef.current;
    const currentDragId = dragIdRef.current;
    if (!container || !currentDragId) return null;

    const headers = Array.from(
      container.querySelectorAll<HTMLElement>('[data-dyn-col-id]')
    ).filter(h => h.dataset.dynColId !== currentDragId);

    if (headers.length === 0) return null;

    let bestId: string | null = null;
    let bestSide: 'left' | 'right' = 'left';

    // A. Cursor within a header rect
    for (const h of headers) {
      const r = h.getBoundingClientRect();
      if (cx >= r.left && cx <= r.right) {
        bestId = h.dataset.dynColId!;
        bestSide = cx < (r.left + r.right) / 2 ? 'left' : 'right';
        return { id: bestId, side: bestSide };
      }
    }

    // B/C/D. Outside headers
    const firstRect = headers[0].getBoundingClientRect();
    const lastRect = headers[headers.length - 1].getBoundingClientRect();

    if (cx < firstRect.left) {
      return { id: headers[0].dataset.dynColId!, side: 'left' };
    }
    if (cx > lastRect.right) {
      return { id: headers[headers.length - 1].dataset.dynColId!, side: 'right' };
    }

    // Between headers — closest center
    let minDist = Infinity;
    for (const h of headers) {
      const r = h.getBoundingClientRect();
      const center = (r.left + r.right) / 2;
      const dist = Math.abs(cx - center);
      if (dist < minDist) {
        minDist = dist;
        bestId = h.dataset.dynColId!;
        bestSide = cx < center ? 'left' : 'right';
      }
    }
    return bestId ? { id: bestId, side: bestSide } : null;
  }, []);

  // ── Cleanup helper ────────────────────────────────────────────────────────
  const stopDrag = useCallback(() => {
    dragActiveRef.current = false;
    if (scrollRafRef.current !== null) {
      cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = null;
    }
    scrollDirectionRef.current = 0;
    scrollSpeedRef.current = 0;
    lastClientXRef.current = null;
    stickyOffsetRef.current = 0;
    dragStartXRef.current = null;
    dragThresholdMetRef.current = false;
    setGhostData(null);
  }, []);

  // ── RAF scroll loop ───────────────────────────────────────────────────────
  const startScrollLoop = useCallback(() => {
    if (scrollRafRef.current !== null) return;
    const tick = () => {
      if (!dragActiveRef.current) { scrollRafRef.current = null; return; }
      const container = scrollContainerRef.current;
      if (!container || lastClientXRef.current === null) {
        scrollRafRef.current = requestAnimationFrame(tick);
        return;
      }

      const rect = container.getBoundingClientRect();
      const x = lastClientXRef.current;
      const maxScrollLeft = Math.max(0, container.scrollWidth - container.clientWidth);

      let targetDirection = 0;
      let targetSpeed = 0;

      const stickyZoneEnd = rect.left + stickyOffsetRef.current;
      const leftActivationEnd = stickyZoneEnd + EDGE_THRESHOLD;

      // Left scroll: activate even if cursor is outside container on the left
      if (x <= stickyZoneEnd) {
        if (container.scrollLeft > 0) {
          targetDirection = -1;
          if (x < rect.left) {
            targetSpeed = MAX_SCROLL_SPEED;
          } else {
            const ratio = stickyOffsetRef.current > 0
              ? Math.min(1, Math.max(0, (stickyZoneEnd - x) / stickyOffsetRef.current))
              : 1;
            targetSpeed = Math.max(8, Math.round(ratio * MAX_SCROLL_SPEED));
          }
        }
      } else if (x <= leftActivationEnd && container.scrollLeft > 0) {
        targetDirection = -1;
        const ratio = Math.min(1, Math.max(0, (leftActivationEnd - x) / EDGE_THRESHOLD));
        targetSpeed = Math.max(3, Math.round(ratio * MAX_SCROLL_SPEED));
      }
      // Right scroll: activate even if cursor is outside container on the right
      else if (x > rect.right - EDGE_THRESHOLD && container.scrollLeft < maxScrollLeft) {
        targetDirection = 1;
        if (x > rect.right) {
          targetSpeed = MAX_SCROLL_SPEED;
        } else {
          const ratio = Math.min(1, Math.max(0, (x - (rect.right - EDGE_THRESHOLD)) / EDGE_THRESHOLD));
          targetSpeed = Math.max(3, Math.round(ratio * MAX_SCROLL_SPEED));
        }
      }

      // Direction change cap
      if (targetDirection !== 0 && scrollDirectionRef.current !== 0 && scrollDirectionRef.current !== targetDirection) {
        scrollSpeedRef.current = Math.min(scrollSpeedRef.current, 4);
      }

      // Lerp
      if (targetDirection !== 0) {
        scrollDirectionRef.current = targetDirection;
        scrollSpeedRef.current += (targetSpeed - scrollSpeedRef.current) * 0.28;
      } else {
        scrollSpeedRef.current *= 0.72;
        if (scrollSpeedRef.current < 0.5) { scrollSpeedRef.current = 0; scrollDirectionRef.current = 0; }
      }

      // Apply
      if (scrollDirectionRef.current !== 0 && scrollSpeedRef.current > 0.5) {
        const next = container.scrollLeft + scrollDirectionRef.current * scrollSpeedRef.current;
        container.scrollLeft = Math.max(0, Math.min(maxScrollLeft, next));
      }

      // Diagnostic log
      const now = performance.now();
      if (now - lastLogRef.current > 500 && (scrollDirectionRef.current !== 0 || scrollSpeedRef.current > 0.5)) {
        lastLogRef.current = now;
        console.log('[column-pointer-scroll]', {
          x, direction: scrollDirectionRef.current, targetDirection,
          speed: scrollSpeedRef.current.toFixed(1),
          scrollLeft: Math.round(container.scrollLeft),
          maxScrollLeft: Math.round(maxScrollLeft),
        });
      }

      scrollRafRef.current = requestAnimationFrame(tick);
    };
    scrollRafRef.current = requestAnimationFrame(tick);
  }, []);

  // ── Stable listener refs (identity never changes across renders) ─────────
  const pointerMoveHandlerRef = useRef<(e: PointerEvent) => void>(() => {});
  const pointerUpHandlerRef = useRef<(e: PointerEvent) => void>(() => {});

  // These wrappers are created once (empty deps) and always delegate to the
  // latest handler via the refs, so re-renders never invalidate them.
  const stablePointerMove = useCallback((e: PointerEvent) => {
    pointerMoveHandlerRef.current(e);
  }, []);

  const stablePointerUp = useCallback((e: PointerEvent) => {
    pointerUpHandlerRef.current(e);
  }, []);

  // ── Pointer move handler ──────────────────────────────────────────────────
  const handlePointerMove = useCallback((e: PointerEvent) => {
    if (!dragActiveRef.current) return;
    lastClientXRef.current = e.clientX;

    // Threshold gate: don't compute drop targets until the user has dragged 5px
    if (!dragThresholdMetRef.current) {
      const startX = dragStartXRef.current;
      if (startX === null || Math.abs(e.clientX - startX) < MIN_DRAG_DISTANCE) {
        return;
      }
      dragThresholdMetRef.current = true;
    }

    // Move ghost imperatively — no re-render needed
    if (ghostRef.current) {
      ghostRef.current.style.left = `${e.clientX + 10}px`;
      ghostRef.current.style.top = `${e.clientY - 18}px`;
    }

    const _now = Date.now();
    if (_now - (lastLogRef.current ?? 0) > 300) {
      lastLogRef.current = _now;
      console.log('[column-drag] pointermove', { clientX: e.clientX, dragActive: dragActiveRef.current, dropInfo: dropInfoRef.current });
    }

    const next = computeDropTarget(e.clientX);
    if (next) {
      const prev = dropInfoRef.current;
      if (!prev || prev.id !== next.id || prev.side !== next.side) {
        dropInfoRef.current = next;
        setDropInfo(next);
      }
    }
  }, [computeDropTarget]);

  // ── Pointer up handler ────────────────────────────────────────────────────
  const handlePointerUp = useCallback(async () => {
    console.log('[column-drag] pointerup', { dragId: dragIdRef.current, dropInfo: dropInfoRef.current });
    window.removeEventListener('pointermove', stablePointerMove);
    window.removeEventListener('pointerup', stablePointerUp);
    const did = dragIdRef.current;
    const dinfo = dropInfoRef.current;
    const thresholdMet = dragThresholdMetRef.current;
    stopDrag();
    dragIdRef.current = null;
    dropInfoRef.current = null;
    scrollContainerRef.current = null;
    setDragId(null);
    setDropInfo(null);
    if (did && dinfo && did !== dinfo.id && thresholdMet) {
      void dynColsRef.current
        .reorderColumns(did, dinfo.id, dinfo.side)
        .catch(err => {
          console.error('[column-drag] reorder failed', err);
        });
    }
  }, [stablePointerMove, stablePointerUp, stopDrag]);

  // Keep refs pointing to the latest handlers every render.
  // This must be a direct assignment (not useEffect) so they're always fresh.
  pointerMoveHandlerRef.current = handlePointerMove;
  pointerUpHandlerRef.current = handlePointerUp;

  // ── Pointer down on grip ──────────────────────────────────────────────────
  const handleGripPointerDown = useCallback((e: React.PointerEvent, colId: string) => {
    console.log('[column-drag] pointerdown fired', { colId, pointerId: e.pointerId, clientX: e.clientX });
    e.preventDefault();
    e.stopPropagation();
    dragIdRef.current = colId;
    dropInfoRef.current = null;
    setDragId(colId);
    setDropInfo(null);
    lastClientXRef.current = e.clientX;
    dragStartXRef.current = e.clientX;
    dragThresholdMetRef.current = false;
    scrollDirectionRef.current = 0;
    scrollSpeedRef.current = 0;
    dragActiveRef.current = true;

    // Setup drag ghost
    const colEl = ((e.currentTarget as HTMLElement).closest?.('[data-dyn-col-id]') as HTMLElement) ?? (e.currentTarget as HTMLElement);
    const colRect = colEl.getBoundingClientRect();
    const draggedCol = dynColsRef.current.columns.find(c => c.id === colId);
    setGhostData({
      label: draggedCol?.columnName ?? '',
      type: draggedCol?.columnType ?? 'Texto',
      width: Math.min(colRect.width, 220),
      initX: e.clientX + 10,
      initY: e.clientY - 18,
    });

    const container = findHorizontalScrollContainer(e.currentTarget as HTMLElement);
    scrollContainerRef.current = container;
    if (container) {
      stickyOffsetRef.current = detectStickyOffset(container);
    }
    console.log('[column-drag] scroll container', { found: !!container, dragActive: dragActiveRef.current });

    window.addEventListener('pointermove', stablePointerMove);
    window.addEventListener('pointerup', stablePointerUp);
    console.log('[column-drag] listeners attached, dragId set to', colId);
    startScrollLoop();
  }, [stablePointerMove, stablePointerUp, startScrollLoop, detectStickyOffset]);

  // Cleanup on unmount only — stablePointerMove/Up never change identity
  // so this effect runs exactly once and cleans up exactly once on unmount.
  useEffect(() => {
    return () => {
      console.log('[column-drag] cleanup listeners (unmount)');
      if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current);
      window.removeEventListener('pointermove', stablePointerMove);
      window.removeEventListener('pointerup', stablePointerUp);
    };
  }, [stablePointerMove, stablePointerUp]);

  return (
    <>
      {sorted.map((col, idx) => {
        // Off-screen column: render minimal header (preserves colgroup widths + drag targets)
        if (visibleColIds && !visibleColIds.has(col.id)) {
          const minStyle = asDiv ? {} : sticky ? { position: 'sticky' as const, top: 0, zIndex: 30 } : {};
          if (asDiv) return <div key={col.id} data-dyn-col-id={col.id} className="flex-shrink-0 bg-muted border-b border-border/50 border-l border-border/50" style={{ minHeight: 33 }} />;
          return <th key={col.id} data-dyn-col-id={col.id} className="bg-muted border-b border-border/50 border-l border-border/50" style={minStyle} />;
        }
        const isDragging  = dragId === col.id;
        const isDropLeft  = dropInfo?.id === col.id && dropInfo.side === 'left';
        const isDropRight = dropInfo?.id === col.id && dropInfo.side === 'right';
        const cellClassName = [
          'text-left px-2 py-1 text-xs font-semibold whitespace-nowrap overflow-hidden border-l border-border/50 relative group/th select-none transition-opacity cursor-grab active:cursor-grabbing touch-none',
          sticky ? 'bg-muted border-b border-border/50' : 'bg-accent/30',
          isDragging  ? 'opacity-30 bg-primary/10' : 'opacity-100',
          asDiv       ? 'flex-shrink-0' : '',
        ].join(' ');
        const cellStyle = asDiv
          ? {}
          : sticky
            ? { position: 'sticky' as const, top: 0, zIndex: 30 }
            : {};
        const cellContent = (
          <>
            {isDropLeft && (
              <div
                className="absolute left-0 top-0 bottom-0 w-[3px] bg-primary pointer-events-none z-50"
                style={{ boxShadow: '0 0 10px 3px hsl(var(--primary)/0.55)' }}
              >
                <div
                  className="absolute top-0 w-0 h-0"
                  style={{
                    left: '-4px',
                    borderLeft: '5px solid transparent',
                    borderRight: '5px solid transparent',
                    borderTop: '7px solid hsl(var(--primary))',
                  }}
                />
              </div>
            )}
            {isDropRight && (
              <div
                className="absolute right-0 top-0 bottom-0 w-[3px] bg-primary pointer-events-none z-50"
                style={{ boxShadow: '0 0 10px 3px hsl(var(--primary)/0.55)' }}
              >
                <div
                  className="absolute top-0 w-0 h-0"
                  style={{
                    left: '-4px',
                    borderLeft: '5px solid transparent',
                    borderRight: '5px solid transparent',
                    borderTop: '7px solid hsl(var(--primary))',
                  }}
                />
              </div>
            )}
            <div className="flex items-center gap-1.5 group/hdr">
              <GripVertical className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground/40" />
              <ColTypeIcon type={col.columnType} className="w-3 h-3 flex-shrink-0 text-muted-foreground/60" />
              <span className="truncate max-w-[250px] whitespace-nowrap" title={col.columnName}>{col.columnName}</span>
              {onToggleSort && (
                <button
                  type="button"
                  data-no-column-drag="true"
                  onClick={() => onToggleSort(col.id)}
                  className="flex-shrink-0 hover:bg-muted-foreground/10 transition-colors rounded p-0.5"
                  title="Ordenar"
                >
                  {sortColumn === col.id
                    ? (sortDirection === 'asc' ? <ChevronUp className="w-3 h-3 text-primary" /> : <ChevronDown className="w-3 h-3 text-primary" />)
                    : <ArrowUpDown className="w-3 h-3 text-muted-foreground/30 opacity-0 group-hover/hdr:opacity-100" />
                  }
                </button>
              )}
              {setColFilter && colUniqueValues && (
                <span data-no-column-drag="true">
                  <ColumnFilterPopover
                    allValues={colUniqueValues(col.id)}
                    activeValues={columnFilters?.[col.id] ?? new Set()}
                    onApply={v => setColFilter(col.id, v)}
                  />
                </span>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button data-no-column-drag="true" className="flex-shrink-0 opacity-0 group-hover/hdr:opacity-100 ml-auto text-muted-foreground hover:text-foreground p-0.5 rounded transition-opacity">
                    <MoreHorizontal className="w-3 h-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-48">
                  <DropdownMenuItem onClick={() => { setRenaming({ id: col.id, name: col.columnName ?? '' }); setOpenRename(true); }}>
                    <Pencil className="w-3 h-3 mr-2" /> Renombrar
                  </DropdownMenuItem>
                  {(col.columnType === 'Status' || col.columnType === 'Select') && (
                    <DropdownMenuItem onClick={() => {
                      setEditOpts(parseColoredOptions(col.optionsJson));
                      setEditingOptsCol({ id: col.id, name: col.columnName ?? '', type: col.columnType });
                    }}>
                      <Pencil className="w-3.5 h-3.5 mr-2" /> Editar opciones
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => openInsert(idx)}>
                    <ArrowLeftFromLine className="w-3 h-3 mr-2" /> Insertar a la izquierda
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => openInsert(idx + 1)}>
                    <ArrowRightFromLine className="w-3 h-3 mr-2" /> Insertar a la derecha
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => dynCols.removeColumn(col.id)}>
                    <Trash2 className="w-3 h-3 mr-2" /> Eliminar
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div data-no-column-drag="true" className="absolute top-0 right-0 bottom-0 w-2 cursor-col-resize hover:bg-primary/50 opacity-0 group-hover/th:opacity-100 transition-opacity z-10"
              onMouseDown={e => { e.preventDefault(); e.stopPropagation(); dynCols.startResize(col.id, e.clientX); }} />
          </>
        );
        const headerPointerDown = (e: React.PointerEvent) => {
          const target = e.target as HTMLElement;
          if (
            target.closest('[data-no-column-drag="true"]') ||
            target.closest('button') ||
            target.closest('[role="menuitem"]') ||
            target.closest('input') ||
            target.closest('textarea') ||
            target.closest('select')
          ) return;
          handleGripPointerDown(e, col.id);
        };
        if (asDiv) {
          return (
            <div key={col.id} data-dyn-col-id={col.id} className={cellClassName} style={cellStyle} onPointerDown={headerPointerDown}>{cellContent}</div>
          );
        }
        return (
          <th key={col.id} data-dyn-col-id={col.id} className={cellClassName} style={cellStyle} onPointerDown={headerPointerDown}>{cellContent}</th>
        );
      })}

      {asDiv
        ? <div className="px-1 py-1 bg-muted/20" style={{ display: 'table-cell', verticalAlign: 'middle' }}>
            <button onClick={() => { resetForm(); setOpenAdd(true); }}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary hover:bg-primary/10 px-2 py-1 rounded-md transition-colors whitespace-nowrap">
              <Plus className="w-3 h-3" /> Columna
            </button>
          </div>
        : <th
            className={`px-1 py-1 ${sticky ? 'bg-muted border-b border-border/50' : 'bg-muted'}`}
            style={sticky ? { position: 'sticky', top: 0, zIndex: 30 } : {}}
          >
            <button onClick={() => { resetForm(); setOpenAdd(true); }}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary hover:bg-primary/10 px-2 py-1 rounded-md transition-colors whitespace-nowrap">
              <Plus className="w-3 h-3" /> Columna
            </button>
          </th>
      }

      {/* Add Column Dialog */}
      <Dialog open={openAdd} onOpenChange={o => { if (!o) resetForm(); setOpenAdd(o); }}>
        <DialogContent className="sm:max-w-sm max-h-[85vh] overflow-y-auto" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{insertAt !== undefined ? `Insertar columna en posición ${insertAt + 1}` : 'Nueva columna'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nombre de la columna</Label>
              <Input placeholder="Ej: Estado, Prioridad, Ciudad..."
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter' && !['Select', 'Botón', 'Status', 'Fórmula'].includes(form.type)) handleAdd(); }}
                autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label>Tipo de columna</Label>
              <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {COLUMN_TYPES.map(t => (
                    <SelectItem key={t.value} value={t.value}>
                      <span className="flex items-center gap-2">
                        <ColTypeIcon type={t.value} className="w-3.5 h-3.5 text-muted-foreground" />
                        {t.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {(form.type === 'Status' || form.type === 'Select') && (
              <ColoredOptionsForm options={coloredOpts} onChange={setColoredOpts}
                title={form.type === 'Status' ? 'Opciones de Status' : 'Opciones del Select'}
                showColor={form.type === 'Status'} />
            )}
            {form.type === 'Botón' && <ButtonConfigForm value={btnConfig} onChange={setBtnConfig} />}
            {form.type === 'Fórmula' && <FormulaConfigForm value={formulaConfig} onChange={setFormulaConfig} />}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { resetForm(); setOpenAdd(false); }}>Cancelar</Button>
            <Button onClick={handleAdd} disabled={!canAdd}>
              {insertAt !== undefined ? 'Insertar columna' : 'Agregar columna'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Dialog */}
      <Dialog open={openRename} onOpenChange={o => { if (!o) setOpenRename(false); }}>
        <DialogContent className="sm:max-w-xs" aria-describedby={undefined}>
          <DialogHeader><DialogTitle>Renombrar columna</DialogTitle></DialogHeader>
          <Input value={renaming?.name ?? ''} onChange={e => setRenaming(r => r ? { ...r, name: e.target.value } : null)}
            onKeyDown={e => e.key === 'Enter' && handleRename()} autoFocus />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenRename(false)}>Cancelar</Button>
            <Button onClick={handleRename}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Options Dialog */}
      <Dialog open={!!editingOptsCol} onOpenChange={o => { if (!o) setEditingOptsCol(null); }}>
        <DialogContent className="sm:max-w-sm max-h-[85vh] overflow-y-auto" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Editar opciones — {editingOptsCol?.name}</DialogTitle>
          </DialogHeader>
          <ColoredOptionsForm
            options={editOpts}
            onChange={setEditOpts}
            title="Opciones"
            showColor={editingOptsCol?.type === 'Status'}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingOptsCol(null)}>Cancelar</Button>
            <Button
              disabled={editOpts.length === 0}
              onClick={async () => {
                if (!editingOptsCol) return;
                await dynCols.updateColumn(editingOptsCol.id, { optionsJson: JSON.stringify(editOpts) });
                setEditingOptsCol(null);
              }}
            >
              Guardar opciones
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {ghostData && createPortal(
        <div
          ref={ghostRef}
          className="pointer-events-none select-none flex items-center gap-1.5 px-2 py-2 rounded-md border border-primary/50 bg-card text-xs font-semibold"
          style={{
            position: 'fixed',
            left: ghostData.initX,
            top: ghostData.initY,
            width: ghostData.width,
            zIndex: 9999,
            opacity: 0.92,
            transform: 'rotate(-2deg) scale(1.04)',
            boxShadow: '0 8px 28px hsl(var(--primary)/0.25), 0 4px 12px rgba(0,0,0,0.2)',
            backdropFilter: 'blur(2px)',
          }}
        >
          <GripVertical className="w-3.5 h-3.5 flex-shrink-0 text-primary/70" />
          <ColTypeIcon type={ghostData.type} className="w-3 h-3 flex-shrink-0 text-primary/80" />
          <span className="truncate text-foreground">{ghostData.label}</span>
        </div>,
        document.body
      )}
    </>
  );
}

// ── Bulk edit label helper ────────────────────────────────────────────────────
function getCellLabel(v: CellVal, _colType?: string): string {
  if (v.booleanValue != null) return v.booleanValue ? 'Activado' : 'Desactivado';
  if (v.numberValue != null) return _colType === 'Barra' ? `${v.numberValue}%` : String(v.numberValue);
  if (v.dateValue) return v.dateValue.split('T')[0];
  if (v.textValue != null) return v.textValue || '(vacío)';
  return '(vacío)';
}

// Types that render meaningfully even when empty — skip skeleton for these
const SKIP_SKELETON_TYPES = new Set(['Checkbox', 'Rating', 'Botón', 'Status', 'Select', 'Color', 'Fórmula', 'Barra']);

// ── Cell component ────────────────────────────────────────────────────────────
// Memoizado: en tableros de reclutamiento con muchas columnas dinámicas, esta
// es la parte más cara de cada fila (docenas de celdas × ~130 filas montadas
// durante el scroll virtualizado) — sin memo, se recalculan todas en cada
// frame de scroll aunque su contenido no haya cambiado. Requiere que quien la
// use pase `onBulkSave` estable (useCallback), o el memo nunca hace bail-out.
export const DynamicColumnCells = memo(function DynamicColumnCells({ rowId, dynCols, asDiv, hiddenColumns, recentColors, recentTextColors, recentBgColors, selectedIds, onBulkSave, colUniqueValues, visibleColIds }: { rowId: string; dynCols: DynCols; asDiv?: boolean; hiddenColumns?: Set<string>; recentColors?: string[]; recentTextColors?: string[]; recentBgColors?: string[]; selectedIds?: Set<string>; onBulkSave?: (colId: string, value: CellVal, label: string) => void; colUniqueValues?: (key: string) => string[]; visibleColIds?: Set<string> | null }) {
  const sorted = [...dynCols.columns]
    .sort((a, b) => (a.columnOrder ?? 0) - (b.columnOrder ?? 0))
    .filter(col => !hiddenColumns?.has(col.id));
  return (
    <>
      {sorted.map(col => {
        // Off-screen column: render a lightweight empty cell (no event handlers, no subcomponents)
        if (visibleColIds && !visibleColIds.has(col.id)) {
          if (asDiv) return <div key={col.id} className="flex-shrink-0 border-l border-border/30" style={{ minHeight: 36 }} />;
          return <td key={col.id} className="h-9 border-l border-b border-border/30" />;
        }
        const value = dynCols.getCellVal(rowId, col.id);
        const showSkeleton =
          dynCols.cellsLoading &&
          value === undefined &&
          !SKIP_SKELETON_TYPES.has(col.columnType ?? '');
        const cellContent = showSkeleton ? (
          <div className="flex items-center px-1">
            <Skeleton className="h-3.5 rounded w-3/4 opacity-50" />
          </div>
        ) : (
          <CellEditor
            col={col}
            value={value}
            onSave={v => {
              dynCols.setCellVal(rowId, col.id, v);
              if (selectedIds?.has(rowId) && selectedIds.size > 1 && onBulkSave)
                onBulkSave(col.id, v, getCellLabel(v, col.columnType));
            }}
            rowId={rowId}
            dynCols={dynCols}
            recentColors={recentColors}
            recentTextColors={recentTextColors}
            recentBgColors={recentBgColors}
            suggestions={colUniqueValues && ['Texto', 'Email', 'Teléfono'].includes(col.columnType ?? '') ? colUniqueValues(col.id) : undefined}
          />
        );
        const isCheckbox = col.columnType === 'Checkbox';
        // El checkbox se envuelve en un contenedor flex propio en vez de
        // volver flex al <td>/<div> de la celda — hacer flex la celda misma
        // le quita su comportamiento de table-cell (rompe el ancho compartido
        // vía <colgroup> en la tabla real).
        const centeredContent = isCheckbox
          ? <div className="flex items-center justify-center w-full h-full">{cellContent}</div>
          : cellContent;
        // El fondo de "Texto con color" es por CELDA (cada fila elige el
        // suyo), no por tipo de columna como Status — se aplica como style
        // inline, que gana sobre la clase de fondo por defecto de abajo.
        const cellBgColor = col.columnType === 'TextoColor' ? parseTextoColorMeta(value?.fileUrl)?.bgColor : undefined;
        if (asDiv) {
          return (
            <div key={col.id}
              className={`px-2 py-0 h-9 overflow-hidden border-l border-border/30 flex items-center ${col.columnType === 'Status' ? 'bg-card' : 'bg-accent/5'}`}
              style={cellBgColor ? { backgroundColor: cellBgColor } : undefined}>
              {centeredContent}
            </div>
          );
        }
        return (
          <td key={col.id}
            className={`px-2 py-0 h-9 overflow-hidden border-l border-b border-border/30 ${col.columnType === 'Status' ? 'bg-card' : 'bg-accent/5'}`}
            style={cellBgColor ? { backgroundColor: cellBgColor } : undefined}>
            {centeredContent}
          </td>
        );
      })}
      {asDiv ? <div className="bg-muted/10" /> : <td className="bg-muted/10 border-b border-border/30" />}
    </>
  );
});
