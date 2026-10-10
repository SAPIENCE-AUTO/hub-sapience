import { useState, useEffect, useMemo, useCallback } from 'react';
import { getPayments, deletePayment, bulkDeletePayments, type GetPaymentsOutputType } from 'zite-endpoints-sdk';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { PaymentDetailDialog } from '@/components/payments/PaymentDetailDialog';
import { PaymentFormDialog } from '@/components/payments/PaymentFormDialog';
import { PaymentsCalendar } from '@/components/payments/PaymentsCalendar';
import { PaymentsKpis } from '@/components/payments/PaymentsKpis';
import { PaymentsList } from '@/components/payments/PaymentsList';
import { Segmentado } from '@/components/payments/Segmentado';
import { ESTILO_BOTON_PRIMARIO, VARIABLES_PAGOS } from '@/components/payments/estilos';
import { motivoDelError } from '../lib/payments/errores';
import { hoyLocalISO, soloFecha } from '../lib/payments/fechas';
import { nombreProveedor, plural } from '../lib/payments/formato';
import {
  coincideBusqueda, contarPorPestana, filtraPorPestana, opcionesMes, ordenaPagos, ordenPorDefecto,
  type ClaveOrden, type Orden,
} from '../lib/payments/lista';
import type { Pestana } from '../lib/payments/types';
import { agrupaPorUrgencia, resumenTarjetas, type ClaveGrupo } from '../lib/payments/urgencia';
import { Plus, Trash2, CreditCard, CalendarDays, List, X, Search } from 'lucide-react';

type Payment = GetPaymentsOutputType['payments'][0];

const TABS: { clave: Pestana; etiqueta: string }[] = [
  { clave: 'porPagar', etiqueta: 'Por pagar' },
  { clave: 'pagados', etiqueta: 'Pagados' },
  { clave: 'cancelados', etiqueta: 'Cancelados' },
  { clave: 'todos', etiqueta: 'Todos' },
];

// Lo que está lejos de hoy empieza cerrado: lo urgente se ve de entrada y el resto está a un clic.
const GRUPOS_CERRADOS: ClaveGrupo[] = ['proximos', 'adelante', 'sinFecha'];
const LIMITE_INICIAL = 150;

const TEXTO_VACIO: Record<Pestana, string> = {
  porPagar: 'No hay pagos por pagar',
  pagados: 'No hay pagos realizados',
  cancelados: 'No hay pagos cancelados',
  todos: 'No hay pagos',
};

