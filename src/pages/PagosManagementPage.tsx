import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from 'zite-auth-sdk';
import { getPagosManagement } from 'zite-endpoints-sdk';
import { toast } from 'sonner';
import { AlertTriangle, HandCoins, Search } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Segmentado } from '@/components/payments/Segmentado';
import { CLASE_BOTON_SUAVE, TEXTO_ALERTA } from '@/components/payments/estilos';
import { AgregarProyectoDialog, type OpcionProyecto } from '@/components/pagosManagement/AgregarProyectoDialog';
import { RepartoDialog } from '@/components/pagosManagement/RepartoDialog';
import { TablaDeals } from '@/components/pagosManagement/TablaDeals';
import { TablaPersonas } from '@/components/pagosManagement/TablaPersonas';
import { TablaRepartos } from '@/components/pagosManagement/TablaRepartos';
import { ETIQUETA_ESTADO, ETIQUETA_ESTADO_DEAL, fmtMontos } from '@/components/pagosManagement/formato';
import { PERIODOS, type Periodo } from '@/lib/indicadores/reclutamiento';
import { motivoDelError } from '@/lib/payments/errores';
import {
  MONEDAS, acumuladoPorPersona, enPeriodo, estadoDeDeal, estadoReparto, normalizarNombre, resumenDeDeal, rubrosPorOmision, totalesDeDeals, totalesPorMoneda,
  type EstadoDeal, type EstadoReparto, type Moneda, type PagosManagement, type ProyectoDisponible, type ProyectoManagement,
} from '@/lib/pagosManagement/reparto';
import { TEAL } from '@/lib/toolColors';

// Función cosmética: el candado de verdad está en el servidor (serverUtils/pagosManagement/acceso.ts).
const PERMITIDOS = ['sergio@sapience.com.mx'];

type Vista = 'proyectos' | 'deals' | 'personas';
const hoyLocal = () => new Date().toLocaleDateString('en-CA'); // AAAA-MM-DD en la zona de quien mira

/** Un proyecto que todavía no tiene reparto ni monto de management en su deal, listo para abrirlo: con el Management por omisión, a la espera de un monto. */
const proyectoNuevo = (p: ProyectoDisponible): ProyectoManagement => ({
  repartoId: null, projectId: p.projectId, codigo: p.codigo, nombre: p.nombre, cliente: p.cliente, estado: p.estado, inicio: p.inicio, dealNombre: p.dealNombre,
  rubrosDeal: p.rubrosDeal, monedaDeal: p.monedaDeal, rubros: rubrosPorOmision(), moneda: p.monedaDeal, personas: [], eliminado: false,
  dealId: p.dealId, dealVinculadoId: p.dealVinculadoId, dealVinculadoNombre: p.dealVinculadoNombre, dealAsignadoId: p.dealAsignadoId, dealFragmentado: p.dealFragmentado,
});

function Cifra({ etiqueta, porMoneda, aviso }: { etiqueta: string; porMoneda: Record<Moneda, number>; aviso?: string }) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3">
      <p className="text-xs font-semibold text-muted-foreground">{etiqueta}</p>
      <p className="mt-1 text-xl font-bold leading-tight tracking-tight tabular-nums">{fmtMontos(porMoneda)}</p>
      {aviso && (
        <p className="mt-1 flex items-center gap-1 text-xs font-semibold" style={{ color: TEXTO_ALERTA }}>
          <AlertTriangle className="h-3 w-3 shrink-0" />{aviso}
        </p>
      )}
    </div>
  );
}

const CLASE_FILTRO = 'h-9 rounded-[10px] border bg-card px-2.5 text-xs font-semibold outline-none focus:ring-2 focus:ring-[#0F3D4D]/40';

