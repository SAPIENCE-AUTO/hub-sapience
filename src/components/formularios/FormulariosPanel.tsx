import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  getFormularios, createFormulario, getFormularioDetail, getFormularioRespuesta,
  setFormularioEstado, deleteFormularioRespuestas, deleteFormulario, exportFormularioRespuestas,
  getTablerosReclutamiento, vincularFormularioTablero, pasarFormularioAlReclutamiento, crearTableroParaFormulario,
} from 'zite-endpoints-sdk';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ArrowRightLeft, Copy, Download, ExternalLink, Loader2, Plus, RefreshCw, Trash2, TriangleAlert, Users } from 'lucide-react';
import { TEAL, EXITO, PELIGRO, ALERTA, GRIS, INFO, EstadoPill } from '@/lib/toolColors';
import { describir } from '@/lib/formularios/motor';
import { PLANTILLAS } from '@/lib/formularios/plantillas';
import { descargarExcel } from '@/lib/formularios/excel';
import type { Definicion, Respuestas, Resultado } from '@/lib/formularios/tipos';

interface FormularioRow { id: string; codigo: string; titulo: string; estado: string; respuestasPrueba: number; respuestasReales: number; califican: number }
interface RespuestaRow {
  id: string; createdAt: string; esPrueba: boolean; nombre?: string; telefono?: string; edad?: string; genero?: string; nse?: string;
  califica: boolean; frentes: string[]; motivo?: string; alertas: string[]; incompleto: boolean; duplicado: boolean; duracionSeg?: number;
  enReclutamiento: boolean;
}
interface Detalle { id: string; codigo: string; titulo: string; estado: string; definicion: Definicion; tablero?: { id: string; nombre: string }; respuestas: RespuestaRow[] }

const enlace = (codigo: string) => `${window.location.origin}/f/${codigo}`;
const fecha = (iso: string) => new Date(iso).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * Tools → Formularios: screeners que contestan los consumidores en /f/:codigo.
 * Por ahora solo para Sergio y solo en modo prueba (ver acceso.ts). Las
 * respuestas se califican y se revisan aquí; pasan al tablero de
 * Reclutamiento vinculado solo cuando se pide (serverUtils/formularios/reclutamiento.ts).
 */
