import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  getFormularios, createFormulario, getFormularioDetail,
  setFormularioEstado, deleteFormularioRespuestas, deleteFormulario,
} from 'zite-endpoints-sdk';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ArrowLeft, Copy, ExternalLink, FileText, Loader2, Plus, Smartphone, Trash2, Users, Workflow } from 'lucide-react';
import { TEAL, ALERTA, EstadoPill } from '@/lib/toolColors';
import { PAISES } from '@/lib/formularios/paises';
import { PLANTILLAS } from '@/lib/formularios/plantillas';
import type { Definicion } from '@/lib/formularios/tipos';
import { estructuraDeDefinicion } from '@/lib/formularios/generador';
import { AvisoRegla, PanelRespuestas, type Detalle } from './PanelRespuestas';
import { useEditorFiltro } from './editor/useEditorFiltro';
import { EditorFiltro, irAlDocumento, type VistaEditor } from './editor/EditorFiltro';
import { useGenerador } from './generador/useGenerador';
import { GeneradorFiltro } from './generador/GeneradorFiltro';
import { MarcaIA } from './generador/comun';

interface FormularioRow { id: string; codigo: string; titulo: string; estado: string; respuestasPrueba: number; respuestasReales: number; califican: number; proyecto?: string }

type Origen = 'insumos' | 'word' | 'filtro' | 'plantilla';
const ORIGENES: { id: Origen; nombre: string; detalle: string; ia?: boolean }[] = [
  { id: 'insumos', nombre: 'Con IA, desde los insumos', detalle: 'Notas, la propuesta y el kick-off de Notetaker.', ia: true },
  { id: 'word', nombre: 'Con IA, desde un screener en Word', detalle: 'Se vuelve un filtro editable con su misma redacción.', ia: true },
  { id: 'filtro', nombre: 'Desde un filtro anterior', detalle: 'Se copia y, si cambia algo, la IA lo adapta.' },
  { id: 'plantilla', nombre: 'Desde una plantilla', detalle: 'ALONG 2 o la de todos los tipos de pregunta.' },
];

const enlace = (codigo: string) => `${window.location.origin}/f/${codigo}`;

/**
 * Tools → Formularios: screeners que contestan los consumidores en /f/:codigo.
 * Por ahora solo para Sergio y solo en modo prueba (ver acceso.ts). La lista
 * de filtros y el filtro abierto van uno tras otro (así caben el documento y
 * su mapa, y se lee bien en pantallas angostas). Un filtro abre en su
 * Documento, que se corrige ahí mismo (editor/, fase 2); sus respuestas se
 * califican y se revisan en Respuestas, y pasan al tablero de Reclutamiento
 * vinculado solo cuando se pide (serverUtils/formularios/reclutamiento.ts).
 */