export default function PagosManagementPage() {
  const { user } = useAuth();
  const permitido = PERMITIDOS.includes(((user as { email?: string } | undefined)?.email ?? '').toLowerCase());

  const [datos, setDatos] = useState<PagosManagement | undefined>();
  const [cargando, setCargando] = useState(true);
  const [vista, setVista] = useState<Vista>('proyectos');
  const [periodo, setPeriodo] = useState<Periodo>('12m');
  const [busqueda, setBusqueda] = useState('');
  const [estado, setEstado] = useState<'todos' | EstadoReparto>('todos');
  const [filtroDeal, setFiltroDeal] = useState<'todos' | 'sin'>('todos');
  const [estadoDeal, setEstadoDeal] = useState<'todos' | EstadoDeal>('todos');
  const [abierto, setAbierto] = useState<ProyectoManagement | null>(null);
  /** El deal con el que se abre el reparto de un proyecto que todavía no sale de él (al agregarlo desde la pestaña de Deals). */
  const [dealAlAbrir, setDealAlAbrir] = useState<string | null>(null);
  /** Agregando un proyecto a un deal: elegir cuál. */
  const [agregando, setAgregando] = useState<{ dealId: string } | null>(null);

  const cargar = useCallback(async () => {
    try {
      setDatos(await getPagosManagement({}));
    } catch (e) {
      toast.error(motivoDelError(e, 'No se pudieron cargar los pagos de management'));
    }
    setCargando(false);
  }, []);
  useEffect(() => { if (permitido) void cargar(); else setCargando(false); }, [permitido, cargar]);

  // Todos los proyectos, con o sin reparto, del más reciente al más viejo: ahí se registra y se asigna cada uno a su deal.
  const todos = useMemo<ProyectoManagement[]>(
    () => (datos ? [...datos.proyectos, ...(datos.disponibles ?? []).map(proyectoNuevo)].sort((a, b) => (b.inicio ?? '').localeCompare(a.inicio ?? '') || a.codigo.localeCompare(b.codigo)) : []),
    [datos],
  );
  // Cuánto de lo cotizado de cada deal ya se repartió entre proyectos. No depende del periodo: la bolsa de un deal se va gastando con los meses.
  const resumenes = useMemo(() => (datos ? (datos.deals ?? []).map((g) => resumenDeDeal(g, datos.proyectos, datos.disponibles ?? [])) : []), [datos]);
  const asignados = useMemo<Record<string, number>>(() => Object.fromEntries(resumenes.map((r) => [r.deal.dealId, r.asignado])), [resumenes]);

  const hoy = hoyLocal();
  const enElPeriodo = useMemo(() => enPeriodo(todos, periodo, hoy), [todos, periodo, hoy]);
  const totales = useMemo(() => totalesPorMoneda(enElPeriodo), [enElPeriodo]);
  // Un proyecto que se pasó no le resta a lo que falta en otro: se avisa aparte.
  const avisoExcedido = totales.proyectosExcedidos === 0 ? undefined
    : `${totales.proyectosExcedidos} ${totales.proyectosExcedidos === 1 ? 'proyecto se pasa' : 'proyectos se pasan'} de 100 %${MONEDAS.some((m) => totales.excedido[m] > 0.004) ? ` · ${fmtMontos(totales.excedido)} de más` : ''}`;
  const acumulados = useMemo(() => acumuladoPorPersona(enElPeriodo), [enElPeriodo]);
  // Los deals del periodo (por su fecha de aprobación).
  const dealsEnElPeriodo = useMemo(() => enPeriodo(resumenes.map((r) => ({ r, inicio: r.deal.inicio })), periodo, hoy).map((x) => x.r), [resumenes, periodo, hoy]);
  const totalesDeals = useMemo(() => totalesDeDeals(dealsEnElPeriodo), [dealsEnElPeriodo]);
  const avisoDealsExcedidos = totalesDeals.dealsExcedidos === 0 ? undefined
    : `${totalesDeals.dealsExcedidos} ${totalesDeals.dealsExcedidos === 1 ? 'deal se pasa' : 'deals se pasan'} de lo cotizado${MONEDAS.some((m) => totalesDeals.excedido[m] > 0.004) ? ` · ${fmtMontos(totalesDeals.excedido)} de más` : ''}`;

  const textoBusqueda = normalizarNombre(busqueda);
  const proyectosVisibles = useMemo(
    () => enElPeriodo.filter((p) => (estado === 'todos' || estadoReparto(p.personas) === estado) && (filtroDeal === 'todos' || (!p.dealId && !p.eliminado))
      && (!textoBusqueda || normalizarNombre(`${p.codigo} ${p.cliente ?? ''} ${p.nombre ?? ''} ${p.dealNombre ?? ''}`).includes(textoBusqueda))),
    [enElPeriodo, estado, filtroDeal, textoBusqueda],
  );
  const dealsVisibles = useMemo(
    () => dealsEnElPeriodo.filter((r) => (estadoDeal === 'todos' || estadoDeDeal(r) === estadoDeal)
      && (!textoBusqueda || normalizarNombre(`${r.deal.nombre} ${r.deal.cliente ?? ''} ${r.proyectos.map((p) => p.codigo).join(' ')}`).includes(textoBusqueda))),
    [dealsEnElPeriodo, estadoDeal, textoBusqueda],
  );
  const personasVisibles = useMemo(() => acumulados.filter((a) => !textoBusqueda || normalizarNombre(a.nombre).includes(textoBusqueda)), [acumulados, textoBusqueda]);

  if (!permitido) return <div className="p-6 text-sm text-muted-foreground">Esta sección no está habilitada para tu usuario.</div>;

  const abrir = (p: ProyectoManagement, dealInicial: string | null = null) => { setDealAlAbrir(dealInicial); setAbierto(p); };
  const cerrarReparto = () => { setAbierto(null); setDealAlAbrir(null); };
  const guardado = () => { cerrarReparto(); void cargar(); };
  const abrirPorId = (projectId: string) => { const p = todos.find((x) => x.projectId === projectId); if (p) abrir(p); };

  // Al agregar un proyecto a un deal se pueden elegir todos los que todavía no salen de él.
  const dealPorAgregar = agregando ? datos?.deals.find((g) => g.dealId === agregando.dealId) : undefined;
  const opcionesParaAgregar: OpcionProyecto[] = agregando
    ? todos.filter((p): p is ProyectoManagement & { projectId: string } => !p.eliminado && !!p.projectId && p.dealId !== agregando.dealId)
    : [];
  const elegirParaAgregar = (projectId: string) => {
    const dealId = agregando?.dealId ?? null;
    setAgregando(null);
    const p = todos.find((x) => x.projectId === projectId);
    if (p) abrir(p, dealId);
  };

  const subtitulo = cargando ? 'Cargando…' : !datos ? 'No se pudo cargar'
    : vista === 'deals' ? `${dealsEnElPeriodo.length} ${dealsEnElPeriodo.length === 1 ? 'deal' : 'deals'} con management cotizado en este periodo`
      : `${enElPeriodo.length} ${enElPeriodo.length === 1 ? 'proyecto' : 'proyectos'} en este periodo`;

  return (
    <div className="mx-auto max-w-[1200px] p-6 pb-24">
      <div className="mb-5">
        <h1 className="text-[22px] font-bold leading-tight tracking-tight">Pagos de análisis / management</h1>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{subtitulo}</p>
      </div>

      {cargando && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-[74px] rounded-xl" />)}</div>
          <Skeleton className="h-72 rounded-xl" />
        </div>
      )}

      {!cargando && !datos && (
        <div className="flex flex-col items-center gap-3 rounded-xl border bg-card px-6 py-14 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl" style={{ backgroundColor: TEAL }}><HandCoins className="h-5 w-5 text-white" /></div>
          <p className="text-sm font-semibold">No se pudieron cargar los pagos de management</p>
          <button type="button" className={CLASE_BOTON_SUAVE} onClick={() => { setCargando(true); void cargar(); }}>Reintentar</button>
        </div>
      )}

      {datos && (
        <>
          {datos.sinTablas && (
            <p role="alert" className="mb-4 rounded-lg border border-[hsl(38_92%_80%)] bg-[hsl(38_92%_94%)] px-3 py-2 text-xs font-medium text-[hsl(32_92%_28%)]">
              Faltan las tablas de este módulo en la base de datos: se puede ver, pero todavía no guardar repartos.
            </p>
          )}

          <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2.5">
            <Segmentado<Vista>
              etiqueta="Vista"
              valor={vista}
              onCambio={setVista}
              opciones={[{ valor: 'proyectos', etiqueta: 'Proyectos' }, { valor: 'deals', etiqueta: 'Deals' }, { valor: 'personas', etiqueta: 'Personas' }]}
            />
            <Segmentado<Periodo> etiqueta="Periodo" valor={periodo} onCambio={setPeriodo} opciones={PERIODOS.map((p) => ({ valor: p.valor, etiqueta: p.etiqueta }))} />
          </div>

          <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {vista === 'deals' ? (
              <>
                <Cifra etiqueta="Cotizado" porMoneda={totalesDeals.cotizado} />
                <Cifra etiqueta="Repartido en proyectos" porMoneda={totalesDeals.asignado} />
                <Cifra etiqueta="Por asignar" porMoneda={totalesDeals.porAsignar} aviso={avisoDealsExcedidos} />
              </>
            ) : (
              <>
                <Cifra etiqueta="Presupuestado" porMoneda={totales.presupuestado} />
                <Cifra etiqueta="Repartido" porMoneda={totales.repartido} />
                <Cifra etiqueta="Por repartir" porMoneda={totales.porRepartir} aviso={avisoExcedido} />
              </>
            )}
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[14rem] flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                aria-label={vista === 'personas' ? 'Buscar persona' : vista === 'deals' ? 'Buscar deal' : 'Buscar proyecto'}
                placeholder={vista === 'personas' ? 'Buscar persona' : vista === 'deals' ? 'Buscar deal, cliente o proyecto' : 'Buscar proyecto, cliente o deal'}
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                className="h-9 w-full rounded-[10px] border bg-card pl-8 pr-3 text-xs outline-none focus:ring-2 focus:ring-[#0F3D4D]/40"
              />
            </div>
            {vista === 'proyectos' && (
              <>
                <select aria-label="Estado del reparto" value={estado} onChange={(e) => setEstado(e.target.value as 'todos' | EstadoReparto)} className={CLASE_FILTRO}>
                  <option value="todos">Todos los repartos</option>
                  {(Object.keys(ETIQUETA_ESTADO) as EstadoReparto[]).map((e) => <option key={e} value={e}>{ETIQUETA_ESTADO[e]}</option>)}
                </select>
                <select aria-label="Deal del proyecto" value={filtroDeal} onChange={(e) => setFiltroDeal(e.target.value as 'todos' | 'sin')} className={CLASE_FILTRO}>
                  <option value="todos">Con y sin deal</option>
                  <option value="sin">Sin deal</option>
                </select>
              </>
            )}
            {vista === 'deals' && (
              <select aria-label="Cuánto está repartido" value={estadoDeal} onChange={(e) => setEstadoDeal(e.target.value as 'todos' | EstadoDeal)} className={CLASE_FILTRO}>
                <option value="todos">Todos los deals</option>
                {(Object.keys(ETIQUETA_ESTADO_DEAL) as EstadoDeal[]).map((e) => <option key={e} value={e}>{ETIQUETA_ESTADO_DEAL[e]}</option>)}
              </select>
            )}
          </div>

          {vista === 'proyectos' && (
            proyectosVisibles.length === 0 ? (
              <p className="rounded-xl border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
                {enElPeriodo.length === 0 ? 'No hay proyectos en este periodo. Prueba con «Todo».' : 'Ningún proyecto coincide con lo que buscas.'}
              </p>
            ) : (
              <TablaRepartos proyectos={proyectosVisibles} onAbrir={(p) => abrir(p)} />
            )
          )}

          {vista === 'deals' && (
            dealsVisibles.length === 0 ? (
              <p className="rounded-xl border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
                {dealsEnElPeriodo.length === 0 ? 'No hay deals con management cotizado en este periodo. Prueba con «Todo».' : 'Ningún deal coincide con lo que buscas.'}
              </p>
            ) : (
              <TablaDeals resumenes={dealsVisibles} onAbrirProyecto={abrirPorId} onAgregar={(dealId) => setAgregando({ dealId })} puedeAgregar={!datos.sinTablas} />
            )
          )}

          {vista === 'personas' && (
            personasVisibles.length === 0 ? (
              <p className="rounded-xl border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
                {acumulados.length === 0 ? 'Todavía no hay nadie con reparto en este periodo.' : 'Ninguna persona coincide con lo que buscas.'}
              </p>
            ) : (
              <TablaPersonas personas={personasVisibles} />
            )
          )}

          <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
            El presupuesto de un proyecto empieza con el Management de su deal (costo, sin markup); se le pueden sumar otros rubros de la cotización y todos los montos se pueden cambiar proyecto por proyecto. Cada persona lleva un porcentaje de ese presupuesto y su monto se calcula con el presupuesto de hoy. Un deal puede repartirse entre varios proyectos: a cada uno se le asigna su deal y se escribe cuánto se lleva; en Deals se ve qué porcentaje de lo cotizado ya está repartido. El periodo cuenta por la fecha de inicio del proyecto (en Deals, por la de aprobación del deal).
          </p>
        </>
      )}

      <RepartoDialog
        proyecto={abierto}
        deals={datos?.deals ?? []}
        asignados={asignados}
        dealInicial={dealAlAbrir}
        usuarios={datos?.usuarios ?? []}
        externos={datos?.externos ?? []}
        onCerrar={cerrarReparto}
        onGuardado={guardado}
      />
      <AgregarProyectoDialog
        abierto={!!agregando}
        opciones={opcionesParaAgregar}
        descripcion={dealPorAgregar ? `Elige el proyecto que se lleva management de ${dealPorAgregar.nombre}.` : undefined}
        onElegir={elegirParaAgregar}
        onCerrar={() => setAgregando(null)}
      />
    </div>
  );
}
