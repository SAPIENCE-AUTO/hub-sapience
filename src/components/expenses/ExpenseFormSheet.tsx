import { useState, useEffect, useRef, useCallback } from 'react';
import { uploadFile } from 'zite-file-upload-sdk';
import {
  saveExpense, getExpenseLineItems, submitExpense, approveExpense,
  GetExpensesOutputType, GetPettyCashFundsOutputType,
} from 'zite-endpoints-sdk';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Plus, Trash2, Paperclip, CheckCircle2, Loader2, FileSpreadsheet, Send, CheckCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useProject } from '../../context/ProjectContext';
import SearchableSelect from '@/components/SearchableSelect';
import { COST_CENTERS } from '../../lib/constants';
import { fmtCurrency } from '../../lib/format';
import ExcelImportExpenseDialog from './ExcelImportExpenseDialog';

type Expense = GetExpensesOutputType['expenses'][0];
type Fund = GetPettyCashFundsOutputType['funds'][0];

const CATEGORIES = ['Viáticos', 'Transporte', 'Alimentación', 'Hospedaje', 'Compras menores', 'Papelería', 'Materiales', 'Otros'];
const PAYMENT_METHODS = ['Caja chica', 'Tarjeta corporativa', 'Reembolso empleado'];


const STATUS_STYLES: Record<string, string> = {
  'Borrador':               'bg-muted text-muted-foreground border-transparent',
  'Enviado a aprobación':   'border-amber-300 bg-amber-50 text-amber-800',
  'Aprobado':               'border-emerald-300 bg-emerald-50 text-emerald-800',
  'Rechazado':              'border-rose-300 bg-rose-50 text-rose-800',
};

export interface LineItem {
  id?: string;
  description: string;
  category: string;
  amount: number;
  date: string;
  receipt: { url: string }[];
  notes: string;
}

function newLine(defaultDate = ''): LineItem {
  return { description: '', category: '', amount: 0, date: defaultDate, receipt: [], notes: '' };
}

const fmtNum = (n: number) => n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });


interface Props {
  open: boolean;
  onClose: () => void;
  expense: Expense | null;
  funds: Fund[];
  onSaved: () => void;
  canApprove: boolean;
  userEmail: string;
  isFinanceRole: boolean;
}

type HeaderState = {
  description: string; costCenter: string; projectCode: string;
  currency: string; paymentMethod: string; pettyCashFundId: string; notes: string;
};

const EMPTY_HEADER: HeaderState = {
  description: '', costCenter: '', projectCode: '', currency: 'MXN',
  paymentMethod: '', pettyCashFundId: '', notes: '',
};

