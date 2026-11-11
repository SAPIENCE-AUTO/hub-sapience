import { useCallback, useEffect, useMemo, useState } from 'react';
import { calcularReclutadoresEstadistica, deleteReclutador, getReclutadoresEstadistica, saveReclutador, saveReclutadorAsignacion } from 'zite-endpoints-sdk';
import { toast } from 'sonner';
import { Loader2, RefreshCw, Search, Sparkles, TrendingUp, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Segmentado } from '@/components/payments/Segmentado';
import { CLASE_BOTON_SUAVE, ESTILO_BOTON_PRIMARIO } from '@/components/payments/estilos';
import { PERIODOS } from '../../lib/indicadores/reclutamiento';
import {
  SUJETO_TODOS, conteoCero, normalizarNombre, reclutadorParecido, repartir, sugerirGrupos, traeElegibilidad, traeEvolucion,
  type Asignacion, type DatosReclutadores, type GrupoSugerido, type Periodo, type Reclutador, type SalidaReclutadores,
} from '../../lib/indicadores/reclutadores';
import { TEAL } from '../../lib/toolColors';
import { LeyendaBarra } from './BarraNuevasRepetidas';
import { EvolucionReclutador } from './EvolucionReclutador';
import { fmtInstante, fmtNum, fmtPct } from './formato';
import { SugerenciasReclutadores } from './SugerenciasReclutadores';
import { TablaReclutadores, type FilaReclutador } from './TablaReclutadores';
import { TablaSinAsignar, type FilaSinAsignar } from './TablaSinAsignar';

type Destino = { tipo: 'reclutador'; id: string } | { tipo: 'nuevo'; nombre: string } | { tipo: 'ignorar' } | { tipo: 'quitar' };

const mensaje = (e: unknown, defecto: string) => (e instanceof Error && e.message && e.message !== 'Error interno' ? e.message : defecto);
/** Cuántas formas sin asignar se pintan de una vez (el resto, con «Mostrar más»): son más de dos mil. */
const PAGINA = 100;

function Cifra({ titulo, valor, detalle, color }: { titulo: string; valor: string; detalle: string; color?: string }) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</div>
      <div className="mt-0.5 text-[22px] font-bold leading-tight tabular-nums" style={color ? { color } : undefined}>{valor}</div>
      <div className="text-xs text-muted-foreground">{detalle}</div>
    </div>
  );
}

/**
 * «Por reclutador»: de las respuestas que lleva el nombre de cada reclutador (la pregunta NR), cuántas son de gente nueva y cuántas de gente que ya había
 * llenado otro filtro. Los nombres los escribe cada participante («manuel», «manel», «manu»), así que aquí mismo se juntan: cada cambio rehace las
 * cuentas al instante, porque todo es sumar lo ya contado por forma de escribir el nombre. Lo contado lo calcula el servidor con «Actualizar».
 */
