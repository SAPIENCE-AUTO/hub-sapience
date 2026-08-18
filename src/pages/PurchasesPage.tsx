import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from 'zite-auth-sdk';
import { getPurchaseOrders, approvePurchaseOrder, deletePurchaseOrder, generatePoPdf, submitPurchaseOrder, rejectPurchaseOrder, sendPoEmail, preparePoEmail, GetPurchaseOrdersOutputType } from 'zite-endpoints-sdk';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Plus, Search, ShoppingCart, FileText, Loader2, Mail, CheckCircle2, Trash2, ChevronDown, X, Send, XCircle, AlertTriangle, Clock, Pencil, Ban, Database, AlertCircle, Archive } from 'lucide-react';
import { toast } from 'sonner';
import POFormSheet from '../components/purchases/POFormSheet';
import PODetailSheet from '../components/purchases/PODetailSheet';
import { useProject } from '@/context/ProjectContext';
import { useRealtimePurchaseOrders } from '@/hooks/useRealtimePurchaseOrders';
import { CATEGORIES } from '../lib/constants';
import { fmtCurrency } from '../lib/format';

type PO = GetPurchaseOrdersOutputType['pos'][0];
type Supplier = GetPurchaseOrdersOutputType['suppliers'][0];

const POST_APPROVAL = ['Aprobada', 'Factura recibida', 'Factura validada', 'Pago programado', 'Pagada'];

const STATUS_STYLES: Record<string, string> = {
  'Borrador': 'bg-muted text-muted-foreground',
  'Enviada a aprobación': 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
  'Aprobada': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  'Factura recibida': 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  'Factura validada': 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
  'Pago programado': 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
  'Pagada': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  'Cancelada': 'bg-destructive/10 text-destructive',
};
const CAT_STYLES: Record<string, string> = {
  'Reclutamiento e Incentivos': 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300',
  'Logística': 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-300',
  'Moderaciones': 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950 dark:text-purple-300',
  'Management': 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300',
  'Otros': 'bg-muted text-muted-foreground border-border',
};