export default function ExpenseFormSheet({
  open, onClose, expense, funds, onSaved,
  canApprove, userEmail, isFinanceRole,
}: Props) {
  const { projects } = useProject();
  const [header, setHeader] = useState<HeaderState>(EMPTY_HEADER);
  const [lines, setLines] = useState<LineItem[]>([newLine()]);
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [approving, setApproving] = useState(false);
  const [loadingLines, setLoadingLines] = useState(false);
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);
  const [excelImportOpen, setExcelImportOpen] = useState(false);

  // Tracks the saved expense ID and live status after creation/edit
  const [savedExpenseId, setSavedExpenseId] = useState<string | null>(null);
  const [savedStatus, setSavedStatus] = useState<string>('Borrador');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingUploadIdx = useRef<number | null>(null);

  const today = new Date().toISOString().split('T')[0];

  useEffect(() => {
    if (!open) return;
    setDeletedIds([]);

    if (expense) {
      setSavedExpenseId(expense.id);
      setSavedStatus(expense.status ?? 'Borrador');
      setHeader({
        description: expense.description ?? '',
        costCenter: expense.costCenter ?? '',
        projectCode: expense.projectCode ?? '',
        currency: expense.currency ?? 'MXN',
        paymentMethod: expense.paymentMethod ?? '',
        pettyCashFundId: expense.pettyCashFundId ?? '',
        notes: expense.notes ?? '',
      });
      setLoadingLines(true);
      getExpenseLineItems({ expenseId: expense.id })
        .then(({ lineItems }) => {
          if (lineItems.length > 0) {
            setLines(lineItems.map(li => ({
              id: li.id,
              description: li.description ?? '',
              category: li.category ?? '',
              amount: li.amount ?? 0,
              date: li.date ?? today,
              receipt: li.receipt ?? [],
              notes: li.notes ?? '',
            })));
          } else {
            setLines([{
              id: undefined,
              description: expense.description ?? '',
              category: expense.category ?? '',
              amount: expense.amount ?? 0,
              date: expense.expenseDate ?? today,
              receipt: expense.receipt ?? [],
              notes: '',
            }]);
          }
        })
        .catch(() => setLines([newLine(today)]))
        .finally(() => setLoadingLines(false));
    } else {
      setSavedExpenseId(null);
      setSavedStatus('Borrador');
      setHeader(EMPTY_HEADER);
      setLines([newLine(today)]);
    }
  }, [open, expense?.id]);

  const setH = (k: keyof HeaderState, v: string) => setHeader(p => ({ ...p, [k]: v }));
  const updateLine = (i: number, patch: Partial<LineItem>) =>
    setLines(prev => prev.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  const removeLine = (i: number) => {
    const line = lines[i];
    if (line.id) setDeletedIds(d => [...d, line.id!]);
    setLines(prev => prev.filter((_, idx) => idx !== i));
  };
  const triggerUpload = (i: number) => {
    pendingUploadIdx.current = i;
    fileInputRef.current?.click();
  };
  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const idx = pendingUploadIdx.current;
    e.target.value = '';
    if (!file || idx === null) return;
    setUploadingIdx(idx);
    try {
      const { fileUrl } = await uploadFile({ data: file, filename: file.name });
      updateLine(idx, { receipt: [{ url: fileUrl }] });
    } catch {
      toast.error('Error al subir comprobante');
    }
    setUploadingIdx(null);
    pendingUploadIdx.current = null;
  }, []);

  const total = lines.reduce((s, l) => s + (l.amount || 0), 0);

  const handleSave = async () => {
    if (!header.description.trim() || !header.paymentMethod || !header.costCenter) {
      toast.error('Completa descripción, método de pago y centro de costos');
      return;
    }
    const validLines = lines.filter(l => l.description.trim() || l.amount > 0);
    if (validLines.length === 0) {
      toast.error('Agrega al menos una línea de gasto');
      return;
    }
    setSaving(true);
    try {
      const result = await saveExpense({
        id: savedExpenseId ?? undefined,
        description: header.description.trim(),
        paymentMethod: header.paymentMethod,
        costCenter: header.costCenter,
        projectCode: header.projectCode || undefined,
        currency: header.currency,
        notes: header.notes || undefined,
        pettyCashFundId: (header.paymentMethod === 'Caja chica' && header.pettyCashFundId) ? header.pettyCashFundId : undefined,
        lineItems: validLines.map(l => ({
          id: l.id,
          description: l.description,
          category: l.category,
          amount: l.amount,
          date: l.date || undefined,
          receipt: l.receipt.map(r => ({ url: r.url, name: r.url.split('/').pop() ?? 'comprobante' })),
          notes: l.notes || undefined,
        })),
        deletedLineItemIds: deletedIds,
      });
      // Stay open — set ID and transition to action footer
      setSavedExpenseId(result.id);
      setSavedStatus(prev => prev === 'Rechazado' ? 'Borrador' : prev); // reset if was rejected
      toast.success(savedExpenseId ? 'Cambios guardados' : 'Borrador creado');
      onSaved(); // refresh list in background, but don't close
    } catch (e: unknown) {
      toast.error((e as { message?: string })?.message ?? 'Error al guardar');
    }
    setSaving(false);
  };

  const handleSubmit = async () => {
    if (!savedExpenseId) return;
    setSubmitting(true);
    try {
      await submitExpense({ id: savedExpenseId });
      setSavedStatus('Enviado a aprobación');
      toast.success('Gasto enviado a aprobación');
      onSaved();
    } catch (e: unknown) {
      toast.error((e as { message?: string })?.message ?? 'Error al enviar');
    }
    setSubmitting(false);
  };

  const handleApprove = async () => {
    if (!savedExpenseId) return;
    setApproving(true);
    try {
      await approveExpense({ id: savedExpenseId });
      setSavedStatus('Aprobado');
      toast.success('Gasto aprobado');
      onSaved();
    } catch (e: unknown) {
      toast.error((e as { message?: string })?.message ?? 'Error al aprobar');
    }
    setApproving(false);
  };

  const handleClose = () => { onSaved(); onClose(); };

  // Determine if editing is allowed
  const canEdit = !savedExpenseId
    || savedStatus === 'Borrador'
    || savedStatus === 'Rechazado';

  // Build footer
  const isNew = !savedExpenseId;
  const isOwner = !expense?.createdBy || expense.createdBy === userEmail;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-5 pb-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-3">
            <DialogTitle className="text-base">
              {expense ? 'Editar gasto' : savedExpenseId ? 'Gasto creado' : 'Nuevo gasto'}
            </DialogTitle>
            {savedExpenseId && savedStatus && (
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_STYLES[savedStatus] ?? 'bg-muted text-muted-foreground border-transparent'}`}>
                {savedStatus}
              </span>
            )}
          </div>
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-0">
          <div className="px-6 py-5 space-y-5">

            {/* Header fields */}
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label className="text-xs font-medium">Título del gasto *</Label>
                <Input value={header.description} onChange={e => setH('description', e.target.value)}
                  placeholder='Ej: "Viaje a EEUU — Proyecto Kraft"'
                  className="h-9 text-sm" autoFocus disabled={!canEdit} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Método de pago *</Label>
                <Select value={header.paymentMethod} onValueChange={v => setH('paymentMethod', v)} disabled={!canEdit}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                  <SelectContent>{PAYMENT_METHODS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Centro de costos *</Label>
                <Select value={header.costCenter} onValueChange={v => setH('costCenter', v)} disabled={!canEdit}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                  <SelectContent>{COST_CENTERS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {header.paymentMethod === 'Caja chica' && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Fondo de caja chica</Label>
                  <Select value={header.pettyCashFundId} onValueChange={v => setH('pettyCashFundId', v)} disabled={!canEdit}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Seleccionar fondo..." /></SelectTrigger>
                    <SelectContent>
                      {funds.map(f => <SelectItem key={f.id} value={f.id}>{f.fundName} — {fmtCurrency(f.currentBalance ?? undefined)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Proyecto</Label>
                <SearchableSelect
                  value={header.projectCode || '__none__'}
                  onChange={v => setH('projectCode', v === '__none__' ? '' : v)}
                  options={[{ value: '__none__', label: 'Sin proyecto' }, ...projects.map(p => ({ value: p.projectCode ?? '', label: p.projectCode ?? '', sub: p.fullName ?? '' }))]}
                  placeholder="Sin proyecto"
                  className="w-full h-9 text-sm"
                />

              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Moneda</Label>
                <Select value={header.currency} onValueChange={v => setH('currency', v)} disabled={!canEdit}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="MXN">MXN</SelectItem><SelectItem value="USD">USD</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label className="text-xs font-medium">Notas</Label>
                <Textarea value={header.notes} onChange={e => setH('notes', e.target.value)}
                  placeholder="Contexto adicional..." className="text-sm resize-none min-h-[56px]"
                  disabled={!canEdit} />
              </div>
            </div>

            {/* Line items */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium">Partidas del gasto</Label>
                {canEdit && (
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-muted-foreground hover:text-primary"
                      onClick={() => setExcelImportOpen(true)}>
                      <FileSpreadsheet className="w-3 h-3" /> Importar Excel
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-primary"
                      onClick={() => setLines(p => [...p, newLine(today)])}>
                      <Plus className="w-3 h-3" /> Agregar línea
                    </Button>
                  </div>
                )}
              </div>

              {loadingLines ? (
                <div className="h-20 flex items-center justify-center text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin mr-2" /> Cargando partidas...
                </div>
              ) : (
                <div className="border border-border rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50 border-b border-border">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Descripción</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground w-36">Categoría</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground w-32">Fecha</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground w-28">Monto</th>
                        <th className="text-center px-3 py-2 font-medium text-muted-foreground w-20">Comprobante</th>
                        {canEdit && <th className="w-8" />}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {lines.map((line, i) => (
                        <LineRow
                          key={i}
                          line={line}
                          uploading={uploadingIdx === i}
                          onChange={patch => updateLine(i, patch)}
                          onRemove={() => removeLine(i)}
                          onUpload={() => triggerUpload(i)}
                          canRemove={lines.length > 1}
                          readOnly={!canEdit}
                        />
                      ))}
                    </tbody>
                    <tfoot className="bg-muted/30 border-t border-border">
                      <tr>
                        <td colSpan={3} className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground">
                          Total {header.currency}
                        </td>
                        <td className="px-3 py-2 text-right text-sm font-bold">{fmtNum(total)}</td>
                        <td colSpan={canEdit ? 2 : 1} />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          </div>
        </ScrollArea>

        {/* ── Footer ── */}
        <div className="px-6 py-4 border-t border-border flex-shrink-0 flex items-center gap-2">
          {/* Left: status info after save */}
          <div className="flex-1">
            {savedExpenseId && savedStatus === 'Borrador' && (
              <p className="text-xs text-muted-foreground">Guardado como borrador. ¿Listo para enviarlo?</p>
            )}
            {savedExpenseId && savedStatus === 'Enviado a aprobación' && !canApprove && (
              <p className="text-xs text-muted-foreground">En espera de aprobación.</p>
            )}
            {savedExpenseId && savedStatus === 'Aprobado' && (
              <p className="text-xs text-emerald-600 font-medium flex items-center gap-1">
                <CheckCheck className="w-3.5 h-3.5" /> Gasto aprobado.
              </p>
            )}
          </div>

          {/* Right: action buttons */}
          <div className="flex items-center gap-2">
            {/* CASE 1: New, not yet saved */}
            {isNew && (
              <>
                <Button variant="ghost" size="sm" onClick={handleClose} disabled={saving}>Cancelar</Button>
                <Button size="sm" onClick={handleSave} disabled={saving || loadingLines} className="min-w-[130px]">
                  {saving
                    ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />Guardando...</>
                    : 'Crear borrador'}
                </Button>
              </>
            )}

            {/* CASE 2: Existing expense — Borrador or Rechazado (editable) */}
            {savedExpenseId && (savedStatus === 'Borrador' || savedStatus === 'Rechazado') && (
              <>
                <Button variant="ghost" size="sm" onClick={handleClose} disabled={saving || submitting || approving}>
                  Cerrar
                </Button>
                <Button variant="outline" size="sm" onClick={handleSave} disabled={saving || loadingLines} className="min-w-[130px]">
                  {saving
                    ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />Guardando...</>
                    : 'Guardar cambios'}
                </Button>
                {(isOwner || isFinanceRole) && (
                  <Button size="sm" onClick={handleSubmit} disabled={submitting || saving} className="gap-1.5">
                    {submitting
                      ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Enviando...</>
                      : <><Send className="w-3.5 h-3.5" />Enviar a aprobación</>}
                  </Button>
                )}
                {canApprove && (
                  <Button size="sm" onClick={handleApprove} disabled={approving || saving}
                    className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white">
                    {approving
                      ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Aprobando...</>
                      : <><CheckCheck className="w-3.5 h-3.5" />Aprobar</>}
                  </Button>
                )}
              </>
            )}

            {/* CASE 3: Enviado a aprobación */}
            {savedExpenseId && savedStatus === 'Enviado a aprobación' && (
              <>
                <Button variant="ghost" size="sm" onClick={handleClose} disabled={approving}>Cerrar</Button>
                {canApprove && (
                  <Button size="sm" onClick={handleApprove} disabled={approving}
                    className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white">
                    {approving
                      ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Aprobando...</>
                      : <><CheckCheck className="w-3.5 h-3.5" />Aprobar</>}
                  </Button>
                )}
              </>
            )}

            {/* CASE 4: Aprobado or terminal state */}
            {savedExpenseId && (savedStatus === 'Aprobado') && (
              <Button size="sm" onClick={handleClose}>Cerrar</Button>
            )}
          </div>
        </div>

        <input ref={fileInputRef} type="file" className="hidden" accept="image/*,.pdf,.xlsx,.xls"
          onChange={handleFileChange} />
      </DialogContent>

      <ExcelImportExpenseDialog
        open={excelImportOpen}
        onClose={() => setExcelImportOpen(false)}
        defaultDate={today}
        onImport={imported => {
          setLines(prev => {
            const isEmpty = prev.length === 1 && !prev[0].description && prev[0].amount === 0;
            return isEmpty ? imported : [...prev, ...imported];
          });
        }}
      />
    </Dialog>
  );
}

// ── LineRow sub-component ─────────────────────────────────────────────────────
interface LineRowProps {
  line: LineItem;
  uploading: boolean;
  onChange: (patch: Partial<LineItem>) => void;
  onRemove: () => void;
  onUpload: () => void;
  canRemove: boolean;
  readOnly: boolean;
}

function LineRow({ line, uploading, onChange, onRemove, onUpload, canRemove, readOnly }: LineRowProps) {
  const hasReceipt = line.receipt.length > 0;
  const receiptUrl = line.receipt[0]?.url;
  const isImg = receiptUrl ? /\.(png|jpg|jpeg|gif|webp)$/i.test(receiptUrl) : false;
  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (readOnly) return;
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    try {
      const { fileUrl } = await uploadFile({ data: file, filename: file.name });
      onChange({ receipt: [{ url: fileUrl }] });
    } catch {
      toast.error('Error al subir comprobante');
    }
  };

  return (
    <tr className="hover:bg-muted/20 transition-colors">
      <td className="px-2 py-1.5">
        <Input className="h-7 text-xs border-0 focus-visible:ring-0 bg-transparent min-w-[140px]"
          value={line.description} onChange={e => onChange({ description: e.target.value })}
          placeholder="Descripción..." disabled={readOnly} />
      </td>
      <td className="px-2 py-1.5">
        <select
          value={line.category}
          onChange={e => onChange({ category: e.target.value })}
          disabled={readOnly}
          className="w-full h-7 text-xs bg-transparent border-0 focus:outline-none focus:ring-0 text-foreground disabled:opacity-50"
        >
          <option value="">Categoría...</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </td>
      <td className="px-2 py-1.5">
        <Input type="date" className="h-7 text-xs border-0 focus-visible:ring-0 bg-transparent w-28"
          value={line.date} onChange={e => onChange({ date: e.target.value })} disabled={readOnly} />
      </td>
      <td className="px-2 py-1.5">
        <Input type="number" min="0" step="0.01"
          className="h-7 text-xs border-0 focus-visible:ring-0 bg-transparent text-right w-24"
          value={line.amount === 0 ? '' : line.amount}
          placeholder="0.00"
          onChange={e => onChange({ amount: e.target.value === '' ? 0 : Number(e.target.value) })}
          disabled={readOnly} />
      </td>
      <td
        className={`px-2 py-1.5 text-center rounded transition-colors ${isDragging && !readOnly ? 'bg-primary/10 outline outline-2 outline-primary outline-offset-[-2px]' : ''}`}
        onDragOver={e => { e.preventDefault(); if (!readOnly) setIsDragging(true); }}
        onDragEnter={e => { e.preventDefault(); if (!readOnly) setIsDragging(true); }}
        onDragLeave={e => { e.preventDefault(); setIsDragging(false); }}
        onDrop={handleDrop}
      >
        {uploading ? (
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground mx-auto" />
        ) : hasReceipt ? (
          <div className="flex items-center justify-center gap-1">
            <a href={receiptUrl} target="_blank" rel="noopener noreferrer" title="Ver comprobante">
              {isImg
                ? <img src={receiptUrl} alt="comp" className="w-6 h-6 rounded object-cover border border-border" />
                : <Paperclip className="w-4 h-4 text-primary" />
              }
            </a>
            <CheckCircle2 className="w-3 h-3 text-emerald-500 flex-shrink-0" />
          </div>
        ) : !readOnly ? (
          <button onClick={onUpload}
            className="flex items-center justify-center mx-auto w-7 h-7 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
            <Paperclip className="w-3.5 h-3.5" />
          </button>
        ) : null}
      </td>
      {!readOnly && (
        <td className="px-1 py-1.5 text-center">
          <button onClick={onRemove} disabled={!canRemove}
            className="flex items-center justify-center w-6 h-6 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive disabled:opacity-20 transition-colors mx-auto">
            <Trash2 className="w-3 h-3" />
          </button>
        </td>
      )}
    </tr>
  );
}
