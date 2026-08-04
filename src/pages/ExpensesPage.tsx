import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from 'zite-auth-sdk';
import {
  getExpenses, getPettyCashFunds, approveExpense, rejectExpense,
  submitExpense, deleteExpense, savePettyCashFund,
  GetExpensesOutputType, GetPettyCashFundsOutputType,
} from 'zite-endpoints-sdk';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ReceiptText, Plus, RefreshCw, Search, CheckCircle, XCircle, Trash2, Wallet, Clock, Pencil, Send, TrendingUp, DollarSign, ArrowUp } from 'lucide-react';
import { toast } from 'sonner';
import ExpenseFormSheet from '../components/expenses/ExpenseFormSheet';
import ExpenseDetailDialog from '../components/expenses/ExpenseDetailDialog';
import { COST_CENTERS } from '../lib/constants';

type Expense = GetExpensesOutputType['expenses'][0];
type Fund = GetPettyCashFundsOutputType['funds'][0];

const CATEGORIES = ['Viáticos', 'Transporte', 'Alimentación', 'Hospedaje', 'Compras menores', 'Papelería', 'Materiales', 'Otros'];
const PAYMENT_METHODS = ['Caja chica', 'Tarjeta corporativa', 'Reembolso empleado'];

const STATUSES = ['Borrador', 'Enviado a aprobación', 'Aprobado', 'Rechazado'];

const STATUS_STYLES: Record<string, string> = {
  'Borrador': 'bg-muted text-muted-foreground border-transparent',
  'Enviado a aprobación': 'border-amber-300 bg-amber-50 text-amber-800',
  'Aprobado': 'border-emerald-300 bg-emerald-50 text-emerald-800',
  'Rechazado': 'border-rose-300 bg-rose-50 text-rose-800',
};