export default function PaymentsPage() {
  const [data, setData] = useState<GetPaymentsOutputType>({ payments: [], poOptions: [], billingEntityOptions: [] });
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'table' | 'calendar'>('table');
  const [pestana, setPestana] = useState<Pestana>('porPagar');
  const [filterSupplier, setFilterSupplier] = useState('all');
  const [filterProject, setFilterProject] = useState('all');
  const [mes, setMes] = useState('auto'); // 'auto' = el mes más reciente con pagos; 'todos'; o 'YYYY-MM'
  const [search, setSearch] = useState('');
  const [ordenElegido, setOrdenElegido] = useState<Orden | null>(null);
  const [colapsados, setColapsados] = useState<Set<ClaveGrupo>>(new Set(GRUPOS_CERRADOS));
  const [limite, setLimite] = useState(LIMITE_INICIAL);

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Detail dialog
  const [viewing, setViewing] = useState<Payment | null>(null);
  const [openDetailDialog, setOpenDetailDialog] = useState(false);

  // Form dialog
  const [editing, setEditing] = useState<Payment | null>(null);
  const [openFormDialog, setOpenFormDialog] = useState(false);

  // Delete confirmations
  const [deleting, setDeleting] = useState<Payment | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Con `silencioso` la lista se actualiza sin volver a la pantalla de carga (así no se pierden los filtros ni el lugar).
  const load = useCallback((silencioso = false) => {
    if (!silencioso) setLoading(true);
    getPayments({})
      .then(d => setData(d))
      .catch(e => toast.error(motivoDelError(e, 'No se pudieron cargar los pagos')))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const { payments } = data;
  const hoy = useMemo(() => hoyLocalISO(), [payments]);
  const conteos = useMemo(() => contarPorPestana(payments), [payments]);
  const resumen = useMemo(() => resumenTarjetas(payments, hoy), [payments, hoy]);
  const suppliers = useMemo(() => [...new Set(payments.map(p => p.supplierName).filter(Boolean))].sort() as string[], [payments]);
  const projects = useMemo(() => [...new Set(payments.map(p => p.projectCode).filter(Boolean))].sort() as string[], [payments]);
  const mesesDisponibles = useMemo(() => opcionesMes(payments), [payments]);

  const busqueda = search.trim();
  const hayFiltro = !!busqueda || filterSupplier !== 'all' || filterProject !== 'all';
  const enCalendario = viewMode === 'calendar';
  // El mes solo aplica en «Pagados», en la tabla y mientras no se busca: buscar una ODC mira todos los meses y el
  // calendario ya trae su propio mes.
  const mesEfectivo = enCalendario || pestana !== 'pagados' || busqueda ? 'todos' : mes === 'auto' ? (mesesDisponibles[0]?.valor ?? 'todos') : mes;
  const orden = useMemo(() => ordenElegido ?? ordenPorDefecto(pestana), [ordenElegido, pestana]);

  const filtrados = useMemo(() => {
    const base = filtraPorPestana(payments, pestana).filter(p =>
      (filterSupplier === 'all' || p.supplierName === filterSupplier)
      && (filterProject === 'all' || p.projectCode === filterProject)
      && coincideBusqueda(p, busqueda)
      && (mesEfectivo === 'todos' || soloFecha(p.paymentDate)?.slice(0, 7) === mesEfectivo));
    return ordenaPagos(base, orden, pestana);
  }, [payments, pestana, filterSupplier, filterProject, busqueda, mesEfectivo, orden]);

  const agrupar = pestana === 'porPagar' && !enCalendario;
  const grupos = useMemo(() => (agrupar ? agrupaPorUrgencia(filtrados, hoy) : null), [agrupar, filtrados, hoy]);
  // Con una búsqueda o un filtro activo se abren todos los grupos: que lo encontrado no quede escondido.
  const cerrados = useMemo<ReadonlySet<ClaveGrupo>>(() => (hayFiltro ? new Set() : colapsados), [hayFiltro, colapsados]);
  const planos = useMemo(() => (grupos ? [] : filtrados.slice(0, limite)), [grupos, filtrados, limite]);
  const sinMostrar = grupos ? 0 : Math.max(0, filtrados.length - planos.length);
  const visibles = useMemo(() => (grupos ? grupos.filter(g => !cerrados.has(g.clave)).flatMap(g => g.pagos) : planos), [grupos, cerrados, planos]);

  // Cambiar de pestaña, buscar o filtrar suelta la selección: «Eliminar» nunca debe actuar sobre filas que ya no se ven.
  useEffect(() => {
    setSelectedIds(new Set());
    setLimite(LIMITE_INICIAL);
  }, [pestana, search, filterSupplier, filterProject, mes, viewMode]);

  const cambiarPestana = (p: Pestana) => { setPestana(p); setOrdenElegido(null); };
  const cambiarOrden = (clave: ClaveOrden) => {
    setOrdenElegido(prev => {
      const actual = prev ?? ordenPorDefecto(pestana);
      if (actual.clave === clave) return { clave, dir: actual.dir === 'asc' ? 'desc' : 'asc' };
      return { clave, dir: clave === 'monto' ? 'desc' : 'asc' };
    });
  };
  const toggleGrupo = (g: ClaveGrupo) => setColapsados(prev => { const n = new Set(prev); n.has(g) ? n.delete(g) : n.add(g); return n; });
  // Desde el calendario: lo vencido solo vive en «Por pagar», y el grupo que se pide se abre para que no quede escondido.
  const verEnTabla = (grupo: ClaveGrupo) => {
    if (grupo === 'vencidos') cambiarPestana('porPagar');
    setColapsados(prev => { const n = new Set(prev); n.delete(grupo); return n; });
    setViewMode('table');
  };
  const limpiarFiltros = () => { setSearch(''); setFilterSupplier('all'); setFilterProject('all'); };

  const todosSeleccionados = visibles.length > 0 && visibles.every(p => selectedIds.has(p.id));
  const someSelected = selectedIds.size > 0;
  const toggleSelectAll = () => {
    setSelectedIds(prev => {
      const n = new Set(prev);
      if (todosSeleccionados) visibles.forEach(p => n.delete(p.id));
      else visibles.forEach(p => n.add(p.id));
      return n;
    });
  };
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const handleBulkDelete = async () => {
    setBulkDeleting(false);
    const ids = [...selectedIds];
    try {
      await bulkDeletePayments({ ids });
      toast.success(`${plural(ids.length, 'pago')} eliminado${ids.length !== 1 ? 's' : ''}`);
      setSelectedIds(new Set());
      load(true);
    } catch (e) {
      toast.error(motivoDelError(e, 'No se pudieron eliminar los pagos'));
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await deletePayment({ id: deleting.id });
      toast.success('Pago eliminado');
      setDeleting(null);
      setOpenDetailDialog(false);
      load(true);
    } catch (e) {
      toast.error(motivoDelError(e, 'No se pudo eliminar el pago'));
    }
  };

  const openDetail = (p: Payment) => { setViewing(p); setOpenDetailDialog(true); };
  const openEdit = (p: Payment) => { setEditing(p); setOpenDetailDialog(false); setOpenFormDialog(true); };

  return (
    <div className="p-6 max-w-[1400px] mx-auto pb-24" style={VARIABLES_PAGOS}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-[22px] font-bold leading-tight tracking-tight">Pagos a proveedores</h1>
          <p className="text-[13px] text-muted-foreground mt-0.5">
            {loading ? 'Cargando…' : `${plural(payments.length, 'pago')} registrado${payments.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <Segmentado<'table' | 'calendar'>
            etiqueta="Cómo ver los pagos"
            valor={viewMode}
            onCambio={setViewMode}
            opciones={[
              { valor: 'table', etiqueta: 'Tabla', icono: <List className="w-3.5 h-3.5" /> },
              { valor: 'calendar', etiqueta: 'Calendario', icono: <CalendarDays className="w-3.5 h-3.5" /> },
            ]}
          />
          <Button className="gap-1.5 rounded-[10px] px-4 hover:brightness-110" style={ESTILO_BOTON_PRIMARIO} onClick={() => { setEditing(null); setOpenFormDialog(true); }}>
            <Plus className="w-4 h-4" /> Nuevo pago
          </Button>
        </div>
      </div>

      {/* KPIs: en el calendario sobran, el calendario trae su propio resumen y el aviso de vencidos */}
      {!enCalendario && (loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">{[1, 2, 3].map(i => <Skeleton key={i} className="h-[88px] rounded-xl" />)}</div>
      ) : (
        <PaymentsKpis resumen={resumen} hoy={hoy} />
      ))}

      {/* Tabs: son pantallas distintas (qué pagos ver), no filtros */}
      {!loading && payments.length > 0 && (
        <div role="tablist" className="flex items-end gap-6 border-b mb-3.5">
          {TABS.map(t => {
            const activa = pestana === t.clave;
            return (
              <button
                key={t.clave}
                role="tab"
                aria-selected={activa}
                onClick={() => cambiarPestana(t.clave)}
                className={`-mb-px inline-flex items-center gap-[7px] border-b-2 pb-2.5 pt-1 text-[13px] font-semibold transition-colors ${activa ? 'border-[color:var(--pc-teal)] text-[color:var(--pc-teal)]' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
              >
                {t.etiqueta}
                <span className={`rounded-full px-[7px] py-px text-[11px] font-semibold ${activa ? 'bg-[color:var(--pc-teal-12)]' : 'bg-border text-foreground'}`}>{conteos[t.clave]}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Search + filters */}
      {!loading && payments.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              className="pl-9 h-9 text-sm"
              placeholder="Buscar ODC, proveedor, proyecto…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          {suppliers.length > 0 && (
            <Select value={filterSupplier} onValueChange={setFilterSupplier}>
              <SelectTrigger className="h-9 text-xs w-auto min-w-[150px]"><SelectValue placeholder="Proveedor" /></SelectTrigger>
              <SelectContent><SelectItem value="all">Todos los proveedores</SelectItem>{suppliers.map(s => <SelectItem key={s} value={s}>{nombreProveedor(s)}</SelectItem>)}</SelectContent>
            </Select>
          )}
          {projects.length > 0 && (
            <Select value={filterProject} onValueChange={setFilterProject}>
              <SelectTrigger className="h-9 text-xs w-auto min-w-[130px]"><SelectValue placeholder="Proyecto" /></SelectTrigger>
              <SelectContent><SelectItem value="all">Todos los proyectos</SelectItem>{projects.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
            </Select>
          )}
          {pestana === 'pagados' && !enCalendario && mesesDisponibles.length > 0 && (
            <Select value={mesEfectivo} onValueChange={setMes} disabled={!!busqueda}>
              <SelectTrigger className="h-9 text-xs w-auto min-w-[160px]" title={busqueda ? 'La búsqueda mira todos los meses' : 'Mes en que se pagó'}><SelectValue placeholder="Mes" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos los meses</SelectItem>
                {mesesDisponibles.map(m => <SelectItem key={m.valor} value={m.valor}>{m.etiqueta} ({m.n})</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {hayFiltro && (
            <Button variant="ghost" size="sm" className="h-9 text-xs gap-1.5" onClick={limpiarFiltros}>
              <X className="w-3.5 h-3.5" /> Limpiar filtros
            </Button>
          )}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="space-y-2">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : enCalendario && payments.length > 0 ? (
        // key: al cambiar de pestaña el calendario vuelve a abrir en su mes y día de siempre
        <PaymentsCalendar key={pestana} payments={filtrados} pestana={pestana} hoy={hoy} onSelect={openDetail} onVerEnTabla={verEnTabla} />
      ) : filtrados.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center bg-card border rounded-xl">
          <CreditCard className="w-14 h-14 text-muted-foreground/30 mb-4" />
          <p className="text-base font-semibold mb-1">{payments.length === 0 ? 'No hay pagos registrados aún' : TEXTO_VACIO[pestana]}</p>
          <p className="text-sm text-muted-foreground mb-5">
            {payments.length === 0 ? 'Registra el primer pago.' : hayFiltro || mesEfectivo !== 'todos' ? 'Ajusta los filtros o la búsqueda.' : 'Cuando haya, aparecerán aquí.'}
          </p>
          {payments.length === 0 && <Button onClick={() => { setEditing(null); setOpenFormDialog(true); }} className="gap-1.5 rounded-[10px] px-4 hover:brightness-110" style={ESTILO_BOTON_PRIMARIO}><Plus className="w-4 h-4" /> Nuevo pago</Button>}
        </div>
      ) : (
        <PaymentsList
          pestana={pestana}
          hoy={hoy}
          grupos={grupos}
          pagos={planos}
          orden={orden}
          onOrden={cambiarOrden}
          colapsados={cerrados}
          onToggleGrupo={toggleGrupo}
          seleccion={selectedIds}
          onToggleSeleccion={toggleSelect}
          todosSeleccionados={todosSeleccionados}
          onToggleTodos={toggleSelectAll}
          onAbrir={openDetail}
          sinMostrar={sinMostrar}
          onMostrarMas={() => setLimite(l => l + LIMITE_INICIAL)}
        />
      )}

      {/* Bulk action bar */}
      {someSelected && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-card border shadow-2xl rounded-2xl px-5 py-3 flex items-center gap-3 flex-wrap">
          <span className="text-sm font-semibold shrink-0">{selectedIds.size} seleccionado{selectedIds.size !== 1 ? 's' : ''}</span>
          <div className="w-px h-5 bg-border" />
          <Button variant="destructive" size="sm" className="gap-1.5 h-8" onClick={() => setBulkDeleting(true)}>
            <Trash2 className="w-3.5 h-3.5" /> Eliminar
          </Button>
          <Button variant="ghost" size="sm" className="gap-1.5 h-8" onClick={() => setSelectedIds(new Set())}>
            <X className="w-3.5 h-3.5" /> Deseleccionar
          </Button>
        </div>
      )}

      {/* Modals */}
      <PaymentDetailDialog
        payment={viewing}
        open={openDetailDialog}
        onOpenChange={setOpenDetailDialog}
        onEdit={() => viewing && openEdit(viewing)}
        onDelete={() => setDeleting(viewing)}
        onAttachmentUploaded={(attachment) => {
          if (!viewing) return;
          const updated = { ...viewing, attachment };
          setViewing(updated);
          setData(prev => ({ ...prev, payments: prev.payments.map(p => p.id === viewing.id ? updated : p) }));
        }}
        onPaymentUpdated={(updates) => {
          if (!viewing) return;
          const updated = { ...viewing, ...updates };
          setViewing(updated);
          setData(prev => ({ ...prev, payments: prev.payments.map(p => p.id === viewing.id ? updated : p) }));
        }}
      />
      <PaymentFormDialog
        open={openFormDialog}
        onOpenChange={setOpenFormDialog}
        editing={editing}
        poOptions={data.poOptions}
        billingEntityOptions={data.billingEntityOptions}
        onSaved={() => load(true)}
      />

      {/* Single delete */}
      <AlertDialog open={!!deleting} onOpenChange={o => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar pago?</AlertDialogTitle>
            <AlertDialogDescription>Esta acción no se puede deshacer.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk delete */}
      <AlertDialog open={bulkDeleting} onOpenChange={setBulkDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar {plural(selectedIds.size, 'pago')}?</AlertDialogTitle>
            <AlertDialogDescription>Esta acción no se puede deshacer.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleBulkDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