function fmtDate(d?: string) {
  if (!d) return '—';
  return new Date(d.split('T')[0] + 'T12:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtDateTime(d?: string) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ── Stats bar ─────────────────────────────────────────────────────────────────
function StatsBar({ pos, userLevel }: { pos: PO[]; userLevel: string }) {
  const isSocios = userLevel === 'Socios';
  const committed = pos.filter(p => p.status !== 'Cancelada').reduce((s, p) => s + (p.totalAmount ?? 0), 0);
  const pending = pos.filter(p => p.status === 'Enviada a aprobación').length;
  const rejected = pos.filter(p => p.status === 'Borrador' && !!p.rejectionReason).length;
  const paid = pos.filter(p => (p.enrichedStatus ?? p.status) === 'Pagada').reduce((s, p) => s + (p.totalAmount ?? 0), 0);

  const allStats = [
    { label: 'Total OCs', value: pos.length, sub: `Nivel: ${userLevel}`, color: 'text-foreground' },
    { label: 'Monto comprometido', value: fmtCurrency(committed), sub: 'OCs activas', color: 'text-primary' },
    { label: 'Pendientes de aprobación', value: pending, sub: 'Enviadas a aprobación', color: pending > 0 ? 'text-amber-600' : 'text-muted-foreground' },
    { label: 'Devueltas para corrección', value: rejected, sub: rejected > 0 ? 'Requieren atención' : (isSocios ? `Pagado: ${fmtCurrency(paid)}` : 'Sin devueltas'), color: rejected > 0 ? 'text-destructive' : 'text-muted-foreground' },
  ];
  const stats = isSocios ? allStats : allStats.slice(2);

  return (
    <div className={`grid gap-4 mb-6 ${isSocios ? 'grid-cols-4' : 'grid-cols-2'}`}>
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

// ── Table row ─────────────────────────────────────────────────────────────────
function PORow({ po, onView, onPdfGenerated, selected, onToggle, showActions = true, showAmounts = true }: {
  po: PO; onView: (p: PO) => void; onPdfGenerated: (id: string, url: string) => void;
  selected: boolean; onToggle: () => void; showActions?: boolean; showAmounts?: boolean;
}) {
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const isRejected = po.status === 'Borrador' && !!po.rejectionReason;

  const handleGeneratePdf = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setGeneratingPdf(true);
    try {
      const res = await generatePoPdf({ id: po.id });
      if (res.pdfUrl) onPdfGenerated(po.id, res.pdfUrl);
      toast.success('PDF generado correctamente');
    } catch (err: unknown) { toast.error((err as Error).message ?? 'Error al generar PDF'); }
    setGeneratingPdf(false);
  };

  const isCancelled = po.status === 'Cancelada';

  return (
    <tr className={`border-b transition-colors cursor-pointer ${isCancelled ? 'border-l-4 border-l-destructive bg-destructive/5 hover:bg-destructive/10' : 'border-border hover:bg-muted/30'} ${selected ? 'bg-primary/5' : ''} ${po.readOnly ? 'opacity-75' : ''}`} onClick={() => onView(po)}>
      <td className="pl-4 pr-2 py-2.5 w-8" onClick={e => e.stopPropagation()}>
        <Checkbox checked={selected} onCheckedChange={onToggle} className="block" />
      </td>
      <td className="px-4 py-2.5 whitespace-nowrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm font-mono font-medium text-muted-foreground">#{po.poNumber}</span>
          {isRejected && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-destructive/10 text-destructive border border-destructive/20 leading-none">
              <XCircle className="w-2.5 h-2.5" /> Devuelta
            </span>
          )}
          {po.orderType === 'Anticipo' && <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300 border border-orange-200 dark:border-orange-800 leading-none">Anticipo</span>}
          {po.orderType === 'Cierre' && <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300 border border-sky-200 dark:border-sky-800 leading-none">Cierre</span>}
          {po.origen === 'Migrada' && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground border border-border leading-none">
              <Archive className="w-2.5 h-2.5" /> Migrada
            </span>
          )}
          {po.readOnly && <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground border border-border leading-none">Ver</span>}
        </div>
      </td>
      <td className="px-4 py-2.5"><p className="text-sm text-muted-foreground whitespace-nowrap">{po.projectCode ?? '—'}</p></td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium whitespace-nowrap leading-snug">{po.supplierName ?? '—'}</p>
          {po.supplierName && (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="shrink-0 cursor-default">
                    {po.supplierInDb
                      ? <Database className="w-3 h-3 text-muted-foreground/60" />
                      : <AlertCircle className="w-3 h-3 text-amber-500" />
                    }
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  {po.supplierInDb ? 'Proveedor registrado en BD' : 'Proveedor no registrado en BD'}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
        {isRejected && po.rejectionReason && (
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <p className="text-xs text-destructive/70 truncate max-w-[160px] mt-0.5 cursor-help leading-tight">↩ {po.rejectionReason}</p>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs" side="bottom">
                <p className="font-semibold mb-1">Motivo del rechazo:</p>
                <p>{po.rejectionReason}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </td>
      <td className="px-4 py-2.5 max-w-[200px]"><p className="text-sm text-muted-foreground truncate">{po.serviceDescription ?? '—'}</p></td>
      <td className="px-4 py-2.5">
        {po.category ? (
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border whitespace-nowrap ${CAT_STYLES[po.category] ?? 'bg-muted text-muted-foreground border-border'}`}>{po.category}</span>
        ) : <span className="text-muted-foreground text-sm">—</span>}
      </td>
      {showAmounts && <td className="px-4 py-2.5 text-sm font-semibold text-right tabular-nums whitespace-nowrap">{fmtCurrency(po.totalAmount, po.currency)}</td>}
      {showAmounts && <td className="px-4 py-2.5 text-sm text-muted-foreground text-center">{po.currency ?? 'MXN'}</td>}
      {showActions && (
        <>
          <td className="px-4 py-2.5" onClick={e => e.stopPropagation()}>
            {(po.status === 'Borrador' || po.status === 'Enviada a aprobación') ? (
              <span className="text-muted-foreground text-sm">—</span>
            ) : po.pdfUrl ? (
              <a href={po.pdfUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950 transition-colors">
                <FileText className="w-3.5 h-3.5" /> Ver
              </a>
            ) : (
              <button onClick={handleGeneratePdf} disabled={generatingPdf} className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50">
                {generatingPdf ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
                {generatingPdf ? 'Creando...' : 'Crear'}
              </button>
            )}
          </td>
          <td className="px-4 py-2.5" onClick={e => e.stopPropagation()}>
            {(po.status === 'Borrador' || po.status === 'Enviada a aprobación') ? (
              <span className="text-muted-foreground text-sm">—</span>
            ) : po.emailSentAt ? (
              <TooltipProvider delayDuration={200}><Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 cursor-default">
                    <Mail className="w-3 h-3" /> Enviado
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs"><p>A: {po.emailSentTo}</p><p>{fmtDateTime(po.emailSentAt)}</p></TooltipContent>
              </Tooltip></TooltipProvider>
            ) : <span className="text-muted-foreground text-sm">—</span>}
          </td>
        </>
      )}
      <td className="px-4 py-2.5 text-sm text-muted-foreground whitespace-nowrap">{fmtDate(po.issueDate)}</td>
      <td className="px-4 py-2.5">
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap ${STATUS_STYLES[po.enrichedStatus ?? po.status ?? ''] ?? 'bg-muted text-muted-foreground'}`}>
          {po.enrichedStatus ?? po.status ?? 'Borrador'}
        </span>
      </td>
      <td className="px-4 py-2.5 text-xs text-muted-foreground"><p className="whitespace-nowrap">{po.createdBy?.split('@')[0] ?? '—'}</p></td>
      <td className="px-4 py-2.5"><p className="text-sm text-muted-foreground whitespace-nowrap">{po.billingEntity ?? '—'}</p></td>
    </tr>
  );
}

// ── POTable ───────────────────────────────────────────────────────────────────
function POTable({ pos, onView, onPdfGenerated, selectedIds, onToggle, onToggleBatch, showActions = true, showAmounts = true, emptyText }: {
  pos: PO[]; onView: (p: PO) => void; onPdfGenerated: (id: string, url: string) => void;
  selectedIds: Set<string>; onToggle: (id: string) => void;
  onToggleBatch: (ids: string[], add: boolean) => void;
  showActions?: boolean; showAmounts?: boolean; emptyText?: string;
}) {
  const allSelected = pos.length > 0 && pos.every(p => selectedIds.has(p.id));
  const someSelected = pos.some(p => selectedIds.has(p.id));
  const handleToggleAll = () => {
    if (allSelected) onToggleBatch(pos.map(p => p.id), false);
    else onToggleBatch(pos.map(p => p.id), true);
  };
  const baseH = ['# OC', 'Proyecto', 'Proveedor', 'Descripción', 'Rubro', ...(showAmounts ? ['Monto', 'Moneda'] : [])];
  const tailH = ['Fecha', 'Estatus', 'Creado por', 'Entidad'];
  const headers = showActions ? [...baseH, 'PDF', 'Envío', ...tailH] : [...baseH, ...tailH];
  return (
    <div className="overflow-x-auto">
      <table className={`w-full ${showActions ? 'min-w-[1280px]' : 'min-w-[1060px]'}`}>
        <thead className="bg-muted/40 border-b border-border">
          <tr>
            <th className="pl-4 pr-2 py-2.5 w-8">
              <Checkbox checked={allSelected} onCheckedChange={handleToggleAll} className={someSelected && !allSelected ? 'opacity-60' : ''} />
            </th>
            {headers.map(h => <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {pos.length === 0 ? (
            <tr><td colSpan={headers.length + 1} className="px-4 py-10 text-center text-sm text-muted-foreground">{emptyText ?? 'Sin órdenes en esta sección'}</td></tr>
          ) : (
            pos.map(po => (
              <PORow key={po.id} po={po} onView={onView} onPdfGenerated={onPdfGenerated}
                selected={selectedIds.has(po.id)} onToggle={() => onToggle(po.id)} showActions={showActions} showAmounts={showAmounts} />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Collapsible section group ─────────────────────────────────────────────────
function SectionGroup({ title, icon: Icon, pos, onView, onPdfGenerated, selectedIds, onToggle, onToggleBatch,
  defaultOpen = false, variant = 'default', showActions = true, showAmounts = true, emptyText }: {
  title: string; icon: React.ElementType; pos: PO[];
  onView: (p: PO) => void; onPdfGenerated: (id: string, url: string) => void;
  selectedIds: Set<string>; onToggle: (id: string) => void;
  onToggleBatch: (ids: string[], add: boolean) => void;
  defaultOpen?: boolean; variant?: 'default' | 'danger'; showActions?: boolean; showAmounts?: boolean; emptyText?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const totalAmt = pos.reduce((s, p) => s + (p.totalAmount ?? 0), 0);
  const isDanger = variant === 'danger';
  return (
    <Collapsible open={open} onOpenChange={setOpen}
      className={`rounded-xl overflow-hidden border ${isDanger ? 'border-destructive/30' : 'border-border'}`}>
      <CollapsibleTrigger asChild>
        <button className={`w-full flex items-center gap-3 px-4 py-3 transition-colors text-left ${isDanger ? 'bg-destructive/5 hover:bg-destructive/10' : 'bg-muted/30 hover:bg-muted/50'}`}>
          {isDanger && <div className="w-1 h-5 rounded-full bg-destructive shrink-0" />}
          <Icon className={`w-4 h-4 shrink-0 ${isDanger ? 'text-destructive' : 'text-muted-foreground'}`} />
          <span className={`font-semibold text-sm ${isDanger ? 'text-destructive' : 'text-foreground'}`}>{title}</span>
          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full leading-none ${isDanger ? 'bg-destructive text-destructive-foreground' : 'bg-muted text-muted-foreground border border-border'}`}>
            {pos.length}
          </span>
          {showAmounts && <span className="text-xs text-muted-foreground font-medium">{fmtCurrency(totalAmt)}</span>}
          <ChevronDown className={`w-4 h-4 text-muted-foreground ml-auto transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <POTable pos={pos} onView={onView} onPdfGenerated={onPdfGenerated} selectedIds={selectedIds}
          onToggle={onToggle} onToggleBatch={onToggleBatch} showActions={showActions} showAmounts={showAmounts} emptyText={emptyText} />
        {pos.length > 0 && (
          <div className="px-4 py-2 border-t border-border bg-muted/20 text-xs text-muted-foreground">
            {pos.length} OC{pos.length !== 1 ? 's' : ''}{showAmounts ? ` · Total: ${fmtCurrency(totalAmt)}` : ''}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

// ── Floating bar ──────────────────────────────────────────────────────────────
function FloatingBar({ selectedIds, pos, canApprove, onDelete, onApprove, onSubmit, onPdfsGenerated, onReject, onSendEmail, onClear }: {
  selectedIds: Set<string>; pos: PO[]; canApprove: boolean;
  onDelete: () => void; onApprove: () => Promise<void>; onSubmit: () => Promise<void>;
  onPdfsGenerated: (updates: Record<string, string>) => void;
  onReject: (comments: string) => Promise<void>; onSendEmail: () => Promise<void>; onClear: () => void;
}) {
  const selected = pos.filter(p => selectedIds.has(p.id));
  const noPdfCount = selected.filter(p => !p.pdfUrl && p.status !== 'Borrador' && p.status !== 'Enviada a aprobación').length;
  const approvableCount = selected.filter(p => p.status === 'Enviada a aprobación').length;
  const submittableCount = selected.filter(p => p.status === 'Borrador' && !p.readOnly).length;
  const emailableCount = selected.filter(p => POST_APPROVAL.includes(p.enrichedStatus ?? p.status ?? '') && p.hasPdf).length;
  const [generatingPdfs, setGeneratingPdfs] = useState(false);
  const [pdfProgress, setPdfProgress] = useState(0);
  const [approvingBulk, setApprovingBulk] = useState(false);
  const [submittingBulk, setSubmittingBulk] = useState(false);
  const [sendingEmails, setSendingEmails] = useState(false);
  const [emailProgress, setEmailProgress] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectComments, setRejectComments] = useState('');
  const [rejectingBulk, setRejectingBulk] = useState(false);

  const handleGeneratePdfs = async () => {
    const targets = selected.filter(p => !p.pdfUrl);
    if (!targets.length) return;
    setGeneratingPdfs(true); setPdfProgress(0);
    const updates: Record<string, string> = {};
    for (let i = 0; i < targets.length; i++) {
      try { const res = await generatePoPdf({ id: targets[i].id }); if (res.pdfUrl) updates[targets[i].id] = res.pdfUrl; } catch { /* skip */ }
      setPdfProgress(i + 1);
    }
    onPdfsGenerated(updates);
    toast.success(`${Object.keys(updates).length} PDF(s) generado(s)`);
    setGeneratingPdfs(false);
  };
  const handleApprove = async () => { setApprovingBulk(true); await onApprove(); setApprovingBulk(false); };
  const handleSubmit = async () => { setSubmittingBulk(true); await onSubmit(); setSubmittingBulk(false); };
  const handleSendEmail = async () => { setSendingEmails(true); setEmailProgress(0); await onSendEmail(); setSendingEmails(false); setEmailProgress(0); };
  const handleRejectConfirm = async () => {
    if (!rejectComments.trim()) return;
    setRejectingBulk(true);
    await onReject(rejectComments.trim());
    setRejectingBulk(false); setRejectDialogOpen(false); setRejectComments('');
  };

  return (
    <>
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-card border border-border shadow-xl rounded-2xl px-4 py-2.5 animate-in slide-in-from-bottom-4 duration-200">
        <span className="text-sm font-semibold text-foreground pr-1 border-r border-border mr-1">{selectedIds.size} seleccionada{selectedIds.size !== 1 ? 's' : ''}</span>
        <TooltipProvider delayDuration={300}><Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="w-3.5 h-3.5" /> Eliminar
            </Button>
          </TooltipTrigger>
          <TooltipContent className="text-xs">Eliminar {selectedIds.size} OC(s)</TooltipContent>
        </Tooltip></TooltipProvider>
        {noPdfCount > 0 && (
          <TooltipProvider delayDuration={300}><Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 gap-1.5" onClick={handleGeneratePdfs} disabled={generatingPdfs}>
                {generatingPdfs ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
                {generatingPdfs ? `${pdfProgress}/${noPdfCount}` : `PDFs (${noPdfCount})`}
              </Button>
            </TooltipTrigger>
            <TooltipContent className="text-xs">{noPdfCount} OC(s) sin PDF</TooltipContent>
          </Tooltip></TooltipProvider>
        )}
        {submittableCount > 0 && (
          <TooltipProvider delayDuration={300}><Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-sky-600 hover:bg-sky-50 hover:text-sky-700 dark:hover:bg-sky-950" onClick={handleSubmit} disabled={submittingBulk}>
                {submittingBulk ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                Enviar ({submittableCount})
              </Button>
            </TooltipTrigger>
            <TooltipContent className="text-xs">Enviar {submittableCount} OC(s) a aprobación</TooltipContent>
          </Tooltip></TooltipProvider>
        )}
        {emailableCount > 0 && (
          <TooltipProvider delayDuration={300}><Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-primary hover:bg-primary/10" onClick={handleSendEmail} disabled={sendingEmails}>
                {sendingEmails ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
                {sendingEmails ? `${emailProgress}/${emailableCount}` : `Email (${emailableCount})`}
              </Button>
            </TooltipTrigger>
            <TooltipContent className="text-xs">Enviar OC por email al proveedor ({emailableCount} con PDF)</TooltipContent>
          </Tooltip></TooltipProvider>
        )}
        {canApprove && approvableCount > 0 && (
          <>
            <TooltipProvider delayDuration={300}><Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-emerald-950" onClick={handleApprove} disabled={approvingBulk}>
                  {approvingBulk ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  Aprobar ({approvableCount})
                </Button>
              </TooltipTrigger>
              <TooltipContent className="text-xs">Aprobar {approvableCount} OC(s)</TooltipContent>
            </Tooltip></TooltipProvider>
            <TooltipProvider delayDuration={300}><Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-destructive hover:bg-destructive/10" onClick={() => setRejectDialogOpen(true)}>
                  <XCircle className="w-3.5 h-3.5" /> Rechazar ({approvableCount})
                </Button>
              </TooltipTrigger>
              <TooltipContent className="text-xs">Rechazar {approvableCount} OC(s)</TooltipContent>
            </Tooltip></TooltipProvider>
          </>
        )}
        <div className="w-px h-5 bg-border mx-1" />
        <TooltipProvider delayDuration={300}><Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={onClear}><X className="w-3.5 h-3.5" /></Button>
          </TooltipTrigger>
          <TooltipContent className="text-xs">Limpiar selección</TooltipContent>
        </Tooltip></TooltipProvider>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar {selectedIds.size} OC(s)?</AlertDialogTitle>
            <AlertDialogDescription>Esta acción no se puede deshacer.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmDelete(false); onDelete(); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Sí, eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={rejectDialogOpen} onOpenChange={v => { if (!v) { setRejectDialogOpen(false); setRejectComments(''); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2 text-destructive"><XCircle className="w-4 h-4" /> Rechazar {approvableCount} OC(s)</DialogTitle></DialogHeader>
          <div className="py-2 space-y-3">
            <p className="text-sm text-muted-foreground">Las OCs volverán a <strong>Borrador</strong> para revisión de sus creadores.</p>
            <div className="space-y-1.5">
              <Label className="text-xs">Motivo del rechazo <span className="text-destructive">*</span></Label>
              <Textarea rows={3} className="resize-none text-sm" placeholder="Explica el motivo del rechazo..." value={rejectComments} onChange={e => setRejectComments(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setRejectDialogOpen(false); setRejectComments(''); }} disabled={rejectingBulk}>Cancelar</Button>
            <Button onClick={handleRejectConfirm} disabled={rejectingBulk || !rejectComments.trim()} className="gap-1.5 bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {rejectingBulk ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
              {rejectingBulk ? 'Rechazando...' : 'Rechazar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function PurchasesPage() {
  const { user } = useAuth();
  const { projects } = useProject();
  const [pos, setPos] = useState<PO[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [billingEntities, setBillingEntities] = useState<GetPurchaseOrdersOutputType['billingEntities']>([]);
  const [loading, setLoading] = useState(true);
  const [userLevel, setUserLevel] = useState('Creador');
  const [userCostCenters, setUserCostCenters] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<'en_proceso' | 'aprobadas' | 'pending' | 'canceladas'>('en_proceso');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [origenFilter, setOrigenFilter] = useState<'' | 'Sistema' | 'Migrada'>('');
  const [projectSearch, setProjectSearch] = useState('');
  const [projectFilter, setProjectFilter] = useState<string[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingPO, setEditingPO] = useState<PO | null>(null);
  const [detailPO, setDetailPO] = useState<PO | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [approveTarget, setApproveTarget] = useState<PO | null>(null);
  const [approving, setApproving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }, []);
  const toggleBatch = useCallback((ids: string[], add: boolean) => {
    setSelectedIds(prev => { const n = new Set(prev); if (add) ids.forEach(id => n.add(id)); else ids.forEach(id => n.delete(id)); return n; });
  }, []);
  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const load = async () => {
    try {
      const d = await getPurchaseOrders({});
      setPos(d.pos); setSuppliers(d.suppliers); setBillingEntities(d.billingEntities);
      setUserLevel(d.userLevel); setUserCostCenters(d.userCostCenters);
    } catch { toast.error('Error al cargar las OCs'); }
    setLoading(false);
    clearSelection();
  };

  useEffect(() => { load(); }, []);

  // Real-time updates via Ably — instant reload when any user changes a PO
  useRealtimePurchaseOrders({
    userEmail: user?.email ?? '',
    enabled: !!user,
    onChanged: () => {
      if (document.visibilityState !== 'visible' || formOpen) return;
      getPurchaseOrders({}).then(d => {
        setPos(d.pos);
        setUserLevel(d.userLevel);
        setUserCostCenters(d.userCostCenters);
      }).catch(() => { /* silent */ });
    },
  });

  // Fallback polling every 2 min — catches any missed real-time events
  useEffect(() => {
    const poll = async () => {
      if (document.visibilityState !== 'visible' || formOpen) return;
      try {
        const d = await getPurchaseOrders({});
        setPos(d.pos);
        setUserLevel(d.userLevel);
        setUserCostCenters(d.userCostCenters);
      } catch { /* silent */ }
    };
    const id = setInterval(poll, 300000);
    return () => clearInterval(id);
  }, [formOpen]);

  useEffect(() => { clearSelection(); setApprovedStatusFilter(''); }, [search, categoryFilter, projectFilter, origenFilter, activeTab]);

  const canApprove = userLevel === 'Aprobador' || userLevel === 'Finanzas' || userLevel === 'Socios';
  const canCreate = userLevel !== 'Visor';
  const isSocios = userLevel === 'Socios';

  const baseFiltered = useMemo(() => {
    let r = pos;
    if (categoryFilter && categoryFilter !== ' ') r = r.filter(p => p.category === categoryFilter);
    if (projectFilter.length > 0) r = r.filter(p => projectFilter.includes(p.projectCode ?? ''));
    if (origenFilter) r = r.filter(p => (p.origen ?? 'Sistema') === origenFilter);
    if (search) {
      const q = search.toLowerCase();
      // El número de OC lleva prefijo + ceros a la izquierda (ej. "RI-03293").
      // Buscar solo dígitos (o el prefijo con el número "natural", sin ceros,
      // ej. "RI-3293") no hacía match porque el 0 del padding rompe la
      // substring — se compara también solo-dígitos contra solo-dígitos,
      // ignorando prefijo y padding.
      const qDigits = q.replace(/\D/g, '');
      r = r.filter(p => {
        const poNumberStr = String(p.poNumber).toLowerCase();
        const poNumberMatches = poNumberStr.includes(q) || (qDigits.length > 0 && poNumberStr.replace(/\D/g, '').includes(qDigits));
        return poNumberMatches || p.supplierName?.toLowerCase().includes(q) || p.projectCode?.toLowerCase().includes(q) || p.category?.toLowerCase().includes(q);
      });
    }
    return r;
  }, [pos, search, categoryFilter, projectFilter, origenFilter]);

  // En proceso groups
  const devueltas = useMemo(() => baseFiltered.filter(p => p.status === 'Borrador' && !!p.rejectionReason), [baseFiltered]);
  const borradores = useMemo(() => baseFiltered.filter(p => p.status === 'Borrador' && !p.rejectionReason), [baseFiltered]);
  const enviadasAprobacion = useMemo(() => baseFiltered.filter(p => p.status === 'Enviada a aprobación'), [baseFiltered]);
  // Aprobadas groups
  const postApproval = useMemo(() => baseFiltered.filter(p => POST_APPROVAL.includes(p.enrichedStatus ?? p.status ?? '')), [baseFiltered]);
  const sortByDate = (a: PO, b: PO) => (b.issueDate ?? '').localeCompare(a.issueDate ?? '');
  const [approvedStatusFilter, setApprovedStatusFilter] = useState('');
  const porEnviar = useMemo(() => postApproval.filter(p => !p.emailSentAt).sort(sortByDate), [postApproval]);
  const enviadasProveedor = useMemo(() => postApproval.filter(p => !!p.emailSentAt).sort(sortByDate), [postApproval]);
  // Pending approver tab
  const pendingApproval = useMemo(() => baseFiltered.filter(p => p.status === 'Enviada a aprobación'), [baseFiltered]);
  const pendingCount = useMemo(() => pos.filter(p => p.status === 'Enviada a aprobación').length, [pos]);
  // Canceladas
  const canceladas = useMemo(() => baseFiltered.filter(p => p.status === 'Cancelada'), [baseFiltered]);
  const canceladasCount = useMemo(() => pos.filter(p => p.status === 'Cancelada').length, [pos]);

  // Auto-mark visible ODCs as seen when the user views them, so the sidebar badge clears
  useEffect(() => {
    const visibleIds: string[] = [];
    if (activeTab === 'canceladas') {
      visibleIds.push(...canceladas.map(p => p.id));
    } else if (activeTab === 'aprobadas') {
      visibleIds.push(...baseFiltered.filter(p => p.status === 'Aprobada').map(p => p.id));
    }
    if (visibleIds.length === 0) return;
    try {
      const seen: string[] = JSON.parse(localStorage.getItem('po-seen-ids') ?? '[]');
      const seenSet = new Set(seen);
      let changed = false;
      visibleIds.forEach(id => { if (!seenSet.has(id)) { seenSet.add(id); changed = true; } });
      if (changed) {
        localStorage.setItem('po-seen-ids', JSON.stringify([...seenSet]));
        window.dispatchEvent(new Event('po-seen-updated'));
      }
    } catch { /* silent */ }
  }, [activeTab, canceladas, baseFiltered]);

  const handleApprove = async () => {
    if (!approveTarget) return;
    setApproving(true);
    try {
      await approvePurchaseOrder({ id: approveTarget.id });
      toast.success(`OC #${approveTarget.poNumber} aprobada`);
      setPos(prev => prev.map(p => p.id === approveTarget.id ? { ...p, status: 'Aprobada', enrichedStatus: 'Aprobada' } : p));
      setDetailPO(prev => prev?.id === approveTarget.id ? { ...prev, status: 'Aprobada', enrichedStatus: 'Aprobada' } : prev);
      await load();
    } catch (e: unknown) { toast.error((e as Error).message ?? 'Error al aprobar'); }
    setApproving(false); setApproveTarget(null);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      await deletePurchaseOrder({ id: deleteId });
      toast.success('OC eliminada');
      setPos(p => p.filter(x => x.id !== deleteId));
      if (detailPO?.id === deleteId) setDetailPO(null);
    } catch (e: unknown) { toast.error((e as Error).message ?? 'Error al eliminar'); }
    setDeleting(false); setDeleteId(null);
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    try {
      await Promise.all(ids.map(id => deletePurchaseOrder({ id })));
      toast.success(`${ids.length} OC(s) eliminada(s)`);
      setPos(prev => prev.filter(p => !selectedIds.has(p.id)));
      clearSelection();
    } catch { toast.error('Error al eliminar algunas OCs'); await load(); }
  };

  const handleBulkApprove = async () => {
    const targets = pos.filter(p => selectedIds.has(p.id) && p.status === 'Enviada a aprobación');
    try {
      await Promise.all(targets.map(p => approvePurchaseOrder({ id: p.id })));
      toast.success(`${targets.length} OC(s) aprobada(s)`);
      await load();
    } catch (e: unknown) { toast.error((e as Error).message ?? 'Error al aprobar algunas OCs'); await load(); }
  };

  const handleBulkSubmit = async () => {
    const targets = pos.filter(p => selectedIds.has(p.id) && p.status === 'Borrador' && !p.readOnly);
    try {
      await Promise.all(targets.map(p => submitPurchaseOrder({ id: p.id })));
      toast.success(`${targets.length} OC(s) enviada(s) a aprobación`);
      await load();
    } catch (e: unknown) { toast.error((e as Error).message ?? 'Error al enviar algunas OCs'); await load(); }
  };

  const handleBulkReject = async (comments: string) => {
    const targets = pos.filter(p => selectedIds.has(p.id) && p.status === 'Enviada a aprobación');
    try {
      await Promise.all(targets.map(p => rejectPurchaseOrder({ id: p.id, comments })));
      toast.success(`${targets.length} OC(s) rechazada(s)`);
      await load();
    } catch (e: unknown) { toast.error((e as Error).message ?? 'Error al rechazar algunas OCs'); await load(); }
  };

  const handleBulkSendEmail = async () => {
    const targets = pos.filter(p => selectedIds.has(p.id) && POST_APPROVAL.includes(p.enrichedStatus ?? p.status ?? '') && p.hasPdf);
    let sent = 0; let failed = 0;
    for (const p of targets) {
      try {
        const draft = await preparePoEmail({ poId: p.id });
        await sendPoEmail({ poId: p.id, recipientEmail: draft.supplierEmail, subject: draft.subject, body: draft.body });
        setPos(prev => prev.map(x => x.id === p.id ? { ...x, emailSentAt: new Date().toISOString(), emailSentTo: draft.supplierEmail } : x));
        sent++;
      } catch { failed++; }
    }
    if (sent > 0) toast.success(`${sent} email${sent !== 1 ? 's' : ''} enviado${sent !== 1 ? 's' : ''} correctamente`);
    if (failed > 0) toast.error(`${failed} email${failed !== 1 ? 's' : ''} no pudo${failed !== 1 ? 'ron' : ''} enviarse`);
  };

  const openNew = () => { setEditingPO(null); setFormOpen(true); };
  const openEdit = (po: PO) => { setDetailPO(null); setEditingPO(po); setFormOpen(true); };
  const filterCats = (userLevel === 'Finanzas' || userLevel === 'Socios') ? CATEGORIES : userCostCenters;
  const hasFilters = search || (categoryFilter && categoryFilter !== ' ') || projectFilter.length > 0 || !!origenFilter;
  const toggleProjectFilter = (code: string) => {
    setProjectFilter(prev => prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]);
  };

  const sectionProps = {
    onView: setDetailPO,
    onPdfGenerated: (id: string, pdfUrl: string) => setPos(prev => prev.map(p => p.id === id ? { ...p, pdfUrl } : p)),
    selectedIds, onToggle: toggleSelect, onToggleBatch: toggleBatch,
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <ShoppingCart className="w-4.5 h-4.5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-bold">Órdenes de Compra</h1>
            <p className="text-xs text-muted-foreground">Nivel: <span className="font-medium text-foreground">{userLevel}</span>{userCostCenters.length > 0 && ` · ${userCostCenters.join(', ')}`}</p>
          </div>
        </div>
        {canCreate && <Button onClick={openNew} className="gap-1.5"><Plus className="w-4 h-4" /> Nueva OC</Button>}
      </div>

      {loading ? (
        <div className="space-y-3">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : (
        <>
          <StatsBar pos={pos} userLevel={userLevel} />

          {/* Filters */}
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <div className="relative flex-1 min-w-[180px] max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input className="pl-9 h-9 text-sm" placeholder="Buscar OC, proveedor..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="h-9 text-sm gap-1.5 font-normal">
                  {projectFilter.length === 0 ? <span className="text-muted-foreground">Todos los proyectos</span> : <><span>Proyectos</span><Badge variant="secondary" className="px-1.5 py-0 text-xs font-semibold">{projectFilter.length}</Badge></>}
                  <ChevronDown className="w-3.5 h-3.5 text-muted-foreground ml-1" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-2" align="start" onInteractOutside={() => setProjectSearch('')}>
                <div className="flex items-center justify-between px-1 pb-1.5 mb-1 border-b border-border">
                  <span className="text-xs font-semibold text-muted-foreground">Filtrar por proyecto</span>
                  {projectFilter.length > 0 && <button onClick={() => setProjectFilter([])} className="text-xs text-primary hover:underline">Limpiar</button>}
                </div>
                <div className="relative mb-1.5">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <Input className="pl-8 h-8 text-sm" placeholder="Buscar proyecto..." value={projectSearch} onChange={e => setProjectSearch(e.target.value)} />
                </div>
                <div className="max-h-56 overflow-y-auto space-y-0.5">
                  {projects.length === 0 && <p className="text-xs text-muted-foreground px-1 py-2">Sin proyectos disponibles</p>}
                  {projects
                    .filter(p => !projectSearch || `${p.projectCode ?? ''} ${p.fullName ?? ''}`.toLowerCase().includes(projectSearch.toLowerCase()))
                    .map(p => (
                      <label key={p.id} className="flex items-center gap-2.5 px-1 py-1.5 rounded hover:bg-muted cursor-pointer">
                        <Checkbox checked={projectFilter.includes(p.projectCode ?? '')} onCheckedChange={() => toggleProjectFilter(p.projectCode ?? '')} className="shrink-0" />
                        <span className="text-sm leading-tight">
                          <span className="font-mono text-xs text-muted-foreground">{p.projectCode}</span>
                          {p.fullName && <span className="text-foreground"> – {p.fullName}</span>}
                        </span>
                      </label>
                    ))
                  }
                  {projects.length > 0 && projectSearch && projects.filter(p => `${p.projectCode ?? ''} ${p.fullName ?? ''}`.toLowerCase().includes(projectSearch.toLowerCase())).length === 0 && (
                    <p className="text-xs text-muted-foreground px-1 py-2">Sin resultados</p>
                  )}
                </div>
              </PopoverContent>
            </Popover>
            {filterCats.length > 1 && (
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="h-9 text-sm w-52"><SelectValue placeholder="Rubro" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value=" ">Todos los rubros</SelectItem>
                  {filterCats.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            {/* Origen filter pills */}
            <div className="flex items-center gap-1 border border-border rounded-lg p-0.5 bg-muted/30">
              {(['', 'Sistema', 'Migrada'] as const).map(val => (
                <button
                  key={val || 'todas'}
                  onClick={() => setOrigenFilter(val)}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors ${origenFilter === val ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {val === '' ? 'Todas' : val}
                </button>
              ))}
            </div>
            {hasFilters && (
              <Button variant="ghost" size="sm" className="h-9 text-xs" onClick={() => { setSearch(''); setCategoryFilter(''); setProjectFilter([]); setOrigenFilter(''); }}>
                Limpiar filtros
              </Button>
            )}
          </div>

          {/* Main tabs */}
          <Tabs value={activeTab} onValueChange={v => setActiveTab(v as typeof activeTab)}>
            <TabsList className="h-9 mb-4">
              <TabsTrigger value="en_proceso" className="text-sm">En proceso</TabsTrigger>
              <TabsTrigger value="aprobadas" className="text-sm">Aprobadas</TabsTrigger>
              {canApprove && (
                <TabsTrigger value="pending" className="text-sm gap-2">
                  Pendientes de aprobación
                  {pendingCount > 0 && <span className="bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">{pendingCount}</span>}
                </TabsTrigger>
              )}
              <TabsTrigger value="canceladas" className="text-sm gap-2">
                Canceladas
                {canceladasCount > 0 && <span className="bg-destructive/15 text-destructive text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">{canceladasCount}</span>}
              </TabsTrigger>
            </TabsList>

            {/* ── En proceso ─────────────────────────────────────── */}
            <TabsContent value="en_proceso" className="space-y-3 mt-0">
              {devueltas.length > 0 && (
                <SectionGroup title="Devueltas para corrección" icon={AlertTriangle}
                  pos={devueltas} variant="danger" showActions={false} showAmounts={isSocios}
                  emptyText="Sin OCs devueltas" {...sectionProps} />
              )}
              <SectionGroup title="Borradores" icon={Pencil} pos={borradores} showActions={false} showAmounts={isSocios}
                emptyText="No hay borradores" {...sectionProps} />
              <SectionGroup title="Enviadas a aprobación" icon={Clock} pos={enviadasAprobacion} showActions={false} showAmounts={isSocios}
                emptyText="No hay OCs enviadas a aprobación" {...sectionProps} />
            </TabsContent>

            {/* ── Aprobadas ──────────────────────────────────────── */}
            <TabsContent value="aprobadas" className="space-y-3 mt-0">
              {/* Status pills */}
              <div className="flex items-center gap-1 border border-border rounded-lg p-0.5 bg-muted/30 w-fit">
                {(['', 'Aprobada', 'Factura recibida', 'Factura validada', 'Pago programado', 'Pagada'] as const).map(val => (
                  <button
                    key={val || 'todas'}
                    onClick={() => setApprovedStatusFilter(val)}
                    className={`px-3 py-1 rounded text-xs font-medium transition-colors ${approvedStatusFilter === val ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    {val === '' ? 'Todas' : val}
                  </button>
                ))}
              </div>
              <SectionGroup title="Por enviar a proveedor" icon={FileText}
                pos={approvedStatusFilter ? porEnviar.filter(p => (p.enrichedStatus ?? p.status) === approvedStatusFilter) : porEnviar}
                showActions emptyText="No hay OCs pendientes de enviar al proveedor" {...sectionProps} />
              <SectionGroup title="Enviadas al proveedor" icon={Mail}
                pos={approvedStatusFilter ? enviadasProveedor.filter(p => (p.enrichedStatus ?? p.status) === approvedStatusFilter) : enviadasProveedor}
                showActions defaultOpen={false} emptyText="No hay OCs enviadas al proveedor" {...sectionProps} />
            </TabsContent>

            {/* ── Canceladas ──────────────────────────────────────── */}
            <TabsContent value="canceladas" className="space-y-3 mt-0">
              <SectionGroup title="Canceladas" icon={XCircle} pos={canceladas} showActions={false} showAmounts={isSocios}
                emptyText="No hay OCs canceladas" {...sectionProps} />
            </TabsContent>

            {/* ── Pendientes de aprobación (approvers) ───────────── */}
            {canApprove && (
              <TabsContent value="pending" className="mt-0">
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                  <POTable pos={pendingApproval} showActions={false} showAmounts={isSocios}
                    emptyText="No hay OCs pendientes de aprobación." {...sectionProps} />
                  {pendingApproval.length > 0 && (
                    <div className="px-4 py-2 border-t border-border bg-muted/20 text-xs text-muted-foreground">
                      {pendingApproval.length} OC{pendingApproval.length !== 1 ? 's' : ''}{isSocios ? ` · Total: ${fmtCurrency(pendingApproval.reduce((s, p) => s + (p.totalAmount ?? 0), 0))}` : ''}
                    </div>
                  )}
                </div>
              </TabsContent>
            )}
          </Tabs>
        </>
      )}

      {/* Floating bar */}
      {selectedIds.size > 0 && (
        <FloatingBar selectedIds={selectedIds} pos={pos} canApprove={canApprove}
          onDelete={handleBulkDelete} onApprove={handleBulkApprove}
          onSubmit={handleBulkSubmit} onReject={handleBulkReject}
          onSendEmail={handleBulkSendEmail}
          onPdfsGenerated={updates => setPos(prev => prev.map(p => updates[p.id] ? { ...p, pdfUrl: updates[p.id] } : p))}
          onClear={clearSelection}
        />
      )}

      {/* Detail sheet */}
      <PODetailSheet po={detailPO} open={!!detailPO} onClose={() => setDetailPO(null)}
        canApprove={canApprove} userLevel={userLevel} userEmail={user?.email ?? ''} userCostCenters={userCostCenters}
        onEdit={openEdit}
        onApprove={po => { setApproveTarget(po); }}
        onDelete={po => { setDetailPO(null); setDeleteId(po.id); }}
        onUpdate={(id, changes) => {
          setPos(prev => prev.map(p => p.id === id ? { ...p, ...changes } : p));
          setDetailPO(prev => prev?.id === id ? { ...prev, ...changes } : prev);
        }}
      />

      {/* Form sheet */}
      <POFormSheet open={formOpen} onClose={() => setFormOpen(false)} onSaved={load}
        po={editingPO} suppliers={suppliers} userCostCenters={userCostCenters}
        billingEntities={billingEntities}
      />

      {/* Approve confirm */}
      <AlertDialog open={!!approveTarget} onOpenChange={v => { if (!v) setApproveTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Aprobar esta OC?</AlertDialogTitle>
            <AlertDialogDescription>
              OC #{approveTarget?.poNumber} de <strong>{approveTarget?.supplierName}</strong> por {fmtCurrency(approveTarget?.totalAmount, approveTarget?.currency ?? undefined)}.
              Cambiará a <strong>Aprobada</strong>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={approving}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleApprove} disabled={approving} className="bg-emerald-600 hover:bg-emerald-700">
              {approving ? 'Aprobando...' : 'Sí, aprobar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteId} onOpenChange={v => { if (!v) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar esta OC?</AlertDialogTitle>
            <AlertDialogDescription>Esta acción no se puede deshacer.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleting ? 'Eliminando...' : 'Eliminar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
