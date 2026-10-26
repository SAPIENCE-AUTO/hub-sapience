import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CalendarCheck, CalendarPlus, ChevronDown, History, Loader2, Paperclip, Plus, Trash2, Undo2, Users } from 'lucide-react';
import {
  comentarMuestra, getMuestra, linkGroupToEvent, proponerMuestra, publishRecruitmentGroupsChanged, saveBoard, saveBoardColumn, saveCalendarEvent, saveMuestra,
} from 'zite-endpoints-sdk';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DatetimePicker } from '@/components/pm/EventFormFields';
import { ALERTA, EXITO, GRIS, TEAL } from '@/lib/toolColors';
import { MarcaIA, botonTeal } from '@/components/formularios/generador/comun';
import { InsumosMuestra, cuantosInsumos, type Reunion, type VistaInsumos } from './InsumosMuestra';
import {
  GENEROS, MODALIDADES, TECNICAS, ORDEN_TECNICAS, cambiosEntre, colorDeGrupo, detallesDe, edadCorta, esGenero, fechaCorta, leerMuestra, letraDePerfil, lugares,
  nombreDeEvento, nombreDeGrupo, nombreExterno, nuevaActividad, nuevoPerfil, pendientesDeCrear, porPerfil, porTecnica,
  type Actividad, type DefinicionMuestra, type Modalidad, type PerfilMuestra, type Tecnica,
} from '@/lib/reclutamiento/muestra';

interface Avance { total: number; confirmados: number; porEstatus: Record<string, number> }
interface Datos {
  muestra: { id: string; version: number; definicion: unknown; tableroId?: string; calendarioId?: string; updatedAt: string } | null;
  versiones: { version: number; cambios: string[]; motivo?: string; por?: string; fecha: string }[];
  avance: Record<string, Avance>;
  tableros: { id: string; nombre: string }[];
  calendarios: { id: string; nombre: string }[];
  perfiles: { nombre: string; meta: number }[];
  hayInsumos: boolean;
  insumos: VistaInsumos;
  reuniones: Reunion[];
}

const VACIA: DefinicionMuestra = { actividades: [] };
const fechaVersion = (iso: string) => new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * Reclutamiento → Muestra (pedido de Sergio, 2026-10-26): las actividades del
 * estudio por técnica, con fecha, lugar, perfil y cupo. Se edita aquí y se
 * guarda como versión (con qué cambió y por qué). «Crear grupos y eventos…»
 * hace cada actividad un grupo del tablero y un evento del calendario, ya
 * ligados; asignar a alguien es moverlo a su grupo, y aquí se ve el avance.
 * Ningún cambio mueve ni borra gente. Los insumos que lee la IA están a la
 * vista y se les suman archivos, imágenes y texto; lo que propone se corrige
 * pidiéndole cambios con palabras.
 */