export function PorReclutador() {
  const [datos, setDatos] = useState<DatosReclutadores | undefined>();
  const [calculadoEn, setCalculadoEn] = useState<string | undefined>();
  const [reclutadores, setReclutadores] = useState<Reclutador[]>([]);
  const [alias, setAlias] = useState<Record<string, Asignacion>>({});
  const [sinTablas, setSinTablas] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [calculando, setCalculando] = useState(false);
  const [progreso, setProgreso] = useState('');
  const [guardando, setGuardando] = useState(false);

  const [periodo, setPeriodo] = useState<Periodo>('12m');
  const [busqueda, setBusqueda] = useState('');
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  const [limite, setLimite] = useState(PAGINA);
  const [verSueltas, setVerSueltas] = useState(false);
  const [destinoSel, setDestinoSel] = useState('');
  const [nombreNuevo, setNombreNuevo] = useState('');
  const [grupos, setGrupos] = useState<GrupoSugerido[] | null>(null);
  /** A quién se le está viendo la evolución mes por mes (el id del reclutador, o `SUJETO_TODOS`); `null` si la ventana está cerrada. */
  const [evolucion, setEvolucion] = useState<string | null>(null);

  const aplicar = (r: SalidaReclutadores) => {
    setDatos(r.datos);
    setCalculadoEn(r.calculadoEn);
    setReclutadores(r.reclutadores);
    setAlias(Object.fromEntries(r.alias.map((a) => [a.clave, { reclutadorId: a.reclutadorId, ignorar: a.ignorar }])));
    setSinTablas(r.sinTablas);
  };

  const cargar = useCallback(async () => {
    try {
      aplicar(await getReclutadoresEstadistica({}));
    } catch (e) {
      toast.error(mensaje(e, 'No se pudo cargar la estadística por reclutador'));
    }
    setCargando(false);
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  const calcular = async () => {
    setCalculando(true);
    setProgreso('Empezando…');
    try {
      const flujo = calcularReclutadoresEstadistica({});
      for await (const ch of flujo) if (ch?.paso) setProgreso(ch.total ? `${ch.paso} ${ch.hechos} de ${ch.total}` : ch.paso);
      aplicar(await flujo);
      toast.success('Estadística por reclutador actualizada');
    } catch (e) {
      toast.error(mensaje(e, 'No se pudo calcular la estadística por reclutador'));
    }
    setCalculando(false);
    setProgreso('');
  };

  // ── lo que se ve, calculado de lo que ya hay: juntar un nombre solo cambia estas sumas ──
  const escrituras = useMemo(() => new Map((datos?.escrituras ?? []).map((e) => [e.clave, e])), [datos]);
  const asignaciones = useMemo(() => new Map(Object.entries(alias)), [alias]);
  const reparto = useMemo(() => (datos ? repartir(datos, periodo, asignaciones) : null), [datos, periodo, asignaciones]);
  const consulta = normalizarNombre(busqueda);
  const conElegibilidad = traeElegibilidad(datos);
  const conEvolucion = traeEvolucion(datos);
  /** Las formas de escribir el nombre de cada reclutador (no cambian con el periodo): con ellas la evolución suma sus meses. */
  const clavesPorReclutador = useMemo(() => new Map(reclutadores.map((r) => [r.id, reparto?.porReclutador.get(r.id)?.claves ?? []] as const)), [reclutadores, reparto]);

  const filasReclutadores = useMemo<FilaReclutador[]>(() => reclutadores
    .map((r) => ({ id: r.id, nombre: r.nombre, conteo: reparto?.porReclutador.get(r.id)?.conteo ?? conteoCero(), claves: reparto?.porReclutador.get(r.id)?.claves ?? [] }))
    .filter((f) => !consulta || normalizarNombre(f.nombre).includes(consulta) || f.claves.some((c) => c.includes(consulta))),
  [reclutadores, reparto, consulta]);

  const sinAsignar = useMemo(() => (datos?.escrituras ?? [])
    .filter((e) => !asignaciones.has(e.clave) && e.c[periodo][0] > 0 && (!consulta || e.clave.includes(consulta)))
    .sort((a, b) => b.c[periodo][0] - a.c[periodo][0] || a.clave.localeCompare(b.clave)),
  [datos, asignaciones, periodo, consulta]);
  const visibles = useMemo(() => (verSueltas ? sinAsignar : sinAsignar.filter((e) => e.c.todo[0] >= 2)), [sinAsignar, verSueltas]);
  const sueltasOcultas = sinAsignar.length - visibles.length;

  // Para sugerir «¿es Mateo Medina?» basta comparar con sus formas más usadas.
  const referencias = useMemo(() => reclutadores.map((r) => ({
    id: r.id,
    claves: [...(reparto?.porReclutador.get(r.id)?.claves ?? [])].sort((a, b) => (escrituras.get(b)?.c.todo[0] ?? 0) - (escrituras.get(a)?.c.todo[0] ?? 0)).slice(0, 5),
  })), [reclutadores, reparto, escrituras]);
  const filasSinAsignar = useMemo<FilaSinAsignar[]>(() => visibles.slice(0, limite).map((e) => {
    const id = referencias.length ? reclutadorParecido(e.clave, referencias) : null;
    const nombre = id ? reclutadores.find((r) => r.id === id)?.nombre : undefined;
    return { e, conteo: e.c[periodo], ...(id && nombre ? { parecido: { id, nombre } } : {}) };
  }), [visibles, limite, periodo, referencias, reclutadores]);

  const resumen = useMemo(() => {
    if (!reparto) return null;
    const asignadas = [...reparto.porReclutador.values()].reduce((s, g) => s + g.conteo[0], 0);
    const sueltas = reparto.sinAsignar.conteo[0];
    const aparte = reparto.sinNombre[0] + reparto.ignoradas.conteo[0];
    const total = asignadas + sueltas + aparte;
    return { asignadas, sueltas, aparte, total, formasSueltas: sinAsignar.length };
  }, [reparto, sinAsignar.length]);
  const pct = (n: number) => (resumen && resumen.total > 0 ? fmtPct((100 * n) / resumen.total) : '—');

  // ── guardar (cada cambio vuelve a sumar al instante) ──
  const guardar = async (asignacionesNuevas: Array<{ claves: string[]; destino: Destino }>, ok?: string) => {
    setGuardando(true);
    try {
      const r = await saveReclutadorAsignacion({ asignaciones: asignacionesNuevas });
      setReclutadores(r.reclutadores);
      setAlias((a) => {
        const n = { ...a };
        for (const c of r.cambios as Array<{ clave: string; reclutadorId: string | null; ignorar: boolean }>) {
          if (c.reclutadorId || c.ignorar) n[c.clave] = { reclutadorId: c.reclutadorId, ignorar: c.ignorar }; else delete n[c.clave];
        }
        return n;
      });
      setSeleccion(new Set());
      if (ok) toast.success(ok);
      return r as { reclutadores: Reclutador[]; cambios: Array<{ clave: string; reclutadorId: string | null; ignorar: boolean }> };
    } catch (e) {
      toast.error(mensaje(e, 'No se pudo guardar'));
      return null;
    } finally {
      setGuardando(false);
    }
  };
  const abrirReclutador = (id: string | null | undefined) => { if (id) setExpandidos((x) => new Set(x).add(id)); };

  const juntarSeleccion = async () => {
    const claves = [...seleccion];
    const nuevo = destinoSel === '__nuevo';
    const destino: Destino = nuevo ? { tipo: 'nuevo', nombre: nombreNuevo } : { tipo: 'reclutador', id: destinoSel };
    if ((nuevo && !nombreNuevo.trim()) || !destinoSel) return;
    const r = await guardar([{ claves, destino }], `Se juntaron ${claves.length} ${claves.length === 1 ? 'forma' : 'formas'}`);
    if (r) { abrirReclutador(r.cambios[0]?.reclutadorId); setDestinoSel(''); setNombreNuevo(''); }
  };
  const crearDesde = async (clave: string, nombre: string) => {
    const r = await guardar([{ claves: [clave], destino: { tipo: 'nuevo', nombre } }], `Reclutador creado: ${nombre}`);
    if (r) abrirReclutador(r.cambios[0]?.reclutadorId);
  };
  const juntarCon = async (clave: string, id: string) => {
    const r = await guardar([{ claves: [clave], destino: { tipo: 'reclutador', id } }]);
    if (r) abrirReclutador(id);
  };
  const renombrar = async (id: string, nombre: string) => {
    try {
      const r = await saveReclutador({ id, nombre });
      setReclutadores((rs) => rs.map((x) => (x.id === id ? r.reclutador : x)).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')));
      return true;
    } catch (e) {
      toast.error(mensaje(e, 'No se pudo cambiar el nombre'));
      return false;
    }
  };
  const eliminar = async (id: string) => {
    try {
      const r = await deleteReclutador({ id });
      setReclutadores((rs) => rs.filter((x) => x.id !== id));
      setAlias((a) => { const n = { ...a }; for (const c of r.claves as string[]) delete n[c]; return n; });
      toast.success('Reclutador borrado; sus formas de escribir el nombre quedaron sin asignar');
    } catch (e) {
      toast.error(mensaje(e, 'No se pudo borrar'));
    }
  };
  const crearSugeridos = async (lista: Array<{ nombre: string; claves: string[] }>) => {
    const r = await guardar(lista.map((g) => ({ claves: g.claves, destino: { tipo: 'nuevo', nombre: g.nombre } as Destino })), `Se crearon ${lista.length} ${lista.length === 1 ? 'reclutador' : 'reclutadores'}`);
    return !!r;
  };
  const abrirSugerencias = () => {
    const pendientes = (datos?.escrituras ?? []).filter((e) => !asignaciones.has(e.clave)).map((e) => ({ clave: e.clave, n: e.c.todo[0] }));
    setGrupos(sugerirGrupos(pendientes));
  };

  const marcar = (clave: string, marcada: boolean) => setSeleccion((s) => { const n = new Set(s); if (marcada) n.add(clave); else n.delete(clave); return n; });
  const marcarVarias = (claves: string[], marcadas: boolean) => setSeleccion((s) => { const n = new Set(s); for (const c of claves) { if (marcadas) n.add(c); else n.delete(c); } return n; });
  const alternarFila = (id: string) => setExpandidos((x) => { const n = new Set(x); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const respuestasSeleccion = [...seleccion].reduce((s, c) => s + (escrituras.get(c)?.c[periodo][0] ?? 0), 0);
  const algunaAsignada = [...seleccion].some((c) => asignaciones.has(c));
  const sinAcciones = sinTablas || guardando;

  if (cargando) {
    return <div className="space-y-4"><div className="grid grid-cols-1 gap-4 sm:grid-cols-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div><Skeleton className="h-64 rounded-xl" /></div>;
  }

  if (!datos) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border bg-card px-6 py-14 text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl" style={{ backgroundColor: TEAL }}><Users className="h-5 w-5 text-white" /></div>
        <p className="text-sm font-semibold">Todavía no se ha contado la estadística por reclutador</p>
        <p className="max-w-md text-xs text-muted-foreground">Se lee el nombre que escribió cada participante en cada respuesta y se cuenta quién era nuevo y quién ya había llenado otro filtro. Tarda uno o dos minutos y se guarda, para que esta pantalla abra al instante.</p>
        <Button className="gap-1.5 rounded-[10px] px-4 hover:brightness-110" style={ESTILO_BOTON_PRIMARIO} onClick={calcular} disabled={calculando}>
          {calculando ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {calculando ? (progreso || 'Calculando…') : 'Calcular ahora'}
        </Button>
      </div>
    );
  }

  return (
    <div className={seleccion.size > 0 ? 'pb-24' : ''}>
      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2.5">
        <Segmentado<Periodo> etiqueta="Periodo" valor={periodo} onCambio={(p) => { setPeriodo(p); setLimite(PAGINA); }} opciones={PERIODOS.map((p) => ({ valor: p.valor, etiqueta: p.etiqueta }))} />
        <label className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            aria-label="Buscar un nombre"
            placeholder="Buscar un nombre…"
            value={busqueda}
            onChange={(e) => { setBusqueda(e.target.value); setLimite(PAGINA); }}
            className="w-56 rounded-[10px] border bg-card py-1.5 pl-8 pr-2.5 text-xs outline-none focus:ring-2 focus:ring-[#0F3D4D]/40"
          />
        </label>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">{calculadoEn ? `Contado el ${fmtInstante(calculadoEn)}` : ''}</span>
          <button
            type="button"
            onClick={() => setEvolucion(SUJETO_TODOS)}
            disabled={!conEvolucion}
            title={conEvolucion ? 'Ver mes por mes lo que han traído todos los reclutadores, o uno solo' : 'Pulsa «Actualizar» para ver la evolución mes por mes'}
            className={CLASE_BOTON_SUAVE}
          ><TrendingUp className="h-3.5 w-3.5" />Evolución</button>
          <button type="button" onClick={abrirSugerencias} disabled={sinAcciones} className={CLASE_BOTON_SUAVE}><Sparkles className="h-3.5 w-3.5" />Sugerir reclutadores</button>
          <button type="button" onClick={calcular} disabled={calculando} className={CLASE_BOTON_SUAVE}>
            {calculando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {calculando ? (progreso || 'Calculando…') : 'Actualizar'}
          </button>
        </span>
      </div>

      {sinTablas && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-950">
          Todavía no existen las tablas donde se guarda quién es quién, así que se pueden ver los números pero no juntar nombres. Hay que crearlas (add-reclutadores-tables.ts).
        </div>
      )}

      {!conElegibilidad && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-950">
          Este conteo es de la versión anterior y todavía no trae «no elegibles», «entraron a un grupo» ni las repetidas hasta «8 o más» proyectos antes. Pulsa «Actualizar» para verlos.
        </div>
      )}

      {conElegibilidad && !conEvolucion && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-950">
          Este conteo todavía no trae el mes por mes de la evolución. Pulsa «Actualizar» para verla.
        </div>
      )}

      {resumen && (
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Cifra titulo="Con reclutador" valor={pct(resumen.asignadas)} detalle={`${fmtNum(resumen.asignadas)} de ${fmtNum(resumen.total)} respuestas, con ${fmtNum(reclutadores.length)} ${reclutadores.length === 1 ? 'reclutador' : 'reclutadores'}`} color="#257E55" />
          <Cifra titulo="Sin asignar" valor={pct(resumen.sueltas)} detalle={`${fmtNum(resumen.sueltas)} respuestas en ${fmtNum(resumen.formasSueltas)} formas de escribir el nombre`} color={resumen.sueltas > 0 ? '#DC7A09' : undefined} />
          <Cifra titulo="Sin nombre o «no es reclutador»" valor={pct(resumen.aparte)} detalle={`${fmtNum(resumen.aparte)} respuestas: vacías, «nadie», o marcadas por ti`} />
        </div>
      )}
      <div className="mb-4"><LeyendaBarra /></div>

      <h2 className="mb-2 text-sm font-semibold">Reclutadores</h2>
      <div className="mb-6">
        <TablaReclutadores
          filas={filasReclutadores}
          escrituras={escrituras}
          periodo={periodo}
          conElegibilidad={conElegibilidad}
          conEvolucion={conEvolucion}
          onEvolucion={setEvolucion}
          seleccion={seleccion}
          expandidos={expandidos}
          onSeleccionar={marcar}
          onExpandir={alternarFila}
          onRenombrar={renombrar}
          onEliminar={eliminar}
          onSeparar={(claves) => void guardar([{ claves, destino: { tipo: 'quitar' } }])}
          deshabilitado={sinAcciones}
        />
      </div>

      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Sin asignar</h2>
        <span className="text-xs text-muted-foreground">Marca las que sean la misma persona y júntalas abajo, o resuélvelas una por una. Las más usadas van primero.</span>
      </div>
      {visibles.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-6 text-center text-xs text-muted-foreground">
          {consulta ? 'Ningún nombre sin asignar coincide con la búsqueda.' : 'No queda nada por asignar en este periodo.'}
        </p>
      ) : (
        <TablaSinAsignar
          filas={filasSinAsignar}
          periodo={periodo}
          conElegibilidad={conElegibilidad}
          seleccion={seleccion}
          onSeleccionar={marcar}
          onSeleccionarTodas={marcarVarias}
          onJuntarCon={juntarCon}
          onCrear={crearDesde}
          onIgnorar={(clave) => void guardar([{ claves: [clave], destino: { tipo: 'ignorar' } }])}
          deshabilitado={sinAcciones}
        />
      )}
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        {visibles.length > limite && (
          <button type="button" onClick={() => setLimite((l) => l + PAGINA)} className="font-semibold text-foreground hover:underline">Mostrar {Math.min(PAGINA, visibles.length - limite)} más (faltan {fmtNum(visibles.length - limite)})</button>
        )}
        {sueltasOcultas > 0 && !verSueltas && (
          <span>Hay {fmtNum(sueltasOcultas)} formas que aparecen una sola vez; no se muestran. <button type="button" onClick={() => setVerSueltas(true)} className="font-semibold text-foreground hover:underline">Mostrarlas</button></span>
        )}
        {verSueltas && <button type="button" onClick={() => setVerSueltas(false)} className="font-semibold text-foreground hover:underline">Ocultar las que aparecen una sola vez</button>}
      </div>

      <div className="mt-6 space-y-1 text-[11px] leading-relaxed text-muted-foreground">
        <p><b>Aquí se cuentan respuestas, no personas que asistieron.</b> <b>Respuesta:</b> una vez que alguien llenó un filtro; si la misma respuesta está copiada en varios tableros, cuenta una sola vez, y quien llenó tres filtros aporta tres respuestas (haya asistido o no). <b>Nueva:</b> esa persona no tenía ninguna respuesta en un proyecto anterior. <b>Repetida:</b> ya tenía una, y el color dice en cuántos proyectos anteriores (de 1 a 7, u 8 o más; se cuentan proyectos, no respuestas, y se ordenan por su fecha de inicio). Las respuestas del mismo proyecto que la primera cuentan como nuevas: son pasos del mismo reclutamiento.</p>
        <p><b>Contacto compartido:</b> un correo o teléfono con varios nombres distintos y cinco o más respuestas (quien recluta en campo llena por el participante): no es una persona que repite, así que no cuenta como nueva ni como repetida. <b>Sin nombre:</b> la respuesta no trae el nombre de quien invitó, o dice «nadie» o «no sé».</p>
        <p><b>No elegible:</b> la persona ya había participado con el mismo cliente, o en cualquier proyecto en los 6 meses anteriores al inicio del proyecto donde se recibió la respuesta (la misma regla de los íconos del tablero y de Metas por área); se mide sobre las respuestas sin contar el contacto compartido. <b>Entró a un grupo:</b> en alguno de los tableros donde está la respuesta, asistió o está en un grupo con estatus vacío, pendiente o confirmado. Las respuestas de proyectos recientes todavía pueden entrar a un grupo, así que en periodos cortos «entraron» sale más bajo.</p>
        <p>El nombre lo escribe el participante: sirve como termómetro, no como calificación exacta. Reclutar gente que ya conocíamos no siempre es malo (por ejemplo, en tableros de rescatados o con perfiles escasos), por eso se muestran las dos cifras. Los periodos se miden con la fecha de inicio del proyecto de cada respuesta.</p>
        {datos.sinFecha > 0 && <p>{fmtNum(datos.sinFecha)} respuestas quedaron fuera por no haber ninguna fecha de su proyecto.</p>}
        {datos.contactosCompartidos > 0 && <p>{fmtNum(datos.contactosCompartidos)} «personas» se trataron como un contacto compartido.</p>}
      </div>

      {seleccion.size > 0 && (
        <div role="region" aria-label="Juntar lo marcado" className="fixed inset-x-0 bottom-5 z-30 mx-auto flex w-fit max-w-[96vw] flex-wrap items-center gap-2 rounded-xl border bg-card px-3 py-2.5 shadow-lg">
          <span className="text-xs font-semibold">{fmtNum(seleccion.size)} {seleccion.size === 1 ? 'forma marcada' : 'formas marcadas'} ({fmtNum(respuestasSeleccion)} respuestas)</span>
          <select aria-label="Juntar con" value={destinoSel} onChange={(e) => setDestinoSel(e.target.value)} className="rounded-[10px] border bg-muted px-2.5 py-1.5 text-xs font-semibold outline-none focus:ring-2 focus:ring-[#0F3D4D]/40">
            <option value="">Juntar con…</option>
            {reclutadores.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
            <option value="__nuevo">＋ Un reclutador nuevo…</option>
          </select>
          {destinoSel === '__nuevo' && (
            <input
              autoFocus
              aria-label="Nombre del reclutador nuevo"
              placeholder="Nombre del reclutador"
              value={nombreNuevo}
              maxLength={60}
              onChange={(e) => setNombreNuevo(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void juntarSeleccion(); }}
              className="w-48 rounded-[10px] border bg-background px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-[#0F3D4D]/40"
            />
          )}
          <Button type="button" size="sm" className="rounded-[10px] px-3 hover:brightness-110" style={ESTILO_BOTON_PRIMARIO} onClick={juntarSeleccion} disabled={sinAcciones || !destinoSel || (destinoSel === '__nuevo' && !nombreNuevo.trim())}>
            {guardando && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Juntar
          </Button>
          <button type="button" disabled={sinAcciones} onClick={() => void guardar([{ claves: [...seleccion], destino: { tipo: 'ignorar' } }])} className={CLASE_BOTON_SUAVE}>No es reclutador</button>
          {algunaAsignada && <button type="button" disabled={sinAcciones} onClick={() => void guardar([{ claves: [...seleccion], destino: { tipo: 'quitar' } }])} className={CLASE_BOTON_SUAVE}>Dejar sin asignar</button>}
          <button type="button" onClick={() => setSeleccion(new Set())} className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">Cancelar</button>
        </div>
      )}

      <SugerenciasReclutadores abierto={grupos !== null} grupos={grupos ?? []} escrituras={escrituras} onCerrar={() => setGrupos(null)} onCrear={crearSugeridos} />

      {evolucion !== null && conEvolucion && (
        <EvolucionReclutador sujetoInicial={evolucion} periodoInicial={periodo} datos={datos} reclutadores={reclutadores} clavesPorReclutador={clavesPorReclutador} onCerrar={() => setEvolucion(null)} />
      )}
    </div>
  );
}