export function FormulariosPanel({ proyectoId }: { proyectoId?: string }) {
  const [lista, setLista] = useState<FormularioRow[]>([]);
  const [cargando, setCargando] = useState(true);
  const [seleccionado, setSeleccionado] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<Detalle | null>(null);
  const [nuevoAbierto, setNuevoAbierto] = useState(false);
  const [nuevoTitulo, setNuevoTitulo] = useState('');
  const [nuevaPlantilla, setNuevaPlantilla] = useState(Object.keys(PLANTILLAS)[0]);
  const [origen, setOrigen] = useState<Origen>('insumos');
  const [todos, setTodos] = useState<FormularioRow[] | null>(null);
  const [filtroBase, setFiltroBase] = useState('');
  const [creando, setCreando] = useState(false);
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
    try {
      const r = await getFormularioDetail({ formularioId: id });
      setDetalle(r.found ? r : null);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { cargarLista(); }, [proyectoId]);
  useEffect(() => { if (seleccionado) cargarDetalle(seleccionado); else setDetalle(null); }, [seleccionado]);

  // Para «Desde un filtro anterior»: los filtros de todos los proyectos.
  useEffect(() => {
    if (!nuevoAbierto || origen !== 'filtro' || todos) return;
    getFormularios({}).then((r) => setTodos(r.formularios ?? [])).catch((err) => toast.error((err as Error).message));
  }, [nuevoAbierto, origen, todos]);

  const crear = async () => {
    if (!nuevoTitulo.trim() || (origen === 'filtro' && !filtroBase)) return;
    setCreando(true);
    try {
      const r = await createFormulario({
        titulo: nuevoTitulo.trim(), origen, proyectoId,
        ...(origen === 'plantilla' ? { plantilla: nuevaPlantilla } : {}),
        ...(origen === 'filtro' ? { filtroBaseId: filtroBase } : {}),
      });
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
    <div className="h-full min-h-0 overflow-y-auto p-3 sm:p-6">
      {!seleccionado && (
        <div className="mx-auto max-w-4xl">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-base font-semibold" style={{ color: TEAL }}>Formularios</h3>
            <Button size="sm" onClick={() => setNuevoAbierto(true)}><Plus className="mr-1 h-3.5 w-3.5" />Nuevo</Button>
          </div>
          {cargando && <p className="text-xs text-muted-foreground">Cargando…</p>}
          {!cargando && lista.length === 0 && <p className="text-sm text-muted-foreground">Todavía no hay formularios en este proyecto.</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            {lista.map((f) => (
              <button key={f.id} onClick={() => setSeleccionado(f.id)} className="rounded-lg border bg-white p-4 text-left transition-colors hover:border-[#0F3D4D]/50 hover:bg-[#0F3D4D]/[0.03]">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-medium leading-snug">{f.titulo}</span>
                  <EstadoPill estado={f.estado} />
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">{f.respuestasPrueba + f.respuestasReales} respuestas · {f.califican} califican</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {seleccionado && !detalle && <Loader2 className="mx-auto mt-10 h-5 w-5 animate-spin text-muted-foreground" />}
      {seleccionado && detalle && (
        <DetalleFiltro
          key={detalle.id}
          detalle={detalle}
          proyectoId={proyectoId}
          onVolver={() => { setSeleccionado(null); cargarLista(); }}
          onEstado={cambiarEstado}
          onRecargar={() => Promise.all([cargarDetalle(detalle.id), cargarLista()])}
          onGuardado={(definicion) => setDetalle((d) => (d ? { ...d, definicion } : d))}
          onBorrarPruebas={() => setConfirmar('pruebas')}
          onBorrarFormulario={() => setConfirmar('formulario')}
        />
      )}

      <Dialog open={nuevoAbierto} onOpenChange={setNuevoAbierto}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nuevo formulario</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Nombre interno</label>
              <Input value={nuevoTitulo} onChange={(e) => setNuevoTitulo(e.target.value)} placeholder="Screener · consumidores de café frío" />
              <p className="mt-1 text-[11px] text-muted-foreground">El participante no lo ve.</p>
            </div>
            <div role="radiogroup" aria-label="Cómo empiezas" className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Cómo empiezas</label>
              {ORIGENES.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  role="radio"
                  aria-checked={origen === o.id}
                  onClick={() => setOrigen(o.id)}
                  className={`flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors ${origen === o.id ? 'border-[#0F3D4D] bg-[#0F3D4D]/[0.04]' : 'hover:bg-muted/50'}`}
                >
                  <span className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border ${origen === o.id ? 'border-[#0F3D4D]' : 'border-muted-foreground/50'}`}>
                    {origen === o.id && <span className="h-2 w-2 rounded-full bg-[#0F3D4D]" />}
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-sm font-medium">{o.nombre}{o.ia && <MarcaIA />}</span>
                    <span className="block text-xs text-muted-foreground">{o.detalle}</span>
                  </span>
                </button>
              ))}
            </div>
            {origen === 'plantilla' && (
              <select className="w-full rounded-md border px-3 py-2 text-sm" value={nuevaPlantilla} onChange={(e) => setNuevaPlantilla(e.target.value)}>
                {Object.entries(PLANTILLAS).map(([id, p]) => <option key={id} value={id}>{p.nombre}</option>)}
              </select>
            )}
            {origen === 'filtro' && (
              <select className="w-full rounded-md border px-3 py-2 text-sm" value={filtroBase} onChange={(e) => setFiltroBase(e.target.value)}>
                <option value="">{todos ? 'Elige el filtro…' : 'Cargando filtros…'}</option>
                {todos?.map((f) => <option key={f.id} value={f.id}>{f.titulo}{f.proyecto ? ` · ${f.proyecto}` : ''}</option>)}
              </select>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNuevoAbierto(false)}>Cancelar</Button>
            <Button onClick={crear} disabled={creando || !nuevoTitulo.trim() || (origen === 'filtro' && !filtroBase)}>{creando && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Crear</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmar} onOpenChange={(o) => !o && setConfirmar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmar === 'pruebas' ? '¿Borrar las respuestas de prueba?' : '¿Borrar el formulario?'}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmar === 'pruebas'
                ? 'Se borran todas las respuestas marcadas como prueba y sus fotos. No se puede deshacer.'
                : 'Se borra el formulario, sus versiones, sus respuestas de prueba y sus fotos. El enlace deja de funcionar. No se puede deshacer.'}
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

type Vista = VistaEditor | 'respuestas';

const VISTAS: { id: Vista; nombre: string; icono: typeof FileText }[] = [
  { id: 'documento', nombre: 'Documento', icono: FileText },
  { id: 'flujo', nombre: 'Flujo', icono: Workflow },
  { id: 'celular', nombre: 'Celular', icono: Smartphone },
  { id: 'respuestas', nombre: 'Respuestas', icono: Users },
];

function DetalleFiltro({ detalle, proyectoId, onVolver, onEstado, onRecargar, onGuardado, onBorrarPruebas, onBorrarFormulario }: {
  detalle: Detalle;
  proyectoId?: string;
  onVolver: () => void;
  onEstado: (e: 'borrador' | 'prueba' | 'cerrado') => void;
  onRecargar: () => void;
  onGuardado: (def: Definicion) => void;
  onBorrarPruebas: () => void;
  onBorrarFormulario: () => void;
}) {
  const [vista, setVista] = useState<Vista>('documento');
  const editor = useEditorFiltro({ formularioId: detalle.id, inicial: detalle.definicion, revisionInicial: detalle.revision ?? 0, onGuardado });
  const gen = useGenerador({ formularioId: detalle.id, editor, inicial: detalle.generador, usoInicial: detalle.usoIA });
  // Fase 3: mientras no hay preguntas, el filtro abre en el generador (insumos y estructura).
  const [verEstructura, setVerEstructura] = useState(false);
  const enGenerador = verEstructura || gen.g?.etapa === 'insumos' || gen.g?.etapa === 'estructura';
  const estructuraActual = useMemo(
    () => (verEstructura && gen.g?.etapa !== 'estructura' ? estructuraDeDefinicion(editor.def, gen.g?.estructura) : undefined),
    [verEstructura, gen.g?.etapa, gen.g?.estructura, editor.def],
  );
  const def = detalle.definicion;
  const hayReales = detalle.respuestas.some((r) => !r.esPrueba);

  const irA = (id: { seccion?: string; pregunta?: string }) => {
    setVista('documento');
    // Espera a que el Documento esté en pantalla.
    requestAnimationFrame(() => requestAnimationFrame(() => irAlDocumento(id)));
  };

  return (
    <div className="mx-auto max-w-[1180px] space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <button type="button" onClick={onVolver} className="mb-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-[#0F3D4D]">
            <ArrowLeft className="h-3.5 w-3.5" />Formularios
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold leading-tight" style={{ color: TEAL }}>{detalle.titulo}</h2>
            <EstadoPill estado={detalle.estado} />
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {PAISES[def.pais]?.nombre ?? def.pais}
            {def.nse && <> · NSE {def.nse.regla ?? 'propio'}<AvisoRegla def={def} /></>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {detalle.estado === 'borrador' && <Button size="sm" onClick={() => onEstado('prueba')}>Abrir en modo prueba</Button>}
          {detalle.estado === 'prueba' && <Button size="sm" variant="outline" onClick={() => onEstado('cerrado')}>Cerrar</Button>}
          {detalle.estado === 'prueba' && <Button size="sm" variant="outline" onClick={() => onEstado('borrador')}>Volver a borrador</Button>}
          {detalle.estado === 'cerrado' && <Button size="sm" variant="outline" onClick={() => onEstado('prueba')}>Reabrir en prueba</Button>}
          {!hayReales && <Button size="sm" variant="ghost" aria-label="Borrar formulario" onClick={onBorrarFormulario}><Trash2 className="h-4 w-4" /></Button>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">Enlace</span>
        <code className="max-w-full truncate rounded bg-muted px-2 py-1">{enlace(detalle.codigo)}</code>
        <Button size="sm" variant="outline" className="h-7" onClick={() => { navigator.clipboard.writeText(enlace(detalle.codigo)); toast.success('Enlace copiado'); }}>
          <Copy className="mr-1 h-3.5 w-3.5" />Copiar
        </Button>
        <Button size="sm" variant="outline" className="h-7" disabled={detalle.estado === 'borrador'} onClick={() => window.open(enlace(detalle.codigo), '_blank')}>
          <ExternalLink className="mr-1 h-3.5 w-3.5" />Abrir
        </Button>
        {detalle.estado === 'borrador' && <span className="text-muted-foreground">En borrador nadie puede contestarlo.</span>}
        {detalle.estado === 'prueba' && <span style={{ color: ALERTA }}>Modo prueba: todo lo que entre queda marcado como prueba; lo que guardes aquí lo ve ya quien lo contesta.</span>}
      </div>

      {enGenerador && (
        <GeneradorFiltro
          gen={gen} formularioId={detalle.id} actual={estructuraActual} onCerrar={() => setVerEstructura(false)}
          regla={editor.def.secciones.length ? editor.def.nse?.regla : undefined}
        />
      )}

      {!enGenerador && <div className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0">
        <div role="tablist" className="inline-flex gap-1 rounded-lg bg-muted/60 p-1">
          {VISTAS.map((v) => {
            const activa = vista === v.id;
            const Icono = v.icono;
            return (
              <button
                key={v.id}
                role="tab"
                aria-selected={activa}
                onClick={() => setVista(v.id)}
                className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${activa ? 'bg-white text-[#0F3D4D] shadow-sm' : 'text-muted-foreground hover:text-[#0F3D4D]'}`}
              >
                <Icono className="h-4 w-4" />{v.nombre}
                {v.id === 'respuestas' && <span className="text-xs font-normal text-muted-foreground">{detalle.respuestas.length}</span>}
              </button>
            );
          })}
        </div>
      </div>}

      {!enGenerador && (vista === 'respuestas'
        ? <PanelRespuestas detalle={detalle} proyectoId={proyectoId} onRecargar={onRecargar} onBorrarPruebas={onBorrarPruebas} />
        : <EditorFiltro editor={editor} vista={vista} formularioId={detalle.id} onIr={irA} gen={gen} onEstructura={() => { setVista('documento'); setVerEstructura(true); }} />)}
    </div>
  );
}
