import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from 'zite-auth-sdk';
import { getPagosManagement } from 'zite-endpoints-sdk';
import { toast } from 'sonner';
import { AlertTriangle, HandCoins, Plus, Search } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Segmentado } from '@/components/payments/Segmentado';
import { CLASE_BOTON_SUAVE, TEXTO_ALERTA } from '@/components/payments/estilos';
import { AgregarProyectoDialog } from '@/components/pagosManagement/AgregarProyectoDialog';
import { RepartoDialog } from '@/components/pagosManagement/RepartoDialog';
import { TablaPersonas } from '@/components/pagosManagement/TablaPersonas';
import { TablaRepartos } from '@/components/pagosManagement/TablaRepartos';
import { ETIQUETA_ESTADO, fmtMontos } from '@/components/pagosManagement/formato';
import { PERIODOS, type Periodo } from '@/lib/indicadores/reclutamiento';
import { motivoDelError } from '@/lib/payments/errores';
import {
  MONEDAS, acumuladoPorPersona, enPeriodo, estadoReparto, normalizarNombre, rubrosPorOmision, totalesPorMoneda, type EstadoReparto, type Moneda, type PagosManagement,
  type ProyectoDisponible, type ProyectoManagement,
} from '@/lib/pagosManagement/reparto';
import { TEAL } from '@/lib/toolColors';

// Función cosmética: el candado de verdad está en el servidor (serverUtils/pagosManagement/acceso.ts).
const PERMITIDOS = ['sergio@sapience.com.mx'];

type Vista = 'proyectos' | 'personas';
const hoyLocal = () => new Date().toLocaleDateString('en-CA'); // AAAA-MM-DD en la zona de quien mira

