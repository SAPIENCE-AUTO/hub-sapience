// Tablero comercial (nuevo): bloques que se arrastran y se estiran, cada uno con su propia receta (qué mide, cómo se corta, con qué se cruza, qué gráfica). Al ver se
// muestra limpio: una barra con periodo, comparación, fecha y filtros, y los bloques. Los controles de cada bloque aparecen solo al editar. Convive con el dashboard
// anterior (no lo toca) y por ahora solo lo ve quien está en TABLERO_EMAILS. El motor vive en lib/tablero/.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from 'zite-auth-sdk';
import { deleteCommercialView, getCommercialViews, getDeals, getTeamMembers, saveCommercialView } from 'zite-endpoints-sdk';
import { LayoutDashboard, Pencil, Plus, RefreshCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import DrillDownSheet from '@/components/commercial-dashboard/DrillDownSheet';
import BloqueCard from '@/components/tablero/BloqueCard';
import EditorBloque from '@/components/tablero/EditorBloque';
import Filtros from '@/components/tablero/Filtros';
import Rejilla from '@/components/tablero/Rejilla';
import { SelectorComparacion, SelectorFecha, SelectorPeriodo } from '@/components/tablero/Selectores';
import { useOscuro } from '@/components/tablero/useOscuro';
import VistasTablero, { type VistaAnterior, type VistaGuardada } from '@/components/tablero/VistasTablero';
import { TABLERO_EMAILS } from '@/lib/tablero/acceso';
import { hoyISO } from '@/lib/tablero/fechas';
import { ejecutar, resolverConsulta } from '@/lib/tablero/motor';
import { resolverPeriodos } from '@/lib/tablero/periodos';
import { MAX_BLOQUES, posNueva } from '@/lib/tablero/rejilla';
import {
  TAMANO_INICIAL, bloqueNuevo, desdeVistaAnterior, esVistaTablero, leerTablero, nuevoIdBloque, nuevoIdVista, serializarTablero, tableroInicial,
} from '@/lib/tablero/vistas';
import type { Bloque, Contexto, Deal, Resultado, Tablero } from '@/lib/tablero/tipos';

interface Detalle { titulo: string; deals: Deal[] }

export default function TableroComercialPage() {
  const { user, isLoading: authLoading } = useAuth();
  const oscuro = useOscuro();
  // Cambia sola si la pestaña se queda abierta de un día para otro (al volver a verla).
  const [hoy, setHoy] = useState(() => hoyISO());
  const [inicial] = useState(() => tableroInicial(hoyISO()));

  const [deals, setDeals] = useState<Deal[]>([]);
  const [cargando, setCargando] = useState(true);
  const [fallo, setFallo] = useState(false);
  const [actualizando, setActualizando] = useState(false);
  const [miembros, setMiembros] = useState<Map<string, string>>(new Map());

  const [vistas, setVistas] = useState<VistaGuardada[]>([]);
  const [anteriores, setAnteriores] = useState<VistaAnterior[]>([]);
  const [vistaId, setVistaId] = useState<string | null>(null);
  const [tablero, setTablero] = useState<Tablero>(inicial);
  const [guardado, setGuardado] = useState(() => serializarTablero(inicial));

  const [editando, setEditando] = useState(false);
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<Detalle | null>(null);

  const ctx = useMemo<Contexto>(() => ({ hoy, nombreDe: id => miembros.get(id) }), [hoy, miembros]);
  const sinGuardar = useMemo(() => serializarTablero(tablero) !== guardado, [tablero, guardado]);
  const permitido = !!user?.email && TABLERO_EMAILS.includes(user.email);

  // ── Datos ──
  const cargarDeals = useCallback(async (silencioso = false) => {
    if (!silencioso) setActualizando(true);
    try {
      const r = await getDeals({});
      setDeals(r.deals as Deal[]);
      setFallo(false);
      if (!silencioso) toast.success('Datos actualizados');
    } catch {
      if (!silencioso) toast.error('No se pudieron actualizar los datos');
      else setFallo(true);
    } finally {
      setActualizando(false);
    }
  }, []);

  useEffect(() => {
    if (!permitido) return;
    let vivo = true;
    (async () => {
      const [d, v, m] = await Promise.allSettled([getDeals({}), getCommercialViews({}), getTeamMembers({})]);
      if (!vivo) return;
      if (d.status === 'fulfilled') setDeals(d.value.deals as Deal[]); else setFallo(true);
      if (m.status === 'fulfilled') setMiembros(new Map(m.value.members.map((x: { id: string; firstName?: string; lastName?: string }) => [x.id, [x.firstName, x.lastName].filter(Boolean).join(' ') || x.id])));
      if (v.status === 'fulfilled') {
        const todas = v.value.views as (VistaGuardada & VistaAnterior & { dateReference: string; filtersJson: string })[];
        const nuevas = todas.filter(x => esVistaTablero(x.viewId));
        setVistas(nuevas);
        setAnteriores(todas.filter(x => !esVistaTablero(x.viewId)));
        const abrir = nuevas.find(x => x.isDefault) ?? nuevas[0];
        if (abrir) {
          const t = leerTablero(abrir.widgetsJson, hoyISO()) ?? tableroInicial(hoyISO());
          setTablero(t);
          setGuardado(serializarTablero(t));
          setVistaId(abrir.viewId);
        }
      }
      setCargando(false);
    })();
    return () => { vivo = false; };
  }, [permitido]);

  // Aprobar un deal en otra pestaña no avisa a esta: al volver se vuelven a pedir, sin molestar.
  useEffect(() => {
    if (!permitido) return;
    const alVolver = () => {
      if (document.visibilityState !== 'visible') return;
      setHoy(h => { const ahora = hoyISO(); return ahora === h ? h : ahora; });
      void cargarDeals(true);
    };
    document.addEventListener('visibilitychange', alVolver);
    return () => document.removeEventListener('visibilitychange', alVolver);
  }, [permitido, cargarDeals]);

  // ── Resultados (cada bloque solo se recalcula si cambió su receta, lo del tablero o los datos; mover un bloque no recalcula nada) ──
  const memo = useRef(new Map<string, { clave: string; deals: Deal[]; ctx: Contexto; res: Resultado }>());
  const resultados = useMemo(() => {
    const m = new Map<string, Resultado>();
    for (const b of tablero.bloques) {
      const clave = JSON.stringify([b.consulta, tablero.periodo, tablero.comparacion, tablero.fecha, tablero.filtros]);
      const previo = memo.current.get(b.id);
      if (previo && previo.clave === clave && previo.deals === deals && previo.ctx === ctx) { m.set(b.id, previo.res); continue; }
      const res = ejecutar(resolverConsulta(b.consulta, tablero), deals, ctx);
      memo.current.set(b.id, { clave, deals, ctx, res });
      m.set(b.id, res);
    }
    return m;
  }, [tablero, deals, ctx]);

  const periodos = useMemo(() => resolverPeriodos(tablero.periodo, tablero.comparacion, hoy), [tablero.periodo, tablero.comparacion, hoy]);

  // ── Cambios al tablero ──
  const cambiar = (parche: Partial<Tablero>) => setTablero(t => ({ ...t, ...parche }));
  const cambiarBloque = (b: Bloque) => setTablero(t => ({ ...t, bloques: t.bloques.map(x => (x.id === b.id ? b : x)) }));

  /** Un tablero guardado no pasa de MAX_BLOQUES bloques (lo demás se descartaría al abrirlo): se avisa antes de llegar ahí. */
  const hayLugar = (): boolean => {
    if (tablero.bloques.length < MAX_BLOQUES) return true;
    toast.info(`El tablero ya tiene ${MAX_BLOQUES} bloques, que es el máximo`);
    return false;
  };

  const agregarBloque = () => {
    if (!hayLugar()) return;
    const tipo = 'barras';
    const t = TAMANO_INICIAL[tipo];
    const b = bloqueNuevo(tipo, { medidas: ['ingresos'], filas: { campo: 'tiempo', granularidad: 'mes' }, filtros: [] }, posNueva(tablero.bloques, t.w, t.h));
    setTablero(x => ({ ...x, bloques: [...x.bloques, b] }));
    setSeleccion(b.id);
    setEditando(true);
  };

  const duplicar = (b: Bloque) => {
    if (!hayLugar()) return;
    const copia: Bloque = { ...JSON.parse(JSON.stringify(b)), id: nuevoIdBloque(), titulo: `${b.titulo} (copia)`, pos: posNueva(tablero.bloques, b.pos.w, b.pos.h) };
    setTablero(x => ({ ...x, bloques: [...x.bloques, copia] }));
    setSeleccion(copia.id);
  };

  const quitar = (b: Bloque) => {
    const antes = tablero;
    setTablero(x => ({ ...x, bloques: x.bloques.filter(y => y.id !== b.id) }));
    if (seleccion === b.id) setSeleccion(null);
    toast(`Se quitó «${b.titulo}»`, { action: { label: 'Deshacer', onClick: () => setTablero(antes) }, duration: 6000 });
  };

  // ── Vistas ──
  const guardarVista = async (viewId: string | null, nombre: string, opciones: { isDefault?: boolean; soloEtiqueta?: boolean } = {}) => {
    const id = viewId ?? nuevoIdVista();
    const previa = vistas.find(v => v.viewId === id);
    // Renombrar o dejar una vista como predeterminada no guarda lo que se haya movido sin guardar: se vuelve a mandar tal cual lo que ya estaba guardado.
    const guardaLoQueHay = !(opciones.soloEtiqueta && previa);
    const json = guardaLoQueHay ? serializarTablero(tablero) : previa!.widgetsJson;
    const fecha = guardaLoQueHay ? tablero.fecha : (leerTablero(previa!.widgetsJson, hoy) ?? tablero).fecha;
    try {
      const r = await saveCommercialView({
        viewId: id,
        viewName: nombre,
        filtersJson: JSON.stringify({ v: 2 }),
        widgetsJson: json,
        dateReference: fecha.campo === 'propuesta' ? 'proposalDate' : 'approvalDate',
        isDefault: opciones.isDefault ?? previa?.isDefault ?? vistas.length === 0,
        isShared: previa?.isShared ?? false,
        sortOrder: previa?.sortOrder ?? vistas.length,
      });
      const guardada: VistaGuardada = { dbId: r.dbId, viewId: r.viewId, viewName: nombre, isDefault: opciones.isDefault ?? previa?.isDefault ?? vistas.length === 0, isShared: previa?.isShared ?? false, sortOrder: previa?.sortOrder ?? vistas.length, widgetsJson: json };
      setVistas(vs => {
        const sinEsta = vs.filter(v => v.viewId !== guardada.viewId).map(v => (guardada.isDefault ? { ...v, isDefault: false } : v));
        return [...sinEsta, guardada].sort((a, b) => a.sortOrder - b.sortOrder);
      });
      setVistaId(guardada.viewId);
      if (guardaLoQueHay) setGuardado(json);
      toast.success('Vista guardada');
    } catch {
      toast.error('No se pudo guardar la vista');
    }
  };

  const abrirVista = (v: VistaGuardada) => {
    if (sinGuardar && !window.confirm('Hay cambios sin guardar. ¿Descartarlos y abrir otra vista?')) return;
    const t = leerTablero(v.widgetsJson, hoy) ?? tableroInicial(hoy);
    setTablero(t);
    setGuardado(serializarTablero(t));
    setVistaId(v.viewId);
    setSeleccion(null);
  };

  const eliminarVista = async () => {
    const v = vistas.find(x => x.viewId === vistaId);
    if (!v) return;
    try {
      await deleteCommercialView({ viewId: v.viewId });
      const quedan = vistas.filter(x => x.viewId !== v.viewId);
      setVistas(quedan);
      const t = quedan[0] ? leerTablero(quedan[0].widgetsJson, hoy) ?? tableroInicial(hoy) : tableroInicial(hoy);
      setTablero(t);
      setGuardado(serializarTablero(t));
      setVistaId(quedan[0]?.viewId ?? null);
      setSeleccion(null);
      toast.success('Vista eliminada');
    } catch {
      toast.error('No se pudo eliminar la vista');
    }
  };

  const importar = (v: VistaAnterior) => {
    if (sinGuardar && !window.confirm('Hay cambios sin guardar. ¿Descartarlos y traer la vista del dashboard anterior?')) return;
    const t = desdeVistaAnterior(v, hoy, id => miembros.get(id));
    setTablero(t);
    setVistaId(null);
    setSeleccion(null);
    toast.success(`Se trajo «${v.viewName}». Revísala y guárdala con el nombre que quieras.`);
  };

  const descartar = () => {
    const t = leerTablero(guardado, hoy) ?? tableroInicial(hoy);
    setTablero(t);
    setSeleccion(null);
  };

  if (authLoading) return <div className="p-6"><Skeleton className="h-8 w-64" /></div>;
  if (!permitido) return <Navigate to="/comercial/dashboard" replace />;

  const activa = vistas.find(v => v.viewId === vistaId);
  const bloqueSel = tablero.bloques.find(b => b.id === seleccion);

  return (
    <div className="flex items-start">
      <div className="min-w-0 flex-1 space-y-4 p-6">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="flex items-center gap-2 text-lg font-bold"><LayoutDashboard className="h-5 w-5 text-primary" /> Tablero comercial</h2>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">Nuevo</span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <VistasTablero
              vistas={vistas}
              anteriores={anteriores}
              activaId={vistaId}
              sinGuardar={sinGuardar}
              onElegir={abrirVista}
              onGuardarComo={nombre => void guardarVista(null, nombre)}
              onRenombrar={nombre => void guardarVista(vistaId, nombre, { soloEtiqueta: true })}
              onPredeterminada={() => activa && void guardarVista(vistaId, activa.viewName, { isDefault: true, soloEtiqueta: true })}
              onEliminar={() => void eliminarVista()}
              onImportar={importar}
            />
            {sinGuardar && (
              <>
                <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={descartar}>Descartar cambios</Button>
                <Button size="sm" className="h-8 text-xs" onClick={() => (activa ? void guardarVista(vistaId, activa.viewName) : toast.info('Usa «Guardar como vista nueva» en el menú de vistas para ponerle nombre'))}>Guardar</Button>
              </>
            )}
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => void cargarDeals()} disabled={actualizando} title="Volver a pedir los deals" aria-label="Actualizar datos">
              <RefreshCcw className={`h-4 w-4 ${actualizando ? 'animate-spin' : ''}`} />
            </Button>
            {editando && <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={agregarBloque}><Plus className="h-3.5 w-3.5" /> Bloque</Button>}
            <Button variant={editando ? 'default' : 'outline'} size="sm" className="hidden h-8 gap-1 text-xs md:inline-flex" onClick={() => { setEditando(e => !e); if (editando) setSeleccion(null); }}>
              <Pencil className="h-3.5 w-3.5" /> {editando ? 'Listo' : 'Editar'}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <SelectorPeriodo valor={tablero.periodo} onChange={p => p && cambiar({ periodo: p })} hoy={hoy} />
            <SelectorComparacion valor={tablero.comparacion} onChange={c => c && cambiar({ comparacion: c })} />
            <SelectorFecha valor={tablero.fecha} onChange={f => f && cambiar({ fecha: f })} />
            <Filtros filtros={tablero.filtros} onChange={filtros => cambiar({ filtros })} deals={deals} ctx={ctx} />
          </div>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {periodos.etiquetaPrevio ? <>Comparando <b className="font-medium text-foreground">{periodos.etiquetaActual}</b> con <b className="font-medium text-foreground">{periodos.etiquetaPrevio}</b></> : <>Periodo: <b className="font-medium text-foreground">{periodos.etiquetaActual}</b></>}
            {' · '}{deals.length.toLocaleString('es-MX')} deals en total
            {periodos.aviso && <span className="ml-2 text-amber-600 dark:text-amber-400">{periodos.aviso}</span>}
          </p>
        </div>

        {cargando ? (
          <div className="grid grid-cols-4 gap-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)}</div>
        ) : fallo && deals.length === 0 ? (
          <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">No se pudieron cargar los deals. <button type="button" className="text-primary underline" onClick={() => void cargarDeals()}>Reintentar</button></div>
        ) : tablero.bloques.length === 0 ? (
          <div className="rounded-xl border border-dashed p-10 text-center">
            <p className="text-sm text-muted-foreground">Este tablero no tiene bloques todavía.</p>
            <Button size="sm" className="mt-3 gap-1" onClick={agregarBloque}><Plus className="h-4 w-4" /> Agregar el primero</Button>
          </div>
        ) : (
          <Rejilla
            bloques={tablero.bloques}
            editando={editando}
            onCambio={bloques => cambiar({ bloques })}
            dibujar={(b, { asa }) => (
              <BloqueCard
                bloque={b}
                res={resultados.get(b.id)!}
                hoy={hoy}
                oscuro={oscuro}
                editando={editando}
                seleccionado={seleccion === b.id}
                asa={asa}
                onEditar={() => setSeleccion(b.id)}
                onDuplicar={() => duplicar(b)}
                onEliminar={() => quitar(b)}
                onDetalle={(titulo, ds) => setDetalle({ titulo, deals: ds })}
              />
            )}
          />
        )}
      </div>

      {bloqueSel && editando && (
        <div className="sticky top-0 hidden w-[340px] shrink-0 self-start md:block" style={{ height: 'calc(100vh - 3rem)' }}>
          <EditorBloque bloque={bloqueSel} tablero={tablero} deals={deals} ctx={ctx} onCambio={cambiarBloque} onCerrar={() => setSeleccion(null)} />
        </div>
      )}

      <DrillDownSheet title={detalle?.titulo ?? ''} deals={(detalle?.deals ?? []) as never[]} open={!!detalle} onClose={() => setDetalle(null)} />
    </div>
  );
}