function fmt(amount: number | null | undefined, currency = 'MXN') {
  if (amount == null) return '—';
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount);
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return new Date(Number(y), Number(m) - 1, Number(day)).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return null;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_STYLES[status] ?? 'bg-muted text-muted-foreground border-transparent'}`}>
      {status}
    </span>
  );
}

export default function ExpensesPage() {
  const { user } = useAuth();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [funds, setFunds] = useState<Fund[]>([]);
  const [isFinance, setIsFinance] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editExpense, setEditExpense] = useState<Expense | null>(null);
  const [pettyCashOpen, setPettyCashOpen] = useState(false);

  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<Expense | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [rejecting, setRejecting] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Expense | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [approving, setApproving] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<string | null>(null);

  const [filterStatus, setFilterStatus] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterMethod, setFilterMethod] = useState('');
  const [search, setSearch] = useState('');
  const [refresh, setRefresh] = useState(0);

  const [detailExpense, setDetailExpense] = useState<Expense | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const canApprove = ['Aprobador', 'Finanzas', 'Socios'].includes(user?.purchaseLevel ?? '');
  const isFinanceRole = ['Admin', 'Admin Financiero', 'Finanzas'].includes(user?.role ?? '');

  const loadExpenses = useCallback(async () => {
    setLoading(true);
    try {
      const r = await getExpenses({
        status: filterStatus || undefined,
        category: filterCategory || undefined,
        paymentMethod: filterMethod || undefined,
      });
      setExpenses(r.expenses);
      setIsFinance(r.isFinanceUser);
    } catch { toast.error('Error al cargar gastos'); }
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStatus, filterCategory, filterMethod, refresh]);

  const loadFunds = useCallback(async () => {
    try { const r = await getPettyCashFunds({}); setFunds(r.funds); } catch { /* no permission */ }
  }, []);

  useEffect(() => { loadExpenses(); }, [loadExpenses]);
  useEffect(() => { loadFunds(); }, [loadFunds]);

  const filtered = useMemo(() => {
    if (!search.trim()) return expenses;
    const q = search.toLowerCase();
    return expenses.filter(e =>
      e.description?.toLowerCase().includes(q) ||
      e.category?.toLowerCase().includes(q) ||
      e.costCenter?.toLowerCase().includes(q) ||
      e.projectCode?.toLowerCase().includes(q)
    );
  }, [expenses, search]);

  const currentMonth = new Date().toISOString().slice(0, 7);
  const thisMonth = useMemo(() => expenses.filter(e => (e.expenseDate ?? '').startsWith(currentMonth)), [expenses, currentMonth]);
  const totalThisMonth = useMemo(() => thisMonth.reduce((s, e) => s + (e.amount ?? 0), 0), [thisMonth]);
  const pendingCount = useMemo(() => expenses.filter(e => e.status === 'Enviado a aprobación').length, [expenses]);
  const approvedCount = useMemo(() => thisMonth.filter(e => e.status === 'Aprobado').length, [thisMonth]);
  const cashBalance = useMemo(() => funds.filter(f => f.status === 'Activo').reduce((s, f) => s + (f.currentBalance ?? 0), 0), [funds]);

  const handleApprove = async (expense: Expense) => {
    setApproving(expense.id);
    try {
      await approveExpense({ id: expense.id });
      toast.success('Gasto aprobado');
      setRefresh(r => r + 1); loadFunds();
    } catch (e: unknown) { toast.error((e as { message?: string })?.message ?? 'Error al aprobar'); }
    setApproving(null);
  };

  const handleReject = async () => {
    if (!rejectTarget || !rejectionReason.trim()) return;
    setRejecting(true);
    try {
      await rejectExpense({ id: rejectTarget.id, rejectionReason: rejectionReason.trim() });
      toast.success('Gasto rechazado');
      setRefresh(r => r + 1);
      setRejectOpen(false); setRejectionReason(''); setRejectTarget(null);
    } catch (e: unknown) { toast.error((e as { message?: string })?.message ?? 'Error al rechazar'); }
    setRejecting(false);
  };

  const handleSubmitForApproval = async (expense: Expense) => {
    setSubmitting(expense.id);
    try {
      await submitExpense({ id: expense.id });
      toast.success('Enviado a aprobación');
      setRefresh(r => r + 1);
    } catch (e: unknown) { toast.error((e as { message?: string })?.message ?? 'Error al enviar'); }
    setSubmitting(null);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteExpense({ id: deleteTarget.id });
      toast.success('Gasto eliminado');
      setRefresh(r => r + 1); setDeleteTarget(null);
    } catch (e: unknown) { toast.error((e as { message?: string })?.message ?? 'Error al eliminar'); }
    setDeleting(false);
  };

  const handleUpdateExpense = useCallback((id: string, changes: Partial<Expense>) => {
    setExpenses(prev => prev.map(e => e.id === id ? { ...e, ...changes } : e));
    setDetailExpense(prev => prev?.id === id ? { ...prev, ...changes } : prev);
  }, []);

  const activeFunds = useMemo(() => funds.filter(f => f.status === 'Activo'), [funds]);

  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
            <ReceiptText className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-bold">Comprobación de Gastos</h1>
            <p className="text-xs text-muted-foreground">{isFinance ? 'Todos los gastos' : 'Mis gastos'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setRefresh(r => r + 1)} className="gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /><span className="hidden sm:inline">Actualizar</span>
          </Button>
          <Button size="sm" onClick={() => { setEditExpense(null); setFormOpen(true); }} className="gap-1.5">
            <Plus className="w-3.5 h-3.5" /> Nuevo gasto
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { icon: <DollarSign className="w-4 h-4 text-muted-foreground" />, label: 'Total este mes', value: fmt(totalThisMonth), sub: `${thisMonth.length} gasto${thisMonth.length !== 1 ? 's' : ''}` },
          { icon: <Clock className="w-4 h-4 text-amber-500" />, label: 'Pendientes', value: String(pendingCount), sub: 'Por aprobar' },
          { icon: <CheckCircle className="w-4 h-4 text-emerald-500" />, label: 'Aprobados', value: String(approvedCount), sub: 'Este mes' },
        ].map(c => (
          <Card key={c.label} className="border-border">
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2 mb-2">{c.icon}<span className="text-xs text-muted-foreground">{c.label}</span></div>
              <div className="text-xl font-bold">{c.value}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">{c.sub}</div>
            </CardContent>
          </Card>
        ))}
        <Card className={`border-border transition-colors ${isFinanceRole ? 'cursor-pointer hover:border-primary/40 hover:bg-primary/5' : ''}`}
          onClick={() => isFinanceRole && setPettyCashOpen(true)}>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2 mb-2">
              <Wallet className="w-4 h-4 text-primary" />
              <span className="text-xs text-muted-foreground">Caja chica</span>
              {isFinanceRole && <span className="ml-auto text-[10px] text-primary font-semibold">Gestionar →</span>}
            </div>
            <div className="text-xl font-bold">{isFinanceRole ? fmt(cashBalance) : '—'}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">Saldo disponible</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input placeholder="Buscar..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-8 text-sm" />
        </div>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="h-8 w-44 text-xs"><SelectValue placeholder="Todos los estatus" /></SelectTrigger>
          <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={filterCategory} onValueChange={setFilterCategory}>
          <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder="Categoría" /></SelectTrigger>
          <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={filterMethod} onValueChange={setFilterMethod}>
          <SelectTrigger className="h-8 w-40 text-xs"><SelectValue placeholder="Método de pago" /></SelectTrigger>
          <SelectContent>{PAYMENT_METHODS.map(m => <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>)}</SelectContent>
        </Select>
        {(filterStatus || filterCategory || filterMethod) && (
          <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground"
            onClick={() => { setFilterStatus(''); setFilterCategory(''); setFilterMethod(''); }}>
            Limpiar
          </Button>
        )}
      </div>

      {/* Table */}
      <div className="border border-border rounded-xl overflow-hidden bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {['#', 'Fecha', 'Descripción', 'Categoría', 'Método', 'Monto', 'Centro de costos', 'Estatus', 'Acciones'].map((h, i) => (
                  <th key={h} className={`px-4 py-2.5 text-xs font-semibold text-muted-foreground ${i >= 7 ? 'text-right' : 'text-left'} ${i === 3 ? 'hidden md:table-cell' : ''} ${i === 4 || i === 6 ? 'hidden lg:table-cell' : ''}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-border/50">
                    {Array.from({ length: 9 }).map((_, j) => (
                      <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-16 text-center">
                    <ReceiptText className="w-8 h-8 mx-auto mb-2 text-muted-foreground/40" />
                    <p className="text-sm text-muted-foreground">No hay gastos registrados</p>
                    <p className="text-xs text-muted-foreground/60 mt-0.5">Crea un nuevo gasto con el botón de arriba</p>
                  </td>
                </tr>
              ) : filtered.map(expense => (
                <tr key={expense.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors cursor-pointer" onClick={() => { setDetailExpense(expense); setDetailOpen(true); }}>
                  <td className="px-4 py-3 text-xs text-muted-foreground font-mono">{expense.expenseNumber ?? '—'}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(expense.expenseDate)}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-sm truncate max-w-[200px]">{expense.description ?? '—'}</div>
                    <div className="flex items-center gap-2 flex-wrap mt-0.5">
                      {expense.projectCode && <span className="text-[11px] text-muted-foreground">{expense.projectCode}</span>}
                      {expense.lineItemCount > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                          {expense.lineItemCount} partida{expense.lineItemCount !== 1 ? 's' : ''}
                        </span>
                      )}
                      {expense.lineItemCount === 0 && expense.receipt && expense.receipt.length > 0 && (
                        <a href={expense.receipt[0].url} target="_blank" rel="noopener noreferrer"
                          className="text-[11px] text-primary hover:underline">📎 comprobante</a>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell text-xs text-muted-foreground">{expense.category ?? '—'}</td>
                  <td className="px-4 py-3 hidden lg:table-cell text-xs text-muted-foreground">{expense.paymentMethod ?? '—'}</td>
                  <td className="px-4 py-3 text-right font-semibold text-sm whitespace-nowrap">{fmt(expense.amount, expense.currency ?? 'MXN')}</td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    <span className="text-xs text-muted-foreground truncate block max-w-[130px]">{expense.costCenter ?? '—'}</span>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={expense.status} />
                    {expense.status === 'Rechazado' && expense.rejectionReason && (
                      <p className="text-[11px] text-muted-foreground mt-0.5 truncate max-w-[120px]" title={expense.rejectionReason}>
                        {expense.rejectionReason}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-0.5">
                      {expense.status === 'Borrador' && (expense.createdBy === user?.email || isFinanceRole) && (
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Editar"
                          onClick={() => { setEditExpense(expense); setFormOpen(true); }}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      {expense.status === 'Borrador' && expense.createdBy === user?.email && (
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-primary" title="Enviar a aprobación"
                          disabled={submitting === expense.id} onClick={() => handleSubmitForApproval(expense)}>
                          <Send className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      {expense.status === 'Enviado a aprobación' && canApprove && (
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-emerald-600" title="Aprobar"
                          disabled={approving === expense.id} onClick={() => handleApprove(expense)}>
                          <CheckCircle className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      {expense.status === 'Enviado a aprobación' && canApprove && (
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" title="Rechazar"
                          onClick={() => { setRejectTarget(expense); setRejectOpen(true); }}>
                          <XCircle className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      {expense.status === 'Borrador' && (expense.createdBy === user?.email || user?.role === 'Owner' || user?.role === 'Socio') && (
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive/50 hover:text-destructive" title="Eliminar"
                          onClick={() => setDeleteTarget(expense)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && filtered.length > 0 && (
          <div className="px-4 py-2 border-t border-border/50 text-xs text-muted-foreground text-right">
            {filtered.length} gasto{filtered.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>

      {/* Expense form */}
      <ExpenseFormSheet
        open={formOpen}
        expense={editExpense}
        funds={activeFunds}
        canApprove={canApprove}
        userEmail={user?.email ?? ''}
        isFinanceRole={isFinanceRole}
        onSaved={() => setRefresh(r => r + 1)}
        onClose={() => { setFormOpen(false); setRefresh(r => r + 1); }}
      />

      {/* Reject dialog */}
      <Dialog open={rejectOpen} onOpenChange={v => { if (!v) { setRejectOpen(false); setRejectionReason(''); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <XCircle className="w-4 h-4 text-destructive" /> Rechazar gasto
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="bg-muted/50 rounded-lg px-3 py-2 text-sm">
              <span className="font-medium">{rejectTarget?.description}</span>
              <span className="text-muted-foreground"> — {fmt(rejectTarget?.amount, rejectTarget?.currency ?? 'MXN')}</span>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Motivo de rechazo *</Label>
              <Textarea value={rejectionReason} onChange={e => setRejectionReason(e.target.value)}
                placeholder="Explica el motivo..." className="text-sm min-h-[80px] resize-none" autoFocus />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" size="sm" onClick={() => setRejectOpen(false)} disabled={rejecting}>Cancelar</Button>
            <Button variant="destructive" size="sm" onClick={handleReject} disabled={rejecting || !rejectionReason.trim()}>
              {rejecting ? 'Rechazando...' : 'Rechazar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={v => { if (!v) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este gasto?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará permanentemente "<strong>{deleteTarget?.description}</strong>". Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-destructive hover:bg-destructive/90">
              {deleting ? 'Eliminando...' : 'Eliminar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Petty cash dialog */}
      {isFinanceRole && (
        <PettyCashDialog open={pettyCashOpen} onClose={() => setPettyCashOpen(false)}
          funds={funds} onRefresh={loadFunds} />
      )}

      {/* Expense detail dialog */}
      <ExpenseDetailDialog
        expense={detailExpense}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        canApprove={canApprove}
        userEmail={user?.email ?? ''}
        isFinanceRole={isFinanceRole}
        onEdit={(exp) => { setDetailOpen(false); setEditExpense(exp); setFormOpen(true); }}
        onUpdate={handleUpdateExpense}
        onRefreshList={() => setRefresh(r => r + 1)}
      />
    </div>
  );
}

// ── Petty Cash Dialog ─────────────────────────────────────────────────────────
function PettyCashDialog({ open, onClose, funds, onRefresh }: {
  open: boolean; onClose: () => void; funds: Fund[]; onRefresh: () => void;
}) {
  const [newFundOpen, setNewFundOpen] = useState(false);
  const [replenishTarget, setReplenishTarget] = useState<Fund | null>(null);
  const [replenishAmount, setReplenishAmount] = useState('');
  const [saving, setSaving] = useState(false);
  const [newFund, setNewFund] = useState({ fundName: '', initialAmount: '', costCenter: '' });

  const handleReplenish = async () => {
    if (!replenishTarget || !replenishAmount) return;
    setSaving(true);
    try {
      await savePettyCashFund({ id: replenishTarget.id, action: 'replenish', replenishAmount: parseFloat(replenishAmount) });
      toast.success('Fondo repuesto correctamente');
      setReplenishTarget(null); setReplenishAmount(''); onRefresh();
    } catch (e: unknown) { toast.error((e as { message?: string })?.message ?? 'Error'); }
    setSaving(false);
  };

  const handleNewFund = async () => {
    if (!newFund.fundName || !newFund.initialAmount) return;
    setSaving(true);
    try {
      await savePettyCashFund({ action: 'save', fundName: newFund.fundName, initialAmount: parseFloat(newFund.initialAmount), costCenter: newFund.costCenter || undefined });
      toast.success('Fondo creado');
      setNewFundOpen(false); setNewFund({ fundName: '', initialAmount: '', costCenter: '' }); onRefresh();
    } catch (e: unknown) { toast.error((e as { message?: string })?.message ?? 'Error'); }
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Wallet className="w-4 h-4 text-primary" /> Fondos de Caja Chica
          </DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto pr-1 space-y-3">
          <div className="space-y-3">
            {funds.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No hay fondos configurados</p>
            ) : funds.map(fund => (
              <div key={fund.id} className="border border-border rounded-xl p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold text-sm">{fund.fundName ?? '—'}</div>
                    {fund.costCenter && <div className="text-xs text-muted-foreground">{fund.costCenter}</div>}
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full border ${fund.status === 'Activo' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-muted text-muted-foreground border-transparent'}`}>
                    {fund.status}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-muted-foreground mb-0.5">Saldo actual</div>
                    <div className="text-lg font-bold">{fmt(fund.currentBalance)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-0.5">Fondo inicial</div>
                    <div className="text-sm font-medium text-muted-foreground">{fmt(fund.initialAmount)}</div>
                  </div>
                </div>
                {fund.lastReplenishmentDate && (
                  <p className="text-xs text-muted-foreground">Última reposición: {fmtDate(fund.lastReplenishmentDate)}</p>
                )}
                {fund.status === 'Activo' && (
                  replenishTarget?.id === fund.id ? (
                    <div className="flex items-center gap-2">
                      <Input type="number" placeholder="Monto a reponer" value={replenishAmount}
                        onChange={e => setReplenishAmount(e.target.value)} className="h-8 text-sm" autoFocus />
                      <Button size="sm" className="h-8 flex-shrink-0" onClick={handleReplenish} disabled={saving || !replenishAmount}>
                        {saving ? '...' : 'Reponer'}
                      </Button>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 flex-shrink-0"
                        onClick={() => { setReplenishTarget(null); setReplenishAmount(''); }}>×</Button>
                    </div>
                  ) : (
                    <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={() => setReplenishTarget(fund)}>
                      <ArrowUp className="w-3.5 h-3.5" /> Reponer fondo
                    </Button>
                  )
                )}
              </div>
            ))}
          </div>

          {!newFundOpen ? (
            <Button variant="outline" size="sm" className="gap-1.5 w-full" onClick={() => setNewFundOpen(true)}>
              <Plus className="w-3.5 h-3.5" /> Nuevo fondo
            </Button>
          ) : (
            <div className="border border-border rounded-xl p-4 space-y-3">
            <p className="text-sm font-semibold">Nuevo fondo de caja chica</p>
            <div className="space-y-1.5">
              <Label className="text-xs">Nombre *</Label>
              <Input value={newFund.fundName} onChange={e => setNewFund(p => ({ ...p, fundName: e.target.value }))} placeholder="Ej: Caja chica oficina" className="h-8 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Monto inicial *</Label>
                <Input type="number" value={newFund.initialAmount} onChange={e => setNewFund(p => ({ ...p, initialAmount: e.target.value }))} placeholder="0.00" className="h-8 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Centro de costos</Label>
                <Select value={newFund.costCenter} onValueChange={v => setNewFund(p => ({ ...p, costCenter: v }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                  <SelectContent>
                    {COST_CENTERS.map(cc => <SelectItem key={cc} value={cc} className="text-xs">{cc}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setNewFundOpen(false)} disabled={saving}>Cancelar</Button>
              <Button size="sm" onClick={handleNewFund} disabled={saving || !newFund.fundName || !newFund.initialAmount}>
                {saving ? 'Creando...' : 'Crear fondo'}
              </Button>
            </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