export function MuestraPanel({ proyectoId, projectCode, onCambio }: { proyectoId: string; projectCode: string; onCambio?: () => void }) {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [borrador, setBorrador] = useState<DefinicionMuestra>(VACIA);
  const [verCambios, setVerCambios] = useState(false);
  const [guardar, setGuardar] = useState<{ motivo: string } | null>(null);
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const [quitar, setQuitar] = useState<Actividad | null>(null);
  /** «Crear grupos y eventos…»: qué crear y dónde (se pregunta siempre). `calendario: 'nuevo'` crea «Calendario de sesiones». */
  const [crearCon, setCrearCon] = useState<{ grupos: boolean; eventos: boolean; tablero: string; calendario: string } | null>(null);
  const [verInsumos, setVerInsumos] = useState(false);
  const [pedido, setPedido] = useState('');
  /** El último cambio de la IA, para enseñarlo y poder deshacerlo. */
  const [cambioIA, setCambioIA] = useState<{ antes: DefinicionMuestra; cambios: string[]; nota?: string } | null>(null);

  const guardada = useMemo(() => (datos?.muestra ? leerMuestra(datos.muestra.definicion) : VACIA), [datos]);
  const cargar = useCallback(async () => {
    const d = (await getMuestra({ proyectoId })) as Datos;
    setDatos(d);
    setBorrador(d.muestra ? leerMuestra(d.muestra.definicion) : VACIA);
    setCambioIA(null);
  }, [proyectoId]);
  useEffect(() => { cargar().catch((e) => toast.error((e as Error).message || 'No se pudo cargar la muestra')); }, [cargar]);

  const cambios = useMemo(() => {
    const c = cambiosEntre(guardada, borrador);
    if ((guardada.supuestos?.length ?? 0) && !borrador.supuestos?.length) c.push('Se revisaron los supuestos de la IA');
    return c;
  }, [guardada, borrador]);
  const sucia = cambios.length > 0 || (!datos?.muestra && borrador.actividades.length > 0);

  const cambiar = (id: string, cambio: Partial<Actividad>) => setBorrador((b) => ({ ...b, actividades: b.actividades.map((a) => (a.id === id ? { ...a, ...cambio } : a)) }));
  const agregar = (tecnica: Tecnica) => setBorrador((b) => ({ ...b, actividades: [...b.actividades, nuevaActividad(b.actividades, tecnica)] }));
  const quitarActividad = (id: string) => setBorrador((b) => ({ ...b, actividades: b.actividades.filter((a) => a.id !== id) }));
  // Perfiles: renombrar uno renombra el perfil de sus actividades; quitarlo las deja sin perfil.
  const cambiarPerfil = (id: string, c: Partial<PerfilMuestra>) => setBorrador((b) => ({
    ...b,
    perfiles: (b.perfiles ?? []).map((p) => (p.id === id ? { ...p, ...c } : p)),
    actividades: c.nombre !== undefined ? b.actividades.map((a) => (a.perfilId === id ? { ...a, perfil: c.nombre } : a)) : b.actividades,
  }));
  const agregarPerfil = () => setBorrador((b) => ({ ...b, perfiles: [...(b.perfiles ?? []), nuevoPerfil({ nombre: `Perfil ${(b.perfiles?.length ?? 0) + 1}` })] }));
  const quitarPerfil = (id: string) => setBorrador((b) => ({
    ...b,
    perfiles: (b.perfiles ?? []).filter((p) => p.id !== id),
    actividades: b.actividades.map((a) => { if (a.perfilId !== id) return a; const { perfilId: _i, perfil: _n, ...resto } = a; return resto; }),
  }));

  // ── IA ──────────────────────────────────────────────────────────────────────
  const proponer = async () => {
    setTrabajando('La IA está leyendo los insumos…');
    try {
      const s = proponerMuestra({ proyectoId });
      for await (const c of s) if (c?.paso) setTrabajando(c.paso);
      const r = await s;
      setBorrador(leerMuestra(r.definicion));
      setVerInsumos(false);
      toast.success('La IA propuso la muestra: revísala, pídele cambios y guárdala.');
    } catch (e) {
      toast.error((e as Error).message || 'La IA no pudo proponer la muestra');
    } finally {
      setTrabajando(null);
    }
  };

  const pedirCambio = async () => {
    const comentario = pedido.trim();
    if (!comentario) return;
    const antes = borrador;
    setTrabajando('La IA está haciendo el cambio…');
    try {
      const s = comentarMuestra({ proyectoId, definicion: antes, comentario });
      for await (const c of s) if (c?.paso) setTrabajando(c.paso);
      const r = await s;
      const despues = leerMuestra(r.definicion);
      const cambios = cambiosEntre(antes, despues);
      setBorrador(despues);
      setCambioIA({ antes, cambios, nota: r.nota });
      if (cambios.length) setPedido('');
    } catch (e) {
      toast.error((e as Error).message || 'La IA no pudo hacer el cambio');
    } finally {
      setTrabajando(null);
    }
  };

  // ── guardar (versión nueva) y poner al día grupos y eventos que ya existen ──
  const confirmarGuardar = async () => {
    if (!datos) return;
    const motivo = guardar?.motivo.trim() || (borrador.origen === 'ia' && !datos.muestra ? 'Propuesta de la IA' : undefined);
    setGuardar(null);
    setTrabajando('Guardando…');
    try {
      const lista = cambios.length ? cambios : [`Primera versión: ${borrador.actividades.length} actividades`];
      await saveMuestra({ proyectoId, definicion: borrador, cambios: lista, motivo, versionBase: datos.muestra?.version ?? 0 });
      await ponerAlDia(guardada, borrador);
      setCambioIA(null);
      toast.success('Muestra guardada');
      await cargar();
      onCambio?.();
    } catch (e) {
      toast.error((e as Error).message || 'No se pudo guardar la muestra');
    } finally {
      setTrabajando(null);
    }
  };

  /**
   * Lo que cambió de una actividad que ya tiene evento, también en el
   * calendario. Los nombres de los grupos los pone al día el servidor al guardar.
   */
  const ponerAlDia = async (antes: DefinicionMuestra, despues: DefinicionMuestra) => {
    const tablero = datos?.muestra?.tableroId;
    const calendario = datos?.calendarios.find((c) => c.id === datos?.muestra?.calendarioId);
    for (const a of despues.actividades) {
      const v = antes.actividades.find((x) => x.id === a.id);
      if (!v) continue;
      const delEvento = (x: Actividad, def: DefinicionMuestra) => [nombreDeEvento(x, def), x.fecha, x.duracionMin, x.lugar, x.perfil].join('|');
      if (a.eventoId && calendario && delEvento(a, despues) !== delEvento(v, antes)) {
        await saveCalendarEvent({
          id: a.eventoId, eventName: nombreDeEvento(a, despues), projectCode, calendarName: calendario.nombre, boardId: calendario.id,
          ...(a.fecha ? { eventDate: new Date(a.fecha).toISOString() } : {}),
          ...(a.duracionMin ? { durationHours: a.duracionMin / 60 } : {}),
          ...(a.lugar ? { location: a.lugar } : {}),
          dinamica: TECNICAS[a.tecnica].nombre, ...(a.perfil ? { perfil: a.perfil } : {}),
        });
      }
    }
    if (tablero) publishRecruitmentGroupsChanged({ projectCode, boardId: tablero, changeType: 'structure' }).catch(() => {});
  };

  // ── crear grupos y eventos ──────────────────────────────────────────────────
  const pendientes = pendientesDeCrear(guardada.actividades);
  /** Abre la ventana: qué crear (grupos, eventos o los dos) y en qué tablero y calendario. */
  const abrirCrear = () => {
    if (!datos?.muestra) return;
    setCrearCon({
      grupos: pendientes.grupos.length > 0,
      eventos: pendientes.eventos.length > 0,
      tablero: datos.muestra.tableroId ?? (datos.tableros.length === 1 ? datos.tableros[0].id : ''),
      calendario: datos.muestra.calendarioId ?? (datos.calendarios.length === 1 ? datos.calendarios[0].id : datos.calendarios.length ? '' : 'nuevo'),
    });
  };
  const crear = async (op: { grupos: boolean; eventos: boolean; tablero: string; calendario: string }) => {
    if (!datos?.muestra) return;
    setCrearCon(null);
    setTrabajando('Creando…');
    // Los grupos de una muestra viven en un solo tablero y sus eventos en un solo calendario (así se lee el avance).
    const tableroId = datos.muestra.tableroId ?? (op.grupos ? op.tablero : undefined);
    let calendario = datos.calendarios.find((c) => c.id === (datos.muestra!.calendarioId ?? op.calendario));
    let grupos = 0;
    let eventos = 0;
    try {
      if (op.eventos && !calendario && op.calendario === 'nuevo') {
        const b = await saveBoard({ boardName: 'Calendario de sesiones', projectCode, boardType: 'calendar' });
        calendario = { id: b.id, nombre: b.boardName };
      }
      const actividades = [...guardada.actividades];
      for (const [i, a] of actividades.entries()) {
        let grupoId = a.grupoId;
        let eventoId = a.eventoId;
        let ligar = false;
        if (op.grupos && !grupoId && tableroId) {
          setTrabajando(`Creando el grupo ${a.codigo}…`);
          const g = await saveBoardColumn({
            columnName: nombreDeGrupo(a, guardada), boardId: `${tableroId}::groups`, columnType: colorDeGrupo(a, i), columnOrder: 100 + i,
            // El nombre de las vistas externas: sin el perfil (puede llevar marcas).
            optionsJson: JSON.stringify({ publicName: nombreExterno(a, guardada) }),
          });
          grupoId = g.id;
          grupos++;
          ligar = !!eventoId; // ya tenía evento (se creó antes, sin grupo): se ligan
        }
        if (op.eventos && !eventoId && a.fecha && calendario) {
          setTrabajando(`Creando el evento de ${a.codigo}…`);
          const ev = await saveCalendarEvent({
            eventName: nombreDeEvento(a, guardada), projectCode, calendarName: calendario.nombre, boardId: calendario.id,
            eventDate: new Date(a.fecha).toISOString(),
            ...(a.duracionMin ? { durationHours: a.duracionMin / 60 } : {}),
            ...(a.lugar ? { location: a.lugar } : {}),
            dinamica: TECNICAS[a.tecnica].nombre, ...(a.perfil ? { perfil: a.perfil } : {}),
          });
          eventoId = ev.id;
          eventos++;
          ligar = !!grupoId;
        }
        if (ligar && grupoId && eventoId && tableroId && calendario) {
          await linkGroupToEvent({ groupColumnId: grupoId, recruitmentBoardId: tableroId, calendarBoardId: calendario.id, eventId: eventoId });
        }
        actividades[i] = { ...a, grupoId, eventoId };
      }
      await saveMuestra({
        proyectoId, definicion: { ...guardada, actividades }, cambios: [], versionBase: datos.muestra.version,
        ...(tableroId ? { tableroId } : {}), ...(calendario ? { calendarioId: calendario.id } : {}), soloLigas: true,
      });
      if (tableroId && grupos) publishRecruitmentGroupsChanged({ projectCode, boardId: tableroId, changeType: 'structure' }).catch(() => {});
      toast.success(`Listo: ${[grupos && `${grupos} ${grupos === 1 ? 'grupo' : 'grupos'}`, eventos && `${eventos} ${eventos === 1 ? 'evento' : 'eventos'}`].filter(Boolean).join(' y ') || 'nada nuevo que crear'}.`);
      await cargar();
      onCambio?.();
    } catch (e) {
      toast.error((e as Error).message || 'No se pudieron crear todos; lo creado se queda. Vuelve a intentarlo.');
      await cargar().catch(() => {});
    } finally {
      setTrabajando(null);
    }
  };

  if (!datos) return <div className="flex h-full items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  const tecnicas = porTecnica(borrador.actividades);
  const perfiles = porPerfil(borrador);
  const cuotaTotal = (borrador.perfiles ?? []).reduce((n, p) => n + p.cuota, 0);
  const total = lugares(borrador.actividades);
  const cubiertos = guardada.actividades.reduce((n, a) => n + Math.min(a.personas, a.grupoId ? datos.avance[a.grupoId]?.total ?? 0 : 0), 0);
  const ultima = datos.versiones[0];

  return (
    <div className="h-full min-h-0 overflow-y-auto p-3 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        {/* Encabezado */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="text-lg font-semibold" style={{ color: TEAL }}>Muestra</h2>
          {datos.muestra && <span className="rounded-full border px-2 py-0.5 text-[11px] font-semibold" style={{ color: TEAL, borderColor: `${TEAL}55` }}>Versión {datos.muestra.version}</span>}
          {ultima && <span className="text-xs text-muted-foreground">cambió el {fechaVersion(ultima.fecha)}{ultima.por ? ` · ${ultima.por}` : ''}</span>}
          <span className="flex-1" />
          {borrador.actividades.length > 0 && (
            <Button size="sm" variant={verInsumos ? 'secondary' : 'ghost'} className="h-8 gap-1.5" onClick={() => setVerInsumos((v) => !v)}><Paperclip className="h-3.5 w-3.5" />Insumos · {cuantosInsumos(datos.insumos)}</Button>
          )}
          {datos.versiones.length > 0 && (
            <Button size="sm" variant="ghost" className="h-8 gap-1.5" onClick={() => setVerCambios((v) => !v)}><History className="h-3.5 w-3.5" />Cambios · {datos.versiones.length}</Button>
          )}
          {sucia && (
            <>
              <Button size="sm" variant="ghost" className="h-8" disabled={!!trabajando} onClick={() => { setBorrador(guardada); setCambioIA(null); }}>Descartar</Button>
              <Button size="sm" className="h-8" disabled={!!trabajando} onClick={() => setGuardar({ motivo: '' })}>Guardar cambios{cambios.length ? ` · ${cambios.length}` : ''}</Button>
            </>
          )}
        </div>

        {trabajando && (
          <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: `${TEAL}33`, backgroundColor: `${TEAL}0a`, color: TEAL }}>
            <Loader2 className="h-4 w-4 animate-spin" />{trabajando}
          </div>
        )}

        {verInsumos && borrador.actividades.length > 0 && (
          <div className="rounded-xl border bg-card p-4">
            <p className="mb-3 text-sm font-semibold" style={{ color: TEAL }}>Lo que lee la IA</p>
            <InsumosMuestra proyectoId={proyectoId} vista={datos.insumos} reuniones={datos.reuniones} ocupado={!!trabajando} onCambio={(v) => setDatos((d) => (d ? { ...d, insumos: v, hayInsumos: cuantosInsumos(v) > 0 } : d))} />
          </div>
        )}

        {verCambios && (
          <div className="space-y-3 rounded-xl border bg-card p-4">
            {datos.versiones.map((v) => (
              <div key={v.version} className="text-sm">
                <p className="text-xs text-muted-foreground">Versión {v.version} · {fechaVersion(v.fecha)}{v.por ? ` · ${v.por}` : ''}</p>
                <ul className="mt-0.5 list-disc pl-5">{v.cambios.slice(0, 12).map((c) => <li key={c}>{c}</li>)}{v.cambios.length > 12 && <li>y {v.cambios.length - 12} más</li>}</ul>
                {v.motivo && <p className="mt-0.5 italic text-muted-foreground">«{v.motivo}»</p>}
              </div>
            ))}
          </div>
        )}

        {/* Vacía: los insumos a la vista, para sumarles y que la IA la proponga */}
        {!borrador.actividades.length && !borrador.perfiles?.length && !trabajando && (
          <div className="rounded-xl border bg-card p-5">
            <p className="font-medium">Todavía no hay muestra</p>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">Cada sesión, tríada o entrevista con su fecha, lugar, perfil y cupo. De aquí salen los grupos del tablero y los eventos del calendario.</p>
            <div className="mt-4 rounded-lg border bg-[#F9FAFB] p-4">
              <p className="mb-3 text-sm font-semibold" style={{ color: TEAL }}>Lo que leerá la IA</p>
              <InsumosMuestra proyectoId={proyectoId} vista={datos.insumos} reuniones={datos.reuniones} ocupado={!!trabajando} onCambio={(v) => setDatos((d) => (d ? { ...d, insumos: v, hayInsumos: cuantosInsumos(v) > 0 } : d))} />
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button type="button" className={botonTeal} disabled={!datos.hayInsumos} onClick={proponer}><MarcaIA />Proponer con IA</button>
              <MenuTecnicas onElegir={agregar} etiqueta="Empezar a mano" />
            </div>
          </div>
        )}

        {/* Supuestos de la IA */}
        {!!borrador.supuestos?.length && (
          <div className="rounded-lg border px-4 py-3 text-sm" style={{ borderColor: `${ALERTA}55`, backgroundColor: `${ALERTA}0d` }}>
            <p className="font-medium" style={{ color: '#8a4b00' }}>Revisa lo que supuso la IA</p>
            <ul className="mt-1 list-disc pl-5 text-[#5c3a07]">{borrador.supuestos.map((s) => <li key={s}>{s}</li>)}</ul>
            <button type="button" className="mt-2 text-xs font-medium underline" style={{ color: '#8a4b00' }} onClick={() => setBorrador((b) => ({ ...b, supuestos: undefined }))}>Ya lo revisé</button>
          </div>
        )}

        {/* Pedirle un cambio a la IA */}
        {borrador.actividades.length > 0 && (
          <div className="rounded-xl border bg-card p-3">
            <div className="flex items-start gap-2">
              <span className="mt-2"><MarcaIA className="h-4 w-4" /></span>
              <Textarea
                rows={1}
                className="min-h-[38px] flex-1 resize-y text-sm"
                placeholder="Pídele un cambio a la IA (p. ej. «agrega 2 tríadas de mamás»)"
                value={pedido}
                disabled={!!trabajando}
                onChange={(e) => setPedido(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void pedirCambio(); } }}
              />
              <button type="button" className={botonTeal} disabled={!pedido.trim() || !!trabajando} onClick={pedirCambio}>Pedir cambio</button>
            </div>
            {cambioIA && (
              <div className="mt-3 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: `${TEAL}33`, backgroundColor: `${TEAL}08` }}>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    {cambioIA.nota && <p style={{ color: TEAL }}>{cambioIA.nota}</p>}
                    {cambioIA.cambios.length
                      ? <ul className="mt-0.5 list-disc pl-5 text-[13px]">{cambioIA.cambios.slice(0, 12).map((c) => <li key={c}>{c}</li>)}{cambioIA.cambios.length > 12 && <li>y {cambioIA.cambios.length - 12} más</li>}</ul>
                      : <p className="text-[13px] text-muted-foreground">No cambió nada.</p>}
                  </div>
                  {cambioIA.cambios.length > 0 && (
                    <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => { setBorrador(cambioIA.antes); setCambioIA(null); }}><Undo2 className="h-3.5 w-3.5" />Deshacer</Button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Perfiles y cuotas: qué gente se necesita y cuánta (el filtro los toma de aquí) */}
        {(borrador.actividades.length > 0 || !!borrador.perfiles?.length) && (
          <div className="rounded-xl border bg-card p-4">
            <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-sm font-semibold" style={{ color: TEAL }}>Perfiles y cuotas</span>
              <span className="text-xs text-muted-foreground">{cuotaTotal} personas · {total} lugares en actividades · {cubiertos} ya en su grupo</span>
              <span className="flex-1" />
              <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={agregarPerfil}><Plus className="h-3.5 w-3.5" />Agregar perfil</Button>
            </div>
            <div className="hidden grid-cols-[minmax(180px,1.3fr)_minmax(140px,1.2fr)_104px_76px_64px_minmax(120px,1fr)_70px_130px_28px] gap-2 pb-1 text-[11px] text-muted-foreground lg:grid">
              <span>Perfil</span><span>Quién es</span><span>Género</span><span>Edad</span><span>NSE</span><span>Reparto</span><span>Cuota</span><span>En actividades</span><span />
            </div>
            {perfiles.map((f) => (f.perfil
              ? <FilaPerfil key={f.perfil.id} p={f.perfil} letra={letraDePerfil(borrador, f.perfil.id)} fila={f} guardado={guardada.perfiles?.find((x) => x.id === f.perfil!.id)} onCambiar={(c) => cambiarPerfil(f.perfil!.id, c)} onQuitar={() => quitarPerfil(f.perfil!.id)} />
              : <p key="sin" className="border-t py-2 text-xs" style={{ color: '#8a4b00' }}>{f.total.actividades} {f.total.actividades === 1 ? 'actividad' : 'actividades'} sin perfil ({f.total.personas} lugares): elige su perfil abajo.</p>))}
            {!borrador.perfiles?.length && <p className="py-2 text-xs text-muted-foreground">Sin perfiles todavía. Cada perfil es un grupo de personas con los mismos criterios y su cuota; lo que se reparte dentro (marcas, ciudades) va en «Reparto».</p>}
          </div>
        )}

        {/* Por técnica */}
        {tecnicas.map(({ tecnica, totales, actividades }) => (
          <div key={tecnica} className="rounded-xl border bg-card">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-3">
              <span className="text-sm font-semibold" style={{ color: TEAL }}>{TECNICAS[tecnica].plural}</span>
              <span className="text-xs text-muted-foreground">{totales.actividades} · {totales.personas} lugares{totales.reserva ? ` + ${totales.reserva} de reserva` : ''}</span>
              <span className="flex-1" />
              <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => agregar(tecnica)}><Plus className="h-3.5 w-3.5" />Agregar</Button>
            </div>
            <div className="mt-1 hidden grid-cols-[52px_minmax(150px,1.2fr)_minmax(90px,0.7fr)_minmax(120px,1fr)_minmax(150px,1.2fr)_118px_74px_116px_44px_28px] gap-2 px-4 pb-1 text-[11px] text-muted-foreground lg:grid">
              <span>Código</span><span>Fecha y hora</span><span>Lugar</span><span>Perfil</span><span>Modalidad y para quién</span><span>Personas + reserva</span><span>Minutos</span><span>Avance</span><span /><span />
            </div>
            {actividades.map((a) => (
              <FilaActividad
                key={a.id}
                a={a}
                def={borrador}
                perfiles={borrador.perfiles ?? []}
                avance={a.grupoId ? datos.avance[a.grupoId] : undefined}
                guardada={guardada.actividades.find((x) => x.id === a.id)}
                onCambiar={(c) => cambiar(a.id, c)}
                onQuitar={() => (a.grupoId || a.eventoId ? setQuitar(a) : quitarActividad(a.id))}
              />
            ))}
            <div className="h-2" />
          </div>
        ))}

        {borrador.actividades.length > 0 && <MenuTecnicas onElegir={agregar} etiqueta="Agregar otra técnica" />}

        {/* Crear grupos y eventos: siempre pregunta qué y dónde */}
        {datos.muestra && !sucia && (pendientes.grupos.length > 0 || pendientes.eventos.length > 0) && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border p-4" style={{ borderColor: `${TEAL}40`, backgroundColor: `${TEAL}08` }}>
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-medium" style={{ color: TEAL }}>
                {pendientes.grupos.length > 0 && `${pendientes.grupos.length} ${pendientes.grupos.length === 1 ? 'actividad sin grupo' : 'actividades sin grupo'}`}
                {pendientes.grupos.length > 0 && pendientes.eventos.length > 0 && ' · '}
                {pendientes.eventos.length > 0 && `${pendientes.eventos.length} sin evento`}
              </p>
              <p className="text-xs text-muted-foreground">Eliges qué crear y en qué tablero y calendario. No se manda ninguna invitación.</p>
            </div>
            <Button size="sm" className="gap-1.5" disabled={!!trabajando} onClick={abrirCrear}><CalendarPlus className="h-3.5 w-3.5" />Crear grupos y eventos…</Button>
          </div>
        )}
      </div>

      <Dialog open={!!crearCon} onOpenChange={(o) => !o && setCrearCon(null)}>
        <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
          <DialogHeader><DialogTitle>Crear grupos y eventos</DialogTitle></DialogHeader>
          {crearCon && datos.muestra && (
            <div className="space-y-4 text-sm">
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 font-medium">
                  <input type="checkbox" className="h-4 w-4 accent-[#0F3D4D]" disabled={!pendientes.grupos.length} checked={crearCon.grupos} onChange={(e) => setCrearCon({ ...crearCon, grupos: e.target.checked })} />
                  {pendientes.grupos.length} {pendientes.grupos.length === 1 ? 'grupo' : 'grupos'} en el tablero
                </label>
                {crearCon.grupos && (datos.muestra.tableroId
                  ? <p className="pl-6 text-xs text-muted-foreground">En «{datos.tableros.find((t) => t.id === datos.muestra!.tableroId)?.nombre ?? 'su tablero'}», donde ya están los grupos de esta muestra.</p>
                  : datos.tableros.length
                    ? (
                      <select className="ml-6 h-8 w-[calc(100%-1.5rem)] rounded-md border bg-background px-2 text-sm" value={crearCon.tablero} onChange={(e) => setCrearCon({ ...crearCon, tablero: e.target.value })}>
                        <option value="">Elige el tablero…</option>
                        {datos.tableros.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                      </select>
                    )
                    : <p className="pl-6 text-xs" style={{ color: ALERTA }}>Este proyecto no tiene tablero: créalo primero en Participantes.</p>)}
              </div>
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 font-medium">
                  <input type="checkbox" className="h-4 w-4 accent-[#0F3D4D]" disabled={!pendientes.eventos.length} checked={crearCon.eventos} onChange={(e) => setCrearCon({ ...crearCon, eventos: e.target.checked })} />
                  {pendientes.eventos.length} {pendientes.eventos.length === 1 ? 'evento' : 'eventos'} en el calendario
                </label>
                {crearCon.eventos && (datos.muestra.calendarioId && datos.calendarios.some((c) => c.id === datos.muestra!.calendarioId)
                  ? <p className="pl-6 text-xs text-muted-foreground">En «{datos.calendarios.find((c) => c.id === datos.muestra!.calendarioId)?.nombre}», donde ya están los eventos de esta muestra.</p>
                  : (
                    <select className="ml-6 h-8 w-[calc(100%-1.5rem)] rounded-md border bg-background px-2 text-sm" value={crearCon.calendario} onChange={(e) => setCrearCon({ ...crearCon, calendario: e.target.value })}>
                      <option value="">Elige el calendario…</option>
                      {datos.calendarios.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                      <option value="nuevo">Uno nuevo: «Calendario de sesiones»</option>
                    </select>
                  ))}
                {!pendientes.eventos.length && <p className="pl-6 text-xs text-muted-foreground">Ninguna actividad con fecha espera su evento.</p>}
              </div>
              <p className="text-xs text-muted-foreground">Solo las actividades con fecha llevan evento. Cada grupo se liga a su evento. No se manda ninguna invitación.</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCrearCon(null)}>Cancelar</Button>
            <Button
              disabled={!crearCon || (!crearCon.grupos && !crearCon.eventos)
                || (crearCon.grupos && !datos.muestra?.tableroId && !crearCon.tablero)
                || (crearCon.eventos && !(datos.muestra?.calendarioId && datos.calendarios.some((c) => c.id === datos.muestra!.calendarioId)) && !crearCon.calendario)}
              onClick={() => crearCon && crear(crearCon)}
            >
              Crear
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!guardar} onOpenChange={(o) => !o && setGuardar(null)}>
        <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
          <DialogHeader><DialogTitle>Guardar la muestra</DialogTitle></DialogHeader>
          <ul className="max-h-48 list-disc space-y-0.5 overflow-y-auto pl-5 text-sm">
            {(cambios.length ? cambios : [`Primera versión: ${borrador.actividades.length} actividades`]).slice(0, 15).map((c) => <li key={c}>{c}</li>)}
            {cambios.length > 15 && <li>y {cambios.length - 15} más</li>}
          </ul>
          <Textarea className="min-h-[70px] text-sm" placeholder="¿Por qué cambió? (opcional)" value={guardar?.motivo ?? ''} onChange={(e) => setGuardar({ motivo: e.target.value })} />
          <p className="text-xs text-muted-foreground">Los grupos y eventos que ya existen se ponen al día. Nadie cambia de grupo.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGuardar(null)}>Cancelar</Button>
            <Button onClick={confirmarGuardar}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!quitar} onOpenChange={(o) => !o && setQuitar(null)}>
        <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
          <DialogHeader><DialogTitle>¿Quitar {quitar?.codigo} de la muestra?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Su grupo en el tablero{quitar?.eventoId ? ' y su evento en el calendario' : ''} se quedan como están, con su gente
            {quitar?.grupoId && datos.avance[quitar.grupoId]?.total ? ` (${datos.avance[quitar.grupoId].total})` : ''}. Si ya no van, bórralos desde el tablero o el calendario.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQuitar(null)}>Cancelar</Button>
            <Button onClick={() => { if (quitar) quitarActividad(quitar.id); setQuitar(null); }}>Quitar de la muestra</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MenuTecnicas({ onElegir, etiqueta }: { onElegir: (t: Tecnica) => void; etiqueta: string }) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5"><Plus className="h-3.5 w-3.5" />{etiqueta}<ChevronDown className="h-3 w-3" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {ORDEN_TECNICAS.map((t) => <DropdownMenuItem key={t} onSelect={() => onElegir(t)}>{TECNICAS[t].nombre}</DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FilaPerfil({ p, letra, fila, guardado, onCambiar, onQuitar }: {
  p: PerfilMuestra; letra?: string; fila: ReturnType<typeof porPerfil>[number]; guardado?: PerfilMuestra;
  onCambiar: (c: Partial<PerfilMuestra>) => void; onQuitar: () => void;
}) {
  const cambiado = !guardado || JSON.stringify(guardado) !== JSON.stringify(p);
  const lugares = fila.total.personas;
  const diferencia = lugares - p.cuota;
  const detalle = Object.entries(fila.tecnicas).map(([t, x]) => `${x!.actividades} ${x!.actividades === 1 ? TECNICAS[t as Tecnica].nombre.toLowerCase() : TECNICAS[t as Tecnica].plural.toLowerCase()}`).join(', ');
  return (
    <div className={`grid grid-cols-2 items-center gap-2 border-t py-2 lg:grid-cols-[minmax(180px,1.3fr)_minmax(140px,1.2fr)_104px_76px_64px_minmax(120px,1fr)_70px_130px_28px] lg:py-1.5 ${cambiado ? 'bg-amber-50/40' : ''}`}>
      <div className="flex min-w-0 items-center gap-1.5">
        {letra && <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-semibold text-white" style={{ backgroundColor: TEAL }} title={`En las vistas externas: «Perfil ${letra}»`}>{letra}</span>}
        <Input className="h-8 min-w-0 text-sm font-medium" value={p.nombre} onChange={(e) => onCambiar({ nombre: e.target.value })} onBlur={() => { if (!p.nombre.trim()) onCambiar({ nombre: guardado?.nombre ?? 'Perfil sin nombre' }); }} aria-label="Nombre del perfil" />
      </div>
      <Input className="h-8 text-sm" placeholder="Quién es" value={p.descripcion ?? ''} onChange={(e) => onCambiar({ descripcion: e.target.value || undefined })} aria-label="Quién es" />
      <select className="h-8 min-w-0 rounded-md border bg-background px-2 text-sm" value={p.genero ?? ''} onChange={(e) => onCambiar({ genero: esGenero(e.target.value) ? e.target.value : undefined })} aria-label="Género">
        <option value="">—</option>
        {Object.entries(GENEROS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <Input className="h-8 px-2 text-sm" placeholder="25–35" value={p.edad ?? ''} onChange={(e) => onCambiar({ edad: e.target.value || undefined })} aria-label="Edad" />
      <Input className="h-8 px-2 text-sm" placeholder="C+" value={p.nse ?? ''} onChange={(e) => onCambiar({ nse: e.target.value || undefined })} aria-label="NSE" />
      <Input className="h-8 text-sm" placeholder="Reparto (p. ej. 2 Glade · 3 otras)" value={p.reparto ?? ''} onChange={(e) => onCambiar({ reparto: e.target.value || undefined })} aria-label="Reparto" />
      <Input type="number" min={0} className="h-8 w-[66px] px-2 text-sm font-semibold" value={p.cuota} onChange={(e) => { const n = parseInt(e.target.value, 10); onCambiar({ cuota: Number.isFinite(n) && n >= 0 ? n : 0 }); }} aria-label="Cuota" />
      <span className="text-xs" title={detalle || 'Sin actividades'}>
        <span className="font-medium" style={{ color: diferencia === 0 && lugares ? EXITO : diferencia ? '#8a4b00' : undefined }}>{lugares} {lugares === 1 ? 'lugar' : 'lugares'}</span>
        {diferencia < 0 && <span style={{ color: '#8a4b00' }}> · faltan {-diferencia}</span>}
        {diferencia > 0 && <span style={{ color: '#8a4b00' }}> · sobran {diferencia}</span>}
      </span>
      <button type="button" className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-[#D32222]" onClick={onQuitar} aria-label={`Quitar el perfil ${p.nombre}`}>
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function FilaActividad({ a, def, perfiles, avance, guardada, onCambiar, onQuitar }: {
  a: Actividad; def: DefinicionMuestra; perfiles: PerfilMuestra[]; avance?: Avance; guardada?: Actividad;
  onCambiar: (c: Partial<Actividad>) => void; onQuitar: () => void;
}) {
  const numero = (v: string) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : 0; };
  const cambiada = guardada && JSON.stringify(guardada) !== JSON.stringify(a);
  const lleno = avance ? Math.min(100, Math.round((avance.total / Math.max(1, a.personas)) * 100)) : 0;
  return (
    <div className={`grid grid-cols-2 items-center gap-2 border-t px-4 py-2 lg:grid-cols-[52px_minmax(150px,1.2fr)_minmax(90px,0.7fr)_minmax(120px,1fr)_minmax(150px,1.2fr)_118px_74px_116px_44px_28px] lg:border-t-0 lg:py-1 ${cambiada || !guardada ? 'bg-amber-50/40' : ''}`}>
      <Input className="h-8 px-2 text-sm font-semibold" value={a.codigo} onChange={(e) => onCambiar({ codigo: e.target.value.toUpperCase().slice(0, 8) })} aria-label="Código" />
      <div className="col-span-1 [&_button]:h-8"><DatetimePicker value={a.fecha ?? ''} onChange={(iso) => onCambiar({ fecha: iso || undefined })} /></div>
      <Input className="h-8 text-sm" placeholder="Lugar" value={a.lugar ?? ''} onChange={(e) => onCambiar({ lugar: e.target.value || undefined })} aria-label="Lugar" />
      <select
        className="h-8 min-w-0 rounded-md border bg-background px-2 text-sm"
        value={a.perfilId ?? ''}
        onChange={(e) => { const p = perfiles.find((x) => x.id === e.target.value); onCambiar(p ? { perfilId: p.id, perfil: p.nombre } : { perfilId: undefined, perfil: undefined }); }}
        aria-label="Perfil"
      >
        <option value="">Sin perfil</option>
        {perfiles.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
      </select>
      <ParaQuien a={a} def={def} onCambiar={onCambiar} />
      <div className="flex items-center gap-1">
        <Input type="number" min={0} className="h-8 w-14 px-2 text-sm" value={a.personas} onChange={(e) => onCambiar({ personas: numero(e.target.value) })} aria-label="Personas" />
        <span className="text-xs text-muted-foreground">+</span>
        <Input type="number" min={0} className="h-8 w-12 px-2 text-sm" value={a.reserva} onChange={(e) => onCambiar({ reserva: numero(e.target.value) })} aria-label="Reserva" />
      </div>
      <Input type="number" min={0} step={15} className="h-8 w-[70px] px-2 text-sm" value={a.duracionMin ?? ''} onChange={(e) => onCambiar({ duracionMin: numero(e.target.value) || undefined })} aria-label="Minutos" />
      <div className="flex items-center gap-2 text-xs" title={avance ? Object.entries(avance.porEstatus).map(([k, v]) => `${k}: ${v}`).join(' · ') : 'Sin grupo todavía'}>
        {a.grupoId ? (
          <>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full" style={{ width: `${lleno}%`, backgroundColor: lleno >= 100 ? EXITO : TEAL }} /></span>
            <span className="whitespace-nowrap font-medium">{avance?.total ?? 0}/{a.personas}</span>
          </>
        ) : <span className="text-muted-foreground">—</span>}
      </div>
      <div className="flex items-center gap-1.5">
        <Users className="h-3.5 w-3.5" style={{ color: a.grupoId ? EXITO : GRIS }} aria-label={a.grupoId ? 'Tiene grupo en el tablero' : 'Sin grupo'} />
        {a.eventoId
          ? <CalendarCheck className="h-3.5 w-3.5" style={{ color: EXITO }} aria-label="Tiene evento en el calendario" />
          : <CalendarPlus className="h-3.5 w-3.5" style={{ color: a.fecha ? GRIS : ALERTA }} aria-label={a.fecha ? 'Sin evento' : 'Sin fecha'} />}
      </div>
      <button type="button" className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-[#D32222]" onClick={onQuitar} aria-label={`Quitar ${a.codigo}`}>
        <Trash2 className="h-3.5 w-3.5" />
      </button>
      {a.fecha && <span className="col-span-2 text-[11px] text-muted-foreground lg:hidden">{fechaCorta(a.fecha)}</span>}
    </div>
  );
}

/**
 * Modalidad, género, edad y NSE de una actividad: lo que no se escribe aquí
 * sale de su perfil. Abajo, cómo se llaman su grupo y su evento.
 */
function ParaQuien({ a, def, onCambiar }: { a: Actividad; def: DefinicionMuestra; onCambiar: (c: Partial<Actividad>) => void }) {
  const d = detallesDe(a, def);
  const p = def.perfiles?.find((x) => x.id === a.perfilId);
  const resumen = [MODALIDADES[d.modalidad], d.genero && GENEROS[d.genero], d.edad && edadCorta(d.edad), d.nse && `NSE ${d.nse}`].filter(Boolean).join(' · ');
  const propio = !!(a.genero || a.edad || a.nse);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="h-8 min-w-0 truncate rounded-md border bg-background px-2 text-left text-xs hover:bg-muted" title={resumen}>
          <span className={propio ? 'font-medium' : ''}>{resumen}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-3 p-3">
        <div className="flex gap-1">
          {(Object.keys(MODALIDADES) as Modalidad[]).map((m) => (
            <button
              key={m}
              type="button"
              className="h-7 flex-1 rounded-md border text-xs font-medium"
              style={d.modalidad === m ? { backgroundColor: TEAL, borderColor: TEAL, color: 'white' } : undefined}
              onClick={() => onCambiar({ modalidad: m })}
            >
              {MODALIDADES[m]}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-[1fr_72px_64px] gap-2">
          <label className="space-y-1 text-[11px] text-muted-foreground">Género
            <select className="h-8 w-full rounded-md border bg-background px-2 text-sm text-foreground" value={a.genero ?? ''} onChange={(e) => onCambiar({ genero: esGenero(e.target.value) ? e.target.value : undefined })}>
              <option value="">{p?.genero ? `${GENEROS[p.genero]} (perfil)` : '—'}</option>
              {Object.entries(GENEROS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-[11px] text-muted-foreground">Edad
            <Input className="h-8 px-2 text-sm text-foreground" placeholder={p?.edad ?? '25–35'} value={a.edad ?? ''} onChange={(e) => onCambiar({ edad: e.target.value || undefined })} />
          </label>
          <label className="space-y-1 text-[11px] text-muted-foreground">NSE
            <Input className="h-8 px-2 text-sm text-foreground" placeholder={p?.nse ?? 'C+'} value={a.nse ?? ''} onChange={(e) => onCambiar({ nse: e.target.value || undefined })} />
          </label>
        </div>
        <div className="space-y-1 border-t pt-2 text-[11px]">
          <p><span className="text-muted-foreground">Grupo y evento: </span>{nombreDeGrupo(a, def)}</p>
          <p><span className="text-muted-foreground">Vistas externas: </span>{nombreExterno(a, def)}</p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