/** Un proyecto vacío de reparto, para agregarlo a mano: con el Management por omisión, que el deal no trae, a la espera de un presupuesto. */
const proyectoNuevo = (p: ProyectoDisponible): ProyectoManagement => ({
  repartoId: null, projectId: p.projectId, codigo: p.codigo, nombre: p.nombre, cliente: p.cliente, estado: p.estado, inicio: p.inicio, dealNombre: p.dealNombre,
  rubrosDeal: p.rubrosDeal, monedaDeal: p.monedaDeal, rubros: rubrosPorOmision(), moneda: p.monedaDeal, personas: [], eliminado: false,
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

export default function PagosManagementPage() {
  const { user } = useAuth();
  const permitido = PERMITIDOS.includes(((user as { email?: string } | undefined)?.email ?? '').toLowerCase());

  const [datos, setDatos] = useState<PagosManagement | undefined>();
  const [cargando, setCargando] = useState(true);
  const [vista, setVista] = useState<Vista>('proyectos');
  const [periodo, setPeriodo] = useState<Periodo>('12m');
  const [busqueda, setBusqueda] = useState('');
  const [estado, setEstado] = useState<'todos' | EstadoReparto>('todos');
  const [abierto, setAbierto] = useState<ProyectoManagement | null>(null);
  const [agregando, setAgregando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setDatos(await getPagosManagement({}));
    } catch (e) {
      toast.error(motivoDelError(e, 'No se pudieron cargar los pagos de management'));
    }
    setCargando(false);
  }, []);
  useEffect(() => { if (permitido) void cargar(); else setCargando(false); }, [permitido, cargar]);

  const hoy = hoyLocal();
  const enElPeriodo = useMemo(() => (datos ? enPeriodo(datos.proyectos, periodo, hoy) : []), [datos, periodo, hoy]);
  const totales = useMemo(() => totalesPorMoneda(enElPeriodo), [enElPeriodo]);
  // Un proyecto que se pasó no le resta a lo que falta en otro: se avisa aparte.
  const avisoExcedido = totales.proyectosExcedidos === 0 ? undefined
    : `${totales.proyectosExcedidos} ${totales.proyectosExcedidos === 1 ? 'proyecto se pasa' : 'proyectos se pasan'} de 100 %${MONEDAS.some((m) => totales.excedido[m] > 0.004) ? ` · ${fmtMontos(totales.excedido)} de más` : ''}`;
  const acumulados = useMemo(() => acumuladoPorPersona(enElPeriodo), [enElPeriodo]);

  const textoBusqueda = normalizarNombre(busqueda);
  const proyectosVisibles = useMemo(
    () => enElPeriodo.filter((p) => (estado === 'todos' || estadoReparto(p.personas) === estado) && (!textoBusqueda || normalizarNombre(`${p.codigo} ${p.cliente ?? ''} ${p.nombre ?? ''}`).includes(textoBusqueda))),
    [enElPeriodo, estado, textoBusqueda],
  );
  const personasVisibles = useMemo(() => acumulados.filter((a) => !textoBusqueda || normalizarNombre(a.nombre).includes(textoBusqueda)), [acumulados, textoBusqueda]);

  if (!permitido) return <div className="p-6 text-sm text-muted-foreground">Esta sección no está habilitada para tu usuario.</div>;

  const guardado = () => { setAbierto(null); void cargar(); };

  return (
    <div className="mx-auto max-w-[1200px] p-6 pb-24">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold leading-tight tracking-tight">Pagos de análisis / management</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {cargando ? 'Cargando…' : datos ? `${enElPeriodo.length} ${enElPeriodo.length === 1 ? 'proyecto' : 'proyectos'} con management en este periodo` : 'No se pudo cargar'}
          </p>
        </div>
        {datos && !datos.sinTablas && (
          <button type="button" className={CLASE_BOTON_SUAVE} onClick={() => setAgregando(true)}><Plus className="h-3.5 w-3.5" />Agregar proyecto</button>
        )}
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
            <Segmentado<Vista> etiqueta="Vista" valor={vista} onCambio={setVista} opciones={[{ valor: 'proyectos', etiqueta: 'Por proyecto' }, { valor: 'personas', etiqueta: 'Por persona' }]} />
            <Segmentado<Periodo> etiqueta="Periodo" valor={periodo} onCambio={setPeriodo} opciones={PERIODOS.map((p) => ({ valor: p.valor, etiqueta: p.etiqueta }))} />
          </div>

          <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Cifra etiqueta="Presupuestado" porMoneda={totales.presupuestado} />
            <Cifra etiqueta="Repartido" porMoneda={totales.repartido} />
            <Cifra etiqueta="Por repartir" porMoneda={totales.porRepartir} aviso={avisoExcedido} />
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[14rem] flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                aria-label={vista === 'proyectos' ? 'Buscar proyecto' : 'Buscar persona'}
                placeholder={vista === 'proyectos' ? 'Buscar proyecto o cliente' : 'Buscar persona'}
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                className="h-9 w-full rounded-[10px] border bg-card pl-8 pr-3 text-xs outline-none focus:ring-2 focus:ring-[#0F3D4D]/40"
              />
            </div>
            {vista === 'proyectos' && (
              <select
                aria-label="Estado del reparto"
                value={estado}
                onChange={(e) => setEstado(e.target.value as 'todos' | EstadoReparto)}
                className="h-9 rounded-[10px] border bg-card px-2.5 text-xs font-semibold outline-none focus:ring-2 focus:ring-[#0F3D4D]/40"
              >
                <option value="todos">Todos los repartos</option>
                {(Object.keys(ETIQUETA_ESTADO) as EstadoReparto[]).map((e) => <option key={e} value={e}>{ETIQUETA_ESTADO[e]}</option>)}
              </select>
            )}
          </div>

          {vista === 'proyectos' ? (
            proyectosVisibles.length === 0 ? (
              <p className="rounded-xl border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
                {enElPeriodo.length === 0 ? 'No hay proyectos con management en este periodo. Prueba con «Todo» o agrega un proyecto.' : 'Ningún proyecto coincide con lo que buscas.'}
              </p>
            ) : (
              <TablaRepartos proyectos={proyectosVisibles} onAbrir={setAbierto} />
            )
          ) : personasVisibles.length === 0 ? (
            <p className="rounded-xl border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
              {acumulados.length === 0 ? 'Todavía no hay nadie con reparto en este periodo.' : 'Ninguna persona coincide con lo que buscas.'}
            </p>
          ) : (
            <TablaPersonas personas={personasVisibles} />
          )}

          <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
            El presupuesto empieza con el Management que sale en la pestaña Presupuesto del proyecto (costo, sin markup); se le pueden sumar otros rubros de la cotización y todos los montos se pueden cambiar proyecto por proyecto. Cada persona lleva un porcentaje de ese presupuesto y su monto se calcula con el presupuesto de hoy. El periodo cuenta por la fecha de inicio del proyecto.
          </p>
        </>
      )}

      <RepartoDialog proyecto={abierto} usuarios={datos?.usuarios ?? []} externos={datos?.externos ?? []} onCerrar={() => setAbierto(null)} onGuardado={guardado} />
      <AgregarProyectoDialog
        abierto={agregando}
        disponibles={datos?.disponibles ?? []}
        onElegir={(p) => { setAgregando(false); setAbierto(proyectoNuevo(p)); }}
        onCerrar={() => setAgregando(false)}
      />
    </div>
  );
}