export function FormulariosPanel({ proyectoId }: { proyectoId?: string }) {
  const [lista, setLista] = useState<FormularioRow[]>([]);
  const [cargando, setCargando] = useState(true);
  const [seleccionado, setSeleccionado] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<Detalle | null>(null);
  const [nuevoAbierto, setNuevoAbierto] = useState(false);
  const [nuevoTitulo, setNuevoTitulo] = useState('');
  const [nuevaPlantilla, setNuevaPlantilla] = useState(Object.keys(PLANTILLAS)[0]);
  const [creando, setCreando] = useState(false);
  const [verRespuesta, setVerRespuesta] = useState<RespuestaRow | null>(null);
  const [confirmar, setConfirmar] = useState<'pruebas' | 'formulario' | null>(null);

  const cargarLista = async () => {
    setCargando(true);
    try {
      const r = await getFormularios({ proyectoId });
      setLista(r.formularios ?? []);
    } catch (err) {
      toast.error((err as Error).message);
    }
    setCargando(false);
  };

  const cargarDetalle = async (id: string) => {
    const r = await getFormularioDetail({ formularioId: id });
    setDetalle(r.found ? r : null);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { cargarLista(); }, [proyectoId]);
  useEffect(() => { if (seleccionado) cargarDetalle(seleccionado); else setDetalle(null); }, [seleccionado]);

  const crear = async () => {
    if (!nuevoTitulo.trim()) return;
    setCreando(true);
    try {
      const r = await createFormulario({ titulo: nuevoTitulo.trim(), plantilla: nuevaPlantilla, proyectoId });
      setNuevoAbierto(false);
      setNuevoTitulo('');
      await cargarLista();
      setSeleccionado(r.id);
    } catch (err) {
      toast.error((err as Error).message || 'No se pudo crear el formulario.');
    }
    setCreando(false);
  };

  const cambiarEstado = async (estado: 'borrador' | 'prueba' | 'cerrado') => {
    if (!detalle) return;
    try {
      await setFormularioEstado({ formularioId: detalle.id, estado });
      await Promise.all([cargarDetalle(detalle.id), cargarLista()]);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const borrarPruebas = async () => {
    if (!detalle) return;
    const r = await deleteFormularioRespuestas({ formularioId: detalle.id });
    toast.success(`${r.borradas} respuesta${r.borradas === 1 ? '' : 's'} de prueba borrada${r.borradas === 1 ? '' : 's'}`);
    await Promise.all([cargarDetalle(detalle.id), cargarLista()]);
  };

  const borrarFormulario = async () => {
    if (!detalle) return;
    try {
      await deleteFormulario({ formularioId: detalle.id });
      setSeleccionado(null);
      await cargarLista();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="flex h-full min-h-0">
      <aside className="w-72 flex-shrink-0 overflow-y-auto border-r p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold" style={{ color: TEAL }}>Formularios</h3>
          <Button size="sm" variant="outline" onClick={() => setNuevoAbierto(true)}><Plus className="mr-1 h-3.5 w-3.5" />Nuevo</Button>
        </div>
        {cargando && <p className="text-xs text-muted-foreground">Cargando…</p>}
        {!cargando && lista.length === 0 && <p className="text-xs text-muted-foreground">Todavía no hay formularios en este proyecto.</p>}
        <div className="space-y-2">
          {lista.map((f) => (
            <button
              key={f.id}
              onClick={() => setSeleccionado(f.id)}
              className={`w-full rounded-lg border p-3 text-left transition-colors ${seleccionado === f.id ? 'border-[#0F3D4D] bg-[#0F3D4D]/[0.04]' : 'hover:bg-muted'}`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-medium leading-snug">{f.titulo}</span>
                <EstadoPill estado={f.estado} />
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {f.respuestasPrueba + f.respuestasReales} respuestas · {f.califican} califican
              </p>
            </button>
          ))}
        </div>
      </aside>

      <section className="min-w-0 flex-1 overflow-y-auto p-6">
        {!detalle && <p className="text-sm text-muted-foreground">Elige un formulario o crea uno nuevo.</p>}
        {detalle && (
          <DetalleFormulario
            detalle={detalle}
            proyectoId={proyectoId}
            onEstado={cambiarEstado}
            onRecargar={() => Promise.all([cargarDetalle(detalle.id), cargarLista()])}
            onVer={setVerRespuesta}
            onBorrarPruebas={() => setConfirmar('pruebas')}
            onBorrarFormulario={() => setConfirmar('formulario')}
          />
        )}
      </section>

      <Dialog open={nuevoAbierto} onOpenChange={setNuevoAbierto}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nuevo formulario</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Nombre interno</label>
              <Input value={nuevoTitulo} onChange={(e) => setNuevoTitulo(e.target.value)} placeholder="Screener ALONG 2 · ensayo" />
              <p className="mt-1 text-[11px] text-muted-foreground">El participante no lo ve: ve el título de la plantilla.</p>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Plantilla</label>
              <select className="mt-1 w-full rounded-md border px-3 py-2 text-sm" value={nuevaPlantilla} onChange={(e) => setNuevaPlantilla(e.target.value)}>
                {Object.entries(PLANTILLAS).map(([id, p]) => <option key={id} value={id}>{p.nombre}</option>)}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNuevoAbierto(false)}>Cancelar</Button>
            <Button onClick={crear} disabled={creando || !nuevoTitulo.trim()}>{creando && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Crear</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {detalle && verRespuesta && (
        <RespuestaDialog
          formularioId={detalle.id}
          definicion={detalle.definicion}
          tablero={detalle.tablero}
          fila={verRespuesta}
          onClose={() => setVerRespuesta(null)}
          onPasada={() => { setVerRespuesta(null); cargarDetalle(detalle.id); }}
        />
      )}

      <AlertDialog open={!!confirmar} onOpenChange={(o) => !o && setConfirmar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmar === 'pruebas' ? '¿Borrar las respuestas de prueba?' : '¿Borrar el formulario?'}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmar === 'pruebas'
                ? 'Se borran todas las respuestas marcadas como prueba y sus fotos. No se puede deshacer.'
                : 'Se borra el formulario, sus respuestas de prueba y sus fotos. El enlace deja de funcionar. No se puede deshacer.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => (confirmar === 'pruebas' ? borrarPruebas() : borrarFormulario())}>Borrar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function DetalleFormulario({ detalle, proyectoId, onEstado, onRecargar, onVer, onBorrarPruebas, onBorrarFormulario }: {
  detalle: Detalle;
  proyectoId?: string;
  onEstado: (e: 'borrador' | 'prueba' | 'cerrado') => void;
  onRecargar: () => void;
  onVer: (r: RespuestaRow) => void;
  onBorrarPruebas: () => void;
  onBorrarFormulario: () => void;
}) {
  const def = detalle.definicion;
  const frentes = def.frentes ?? [];
  const nombreFrente = (id: string) => frentes.find((f) => f.id === id)?.nombre ?? id;
  const hayPruebas = detalle.respuestas.some((r) => r.esPrueba);
  const hayReales = detalle.respuestas.some((r) => !r.esPrueba);
  const [descargando, setDescargando] = useState(false);

  const descargar = async () => {
    setDescargando(true);
    try {
      const r = await exportFormularioRespuestas({ formularioId: detalle.id });
      if (r.found) await descargarExcel(r.titulo, r.definicion, r.filas);
    } catch (err) {
      toast.error((err as Error).message || 'No se pudo armar el Excel.');
    }
    setDescargando(false);
  };

  const cuotas = useMemo(() => frentes.map((f) => {
    const filas = detalle.respuestas.filter((r) => r.califica && r.frentes.includes(f.id));
    return { ...f, califican: filas.length, mujeres: filas.filter((r) => r.genero === 'Mujer').length, hombres: filas.filter((r) => r.genero === 'Hombre').length };
  }), [frentes, detalle.respuestas]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold" style={{ color: TEAL }}>{detalle.titulo}</h2>
            <EstadoPill estado={detalle.estado} />
          </div>
          <p className="text-xs text-muted-foreground">El participante ve: «{def.tituloPublico}»</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {detalle.estado === 'borrador' && <Button size="sm" onClick={() => onEstado('prueba')}>Abrir en modo prueba</Button>}
          {detalle.estado === 'prueba' && <Button size="sm" variant="outline" onClick={() => onEstado('cerrado')}>Cerrar</Button>}
          {detalle.estado === 'prueba' && <Button size="sm" variant="outline" onClick={() => onEstado('borrador')}>Volver a borrador</Button>}
          {detalle.estado === 'cerrado' && <Button size="sm" variant="outline" onClick={() => onEstado('prueba')}>Reabrir en prueba</Button>}
          {!hayReales && <Button size="sm" variant="ghost" onClick={onBorrarFormulario}><Trash2 className="h-4 w-4" /></Button>}
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <span className="text-xs font-medium text-muted-foreground">Enlace para contestar</span>
          <code className="rounded bg-muted px-2 py-1 text-xs">{enlace(detalle.codigo)}</code>
          <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(enlace(detalle.codigo)); toast.success('Enlace copiado'); }}>
            <Copy className="mr-1 h-3.5 w-3.5" />Copiar
          </Button>
          <Button size="sm" variant="outline" disabled={detalle.estado === 'borrador'} onClick={() => window.open(enlace(detalle.codigo), '_blank')}>
            <ExternalLink className="mr-1 h-3.5 w-3.5" />Abrir
          </Button>
          {detalle.estado === 'borrador' && <span className="text-xs text-muted-foreground">En borrador nadie puede contestarlo.</span>}
          {detalle.estado === 'prueba' && <span className="text-xs" style={{ color: ALERTA }}>Modo prueba: todo lo que entre queda marcado como prueba. Solo pasa al reclutamiento si tú lo pasas.</span>}
        </CardContent>
      </Card>

      <TarjetaReclutamiento detalle={detalle} proyectoId={proyectoId} onCambio={onRecargar} />

      {frentes.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold" style={{ color: TEAL }}>Cuotas</h3>
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                <tr><th className="px-3 py-2">Frente</th><th className="px-3 py-2">Califican / meta</th><th className="px-3 py-2">Mujeres · hombres</th></tr>
              </thead>
              <tbody>
                {cuotas.map((c) => (
                  <tr key={c.id} className="border-t">
                    <td className="px-3 py-2">{c.nombre}</td>
                    <td className="px-3 py-2 font-medium" style={{ color: c.califican >= c.meta ? EXITO : undefined }}>{c.califican} / {c.meta}</td>
                    <td className="px-3 py-2 text-muted-foreground">{c.mujeres} · {c.hombres}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold" style={{ color: TEAL }}>Respuestas ({detalle.respuestas.length})</h3>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={onRecargar}><RefreshCw className="mr-1 h-3.5 w-3.5" />Actualizar</Button>
            <Button size="sm" variant="outline" onClick={descargar} disabled={descargando || detalle.respuestas.length === 0}>
              {descargando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1 h-3.5 w-3.5" />}Descargar Excel
            </Button>
            {hayPruebas && <Button size="sm" variant="outline" onClick={onBorrarPruebas}><Trash2 className="mr-1 h-3.5 w-3.5" />Borrar pruebas</Button>}
          </div>
        </div>
        {detalle.respuestas.length === 0
          ? <p className="text-sm text-muted-foreground">Todavía no hay respuestas.</p>
          : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Fecha</th><th className="px-3 py-2">Nombre</th><th className="px-3 py-2">Edad</th>
                    <th className="px-3 py-2">NSE</th><th className="px-3 py-2">Resultado</th><th className="px-3 py-2">Frente o motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {detalle.respuestas.map((r) => (
                    <tr key={r.id} className="cursor-pointer border-t hover:bg-muted/40" onClick={() => onVer(r)}>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                        {fecha(r.createdAt)}
                        {r.esPrueba && <span className="ml-1.5 rounded bg-[#F4C025]/30 px-1 text-[10px] font-semibold text-[#7a5d00]">PRUEBA</span>}
                      </td>
                      <td className="px-3 py-2">
                        {r.nombre ?? '—'}
                        {r.duplicado && <span className="ml-1.5 text-[10px] font-semibold" style={{ color: ALERTA }}>tel. repetido</span>}
                      </td>
                      <td className="px-3 py-2">{r.edad ?? '—'}{r.genero ? ` · ${r.genero}` : ''}</td>
                      <td className="px-3 py-2">{r.nse ?? '—'}</td>
                      <td className="px-3 py-2">
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase text-white" style={{ backgroundColor: r.califica ? EXITO : r.incompleto ? GRIS : PELIGRO }}>
                          {r.califica ? 'Califica' : r.incompleto ? 'Incompleta' : 'No califica'}
                        </span>
                        {r.alertas.length > 0 && <TriangleAlert className="ml-1.5 inline h-3.5 w-3.5" style={{ color: ALERTA }} />}
                        {r.enReclutamiento && <span className="ml-1.5 whitespace-nowrap text-[10px] font-semibold" style={{ color: INFO }}>En reclutamiento</span>}
                      </td>
                      <td className="px-3 py-2 text-xs">{r.califica ? r.frentes.map(nombreFrente).join(', ') : r.motivo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>
    </div>
  );
}

function TarjetaReclutamiento({ detalle, proyectoId, onCambio }: { detalle: Detalle; proyectoId?: string; onCambio: () => void }) {
  const [tableros, setTableros] = useState<{ id: string; nombre: string }[] | null>(null);
  const [elegido, setElegido] = useState('');
  const [cambiando, setCambiando] = useState(false);
  const [creando, setCreando] = useState(false);
  const [nombreNuevo, setNombreNuevo] = useState(detalle.titulo);
  const [trabajando, setTrabajando] = useState(false);
  const pendientes = detalle.respuestas.filter((r) => r.califica && !r.enReclutamiento).length;
  const mostrarSelector = !detalle.tablero || cambiando;

  useEffect(() => {
    if (!proyectoId || !mostrarSelector || tableros) return;
    getTablerosReclutamiento({ proyectoId }).then((r) => {
      setTableros(r.tableros ?? []);
      setElegido(detalle.tablero?.id ?? r.tableros?.[0]?.id ?? '');
    });
  }, [proyectoId, mostrarSelector, tableros, detalle.tablero?.id]);

  const vincular = async () => {
    if (!elegido) return;
    setTrabajando(true);
    try {
      const r = await vincularFormularioTablero({ formularioId: detalle.id, boardId: elegido });
      if (r.columnasCreadas) toast.success(`Se agregaron ${r.columnasCreadas} columnas al tablero`);
      setCambiando(false);
      onCambio();
    } catch (err) {
      toast.error((err as Error).message);
    }
    setTrabajando(false);
  };

  // Mismo efecto que «+ Tablero» en la pestaña Reclutamiento, pero ya queda vinculado.
  const crear = async () => {
    if (!nombreNuevo.trim()) return;
    setTrabajando(true);
    try {
      const r = await crearTableroParaFormulario({ formularioId: detalle.id, nombre: nombreNuevo.trim() });
      toast.success(`Tablero «${r.nombre}» creado y vinculado, con ${r.columnasCreadas} columnas`);
      setCreando(false);
      setCambiando(false);
      setTableros(null);
      onCambio();
    } catch (err) {
      toast.error((err as Error).message);
    }
    setTrabajando(false);
  };

  const pasar = async () => {
    setTrabajando(true);
    try {
      const r = await pasarFormularioAlReclutamiento({ formularioId: detalle.id });
      toast.success(r.pasadas
        ? `${r.pasadas === 1 ? '1 persona pasó' : `${r.pasadas} personas pasaron`} al tablero «${r.tablero}»`
        : 'No había respuestas nuevas que califiquen');
      onCambio();
    } catch (err) {
      toast.error((err as Error).message);
    }
    setTrabajando(false);
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4" style={{ color: TEAL }} />
          <span className="text-sm font-semibold" style={{ color: TEAL }}>Reclutamiento</span>
        </div>
        {mostrarSelector && (creando || tableros?.length === 0) ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Nombre del tablero nuevo</span>
            <Input className="h-8 w-64" value={nombreNuevo} onChange={(e) => setNombreNuevo(e.target.value)} />
            <Button size="sm" onClick={crear} disabled={trabajando || !nombreNuevo.trim()}>
              {trabajando && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Crear y vincular
            </Button>
            {(creando || cambiando) && <Button size="sm" variant="ghost" onClick={() => { setCreando(false); if (tableros?.length === 0) setCambiando(false); }}>Cancelar</Button>}
          </div>
        ) : mostrarSelector ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Tablero al que pasan las respuestas</span>
            {tableros === null && <Loader2 className="h-4 w-4 animate-spin" />}
            {!!tableros?.length && (
              <>
                <select className="rounded-md border px-2 py-1.5 text-sm" value={elegido} onChange={(e) => setElegido(e.target.value)}>
                  {tableros.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                </select>
                <Button size="sm" onClick={vincular} disabled={trabajando || !elegido}>Vincular</Button>
                <Button size="sm" variant="outline" onClick={() => setCreando(true)}><Plus className="mr-1 h-3.5 w-3.5" />Crear tablero nuevo</Button>
                {cambiando && <Button size="sm" variant="ghost" onClick={() => setCambiando(false)}>Cancelar</Button>}
              </>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm">Vinculado al tablero <strong>«{detalle.tablero!.nombre}»</strong></span>
            <Button size="sm" onClick={pasar} disabled={trabajando || pendientes === 0}>
              {trabajando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <ArrowRightLeft className="mr-1 h-3.5 w-3.5" />}
              Pasar las que califican ({pendientes})
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setTableros(null); setCambiando(true); }}>Cambiar tablero</Button>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          El tablero recibe todas las preguntas como columnas desde que se vincula, y cada persona que pasa queda como una fila «Pendiente», igual que con un formulario de Fillout. Pasar dos veces al mismo tablero no duplica; si cambias de tablero, el nuevo recibe a todas.
        </p>
      </CardContent>
    </Card>
  );
}

function RespuestaDialog({ formularioId, definicion, tablero, fila, onClose, onPasada }: {
  formularioId: string;
  definicion: Definicion;
  tablero?: { id: string; nombre: string };
  fila: RespuestaRow;
  onClose: () => void;
  onPasada: () => void;
}) {
  const [datos, setDatos] = useState<{ respuestas: Respuestas; resultado: Resultado; fotos: Record<string, string> } | null>(null);
  const [pasando, setPasando] = useState(false);

  // A mano se puede pasar a cualquiera, califique o no: el equipo decide si lo revisa.
  const pasar = async () => {
    setPasando(true);
    try {
      await pasarFormularioAlReclutamiento({ formularioId, respuestaIds: [fila.id] });
      toast.success(`${fila.nombre ?? 'La respuesta'} pasó al tablero «${tablero?.nombre}»`);
      onPasada();
    } catch (err) {
      toast.error((err as Error).message);
    }
    setPasando(false);
  };

  useEffect(() => {
    getFormularioRespuesta({ respuestaId: fila.id }).then((r) => r.found && setDatos(r));
  }, [fila.id]);

  const nombreFrente = (id: string) => definicion.frentes?.find((f) => f.id === id)?.nombre ?? id;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>{fila.nombre ?? 'Respuesta'}{fila.esPrueba ? ' · prueba' : ''}</DialogTitle></DialogHeader>
        {tablero && (
          fila.enReclutamiento
            ? <p className="text-xs" style={{ color: INFO }}>Ya está en el tablero «{tablero.nombre}» de Reclutamiento.</p>
            : (
              <Button size="sm" variant="outline" className="self-start" onClick={pasar} disabled={pasando}>
                {pasando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <ArrowRightLeft className="mr-1 h-3.5 w-3.5" />}
                Pasar al tablero «{tablero.nombre}»
              </Button>
            )
        )}
        {!datos && <Loader2 className="mx-auto h-5 w-5 animate-spin" />}
        {datos && (
          <div className="space-y-5 text-sm">
            <div className="rounded-lg border p-3">
              <p>
                <span className="font-semibold" style={{ color: fila.califica ? EXITO : PELIGRO }}>{fila.califica ? 'Califica' : 'No califica'}</span>
                {datos.resultado.frentes.length > 0 && ` · ${datos.resultado.frentes.map(nombreFrente).join(', ')}`}
                {datos.resultado.nse && ` · NSE ${datos.resultado.nse.nivel} (${datos.resultado.nse.puntos} puntos)`}
                {fila.duracionSeg !== undefined && ` · ${Math.round(fila.duracionSeg / 60)} min`}
              </p>
              {fila.motivo && <p className="mt-1 text-muted-foreground">{fila.motivo}</p>}
              {datos.resultado.alertas.map((a) => <p key={a} className="mt-1" style={{ color: ALERTA }}>⚠ {a}</p>)}
            </div>
            {describir(definicion, datos.respuestas).map((s, i) => (
              <div key={`${s.titulo}-${i}`}>
                <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{s.titulo}</h4>
                <dl className="space-y-1.5">
                  {s.lineas.map((l, j) => (
                    <div key={j}>
                      <dt className="text-xs text-muted-foreground">{l.texto}</dt>
                      {l.fotos
                        ? (
                          <dd className="mt-1 flex flex-wrap gap-2">
                            {l.fotos.map((f) => datos.fotos[f.ruta]
                              ? <a key={f.ruta} href={datos.fotos[f.ruta]} target="_blank" rel="noreferrer"><img src={datos.fotos[f.ruta]} alt={f.nombre} className="h-28 w-28 rounded-md border object-cover" /></a>
                              : <span key={f.ruta} className="text-xs text-muted-foreground">{f.nombre} (no se pudo abrir)</span>)}
                          </dd>
                        )
                        : <dd>{l.valor}</dd>}
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
