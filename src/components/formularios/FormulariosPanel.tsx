import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  getFormularios, createFormulario, getFormularioDetail,
  setFormularioEstado, deleteFormularioRespuestas, deleteFormulario, duplicateFormulario, getFormularioDocumento,
} from 'zite-endpoints-sdk';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ArrowLeft, CopyPlus, Loader2, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { TEAL, EstadoPill } from '@/lib/toolColors';
import { PLANTILLAS } from '@/lib/formularios/plantillas';
import type { Definicion } from '@/lib/formularios/tipos';
import { estructuraDeDefinicion, supuestosDe } from '@/lib/formularios/generador';
import { chequeosListo } from '@/lib/formularios/listo';
import { AccionPaso, type EstadoEditable } from './EstadoFiltro';
import { Recorrido, pasoActual, pasosDe, type PasoFiltro } from './Recorrido';
import { PorRevisar } from './PorRevisar';
import { CambiosEnVivo } from './CambiosEnVivo';
import { Supuestos } from './generador/Supuestos';
import { NombresCortos } from './generador/NombresCortos';
import { cambiarPregunta } from '@/lib/formularios/editar';
import { MenuFiltro } from './MenuFiltro';
import { Versiones } from './editor/Versiones';
import { AvisoRegla, PanelRespuestas, type Detalle } from './PanelRespuestas';
import { useEditorFiltro } from './editor/useEditorFiltro';
import { Duracion, EditorFiltro, EstadoGuardado, irAlDocumento, type VistaEditor } from './editor/EditorFiltro';
import { useGenerador } from './generador/useGenerador';
import { GeneradorFiltro } from './generador/GeneradorFiltro';
import { MarcaIA } from './generador/comun';
import { enlaceDeFormulario } from '@/lib/formularios/dominio';

interface FormularioRow {
  id: string; codigo: string; titulo: string; estado: string; respuestasPrueba: number; respuestasReales: number; califican: number; proyecto?: string;
  etapa?: string; meta: number; calificanReales: number; cambiosPendientes: boolean;
}

/** En qué va un filtro, para la lista: el paso y, en vivo, cuántos van de la cuota. */
function enQueVa(f: FormularioRow): string {
  const respuestas = f.respuestasPrueba + f.respuestasReales;
  if (f.estado === 'en_vivo') return `En vivo · ${f.calificanReales} de ${f.meta} en cuota${f.cambiosPendientes ? ' · cambios sin publicar' : ''}`;
  if (f.estado === 'cerrado') return `Cerrado · ${f.calificanReales} de ${f.meta} en cuota`;
  if (f.estado === 'prueba') return `Probando · ${respuestas} ${respuestas === 1 ? 'respuesta' : 'respuestas'} de prueba`;
  if (f.etapa === 'insumos') return 'Por pedir la estructura';
  if (f.etapa === 'estructura') return 'Estructura por aprobar';
  if (f.etapa === 'preguntas') return 'Preguntas por escribir';
  return 'Preguntas por revisar';
}

type Origen = 'insumos' | 'word' | 'filtro' | 'plantilla';
const ORIGENES: { id: Origen; nombre: string; detalle: string; ia?: boolean }[] = [
  { id: 'insumos', nombre: 'Con IA, desde los insumos', detalle: 'Notas, la propuesta y el kick-off de Notetaker.', ia: true },
  { id: 'word', nombre: 'Con IA, desde un screener en Word', detalle: 'Se vuelve un filtro editable con su misma redacción.', ia: true },
  { id: 'filtro', nombre: 'Desde un filtro anterior', detalle: 'Se copia y, si cambia algo, la IA lo adapta.' },
  { id: 'plantilla', nombre: 'Desde una plantilla', detalle: 'ALONG 2 o la de todos los tipos de pregunta.' },
];

const enlace = enlaceDeFormulario;

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
  const [traer, setTraer] = useState(false);
  const [creando, setCreando] = useState(false);
  const [confirmar, setConfirmar] = useState<{ que: 'pruebas' } | { que: 'formulario'; id: string; titulo: string } | null>(null);

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
        ...(origen === 'filtro' ? { filtroBaseId: filtroBase, traerRespuestas: traer } : {}),
      }) as { id: string; traidas?: number };
      if (r.traidas !== undefined) toast.success(`${r.traidas === 1 ? 'Se trajo 1 persona' : `Se trajeron ${r.traidas} personas`} del filtro anterior. Su historial se busca en un momento.`);
      setNuevoAbierto(false);
      setNuevoTitulo('');
      await cargarLista();
      setSeleccionado(r.id);
    } catch (err) {
      toast.error((err as Error).message || 'No se pudo crear el formulario.');
    }
    setCreando(false);
  };

  const cambiarEstado = async (estado: EstadoEditable) => {
    if (!detalle) return;
    try {
      await setFormularioEstado({ formularioId: detalle.id, estado });
      if (estado === 'en_vivo') toast.success('Ya está en vivo: el enlace recibe respuestas reales.');
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

  const borrarFormulario = async (id: string) => {
    try {
      await deleteFormulario({ formularioId: id });
      if (seleccionado === id) setSeleccionado(null);
      toast.success('Filtro borrado');
      await cargarLista();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  /** Copia como borrador nuevo (mismo screener y lo de la IA) y la abre. */
  const duplicar = async (id: string) => {
    const espera = toast.loading('Duplicando…');
    try {
      const r = await duplicateFormulario({ formularioId: id });
      toast.success('Copia creada: está en borrador', { id: espera });
      await cargarLista();
      setSeleccionado(r.id);
    } catch (err) {
      toast.error((err as Error).message || 'No se pudo duplicar.', { id: espera });
    }
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto p-3 sm:p-6">
      {!seleccionado && (
        <div className="mx-auto max-w-4xl">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-base font-semibold" style={{ color: TEAL }}>Filtros</h3>
            <Button size="sm" onClick={() => setNuevoAbierto(true)}><Plus className="mr-1 h-3.5 w-3.5" />Nuevo filtro</Button>
          </div>
          {cargando && <p className="text-xs text-muted-foreground">Cargando…</p>}
          {!cargando && lista.length === 0 && <p className="text-sm text-muted-foreground">Todavía no hay filtros en este proyecto.</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            {lista.map((f) => (
              <div key={f.id} className="relative rounded-lg border bg-white transition-colors hover:border-[#0F3D4D]/50 hover:bg-[#0F3D4D]/[0.03]">
                <button onClick={() => setSeleccionado(f.id)} className="w-full p-4 pr-11 text-left">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium leading-snug">{f.titulo}</span>
                    <EstadoPill estado={f.estado} />
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">{enQueVa(f)}</p>
                </button>
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <button type="button" aria-label={`Más de «${f.titulo}»`} className="absolute bottom-2.5 right-2.5 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-[#0F3D4D]">
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-60">
                    <DropdownMenuItem onSelect={() => void duplicar(f.id)}><CopyPlus className="mr-2 h-4 w-4" />Duplicar</DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={f.respuestasReales > 0}
                      className="text-[#D32222] focus:text-[#D32222]"
                      onSelect={() => setConfirmar({ que: 'formulario', id: f.id, titulo: f.titulo })}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />{f.respuestasReales > 0 ? 'Tiene respuestas reales: ciérralo' : 'Borrar'}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
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
          onGuardado={(definicion) => setDetalle((d) => (d ? (d.estado === 'en_vivo' ? { ...d, cambios: definicion } : { ...d, definicion }) : d))}
          onPublicado={(definicion) => setDetalle((d) => (d ? { ...d, definicion, cambios: undefined } : d))}
          onBorrarPruebas={() => setConfirmar({ que: 'pruebas' })}
          onBorrarFormulario={() => setConfirmar({ que: 'formulario', id: detalle.id, titulo: detalle.titulo })}
          onDuplicar={() => void duplicar(detalle.id)}
        />
      )}

      <Dialog open={nuevoAbierto} onOpenChange={setNuevoAbierto}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nuevo filtro</DialogTitle></DialogHeader>
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
            {origen === 'filtro' && filtroBase && (() => {
              const base = todos?.find((f) => f.id === filtroBase);
              const n = base ? base.respuestasPrueba + base.respuestasReales : 0;
              return (
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-0.5 accent-[#0F3D4D]" checked={traer} disabled={!n} onChange={(e) => setTraer(e.target.checked)} />
                  <span>
                    Traer también a quienes lo contestaron{n ? ` (${n} ${n === 1 ? 'respuesta' : 'respuestas'})` : ' (no tiene respuestas)'}
                    <span className="block text-xs text-muted-foreground">Llegan con su fecha y su historial, calificados con este filtro. No cuentan en las cuotas hasta pasarlos al tablero.</span>
                  </span>
                </label>
              );
            })()}
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
            <AlertDialogTitle>{confirmar?.que === 'pruebas' ? '¿Borrar las respuestas de prueba?' : `¿Borrar «${confirmar?.que === 'formulario' ? confirmar.titulo : ''}»?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmar?.que === 'pruebas'
                ? 'Se borran todas las respuestas marcadas como prueba y sus fotos. No se puede deshacer.'
                : 'Se borra el formulario, sus versiones, sus respuestas de prueba y sus fotos. El enlace deja de funcionar. No se puede deshacer.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => (confirmar?.que === 'pruebas' ? borrarPruebas() : confirmar && void borrarFormulario(confirmar.id))}>Borrar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

type Modo = 'disenar' | 'reclutar';

const VISTAS: { id: VistaEditor; nombre: string }[] = [
  { id: 'documento', nombre: 'Documento' },
  { id: 'flujo', nombre: 'Flujo' },
  { id: 'celular', nombre: 'Celular' },
];

function DetalleFiltro({ detalle, proyectoId, onVolver, onEstado, onRecargar, onGuardado, onPublicado, onBorrarPruebas, onBorrarFormulario, onDuplicar }: {
  detalle: Detalle;
  proyectoId?: string;
  onVolver: () => void;
  onEstado: (e: EstadoEditable) => void;
  onRecargar: () => void;
  onGuardado: (def: Definicion) => void;
  onPublicado: (def: Definicion) => void;
  onBorrarPruebas: () => void;
  onBorrarFormulario: () => void;
  onDuplicar: () => void;
}) {
  const enVivo = detalle.estado === 'en_vivo';
  const puedeReclutar = detalle.estado !== 'borrador';
  // En vivo o cerrado abre en Reclutar; antes, en Diseñar.
  const [modo, setModo] = useState<Modo>(enVivo || detalle.estado === 'cerrado' ? 'reclutar' : 'disenar');
  const [vista, setVista] = useState<VistaEditor>('documento');
  const [versiones, setVersiones] = useState(false);
  useEffect(() => { if (!puedeReclutar) setModo('disenar'); }, [puedeReclutar]);
  useEffect(() => { if (enVivo) setModo('reclutar'); }, [enVivo]);

  const editor = useEditorFiltro({
    formularioId: detalle.id, inicial: detalle.cambios ?? detalle.definicion, revisionInicial: detalle.revision ?? 0, onGuardado,
    publicada: enVivo ? detalle.definicion : undefined,
  });
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

  // Un solo camino: Insumos · Estructura · Preguntas · Probar · Reclutar.
  const pasos = pasosDe(!!gen.g);
  const paso = pasoActual(detalle.estado, gen.g?.etapa);
  const puedeIr = (p: PasoFiltro) => {
    if (p === 'insumos' || pasos.indexOf(p) > pasos.indexOf(paso)) return false;
    if (p === 'estructura') return paso !== 'estructura' && !gen.escribiendo;
    if (p === 'reclutar') return puedeReclutar;
    return true;
  };
  const irPaso = (p: PasoFiltro) => {
    if (p === 'estructura') { setVerEstructura(true); return; }
    setVerEstructura(false);
    if (p === 'reclutar') { setModo('reclutar'); return; }
    setModo('disenar');
    setVista(p === 'probar' ? 'celular' : 'documento');
  };

  // «Por revisar»: los supuestos de la IA, los nombres cortos y lo que falta para estar listo, juntos.
  const chequeos = useMemo(() => {
    const supuestos = gen.g ? supuestosDe(gen.g).length : 0;
    const todos = chequeosListo({
      def: editor.def,
      problemas: editor.problemas.length,
      supuestosPorRevisar: gen.g ? (gen.g.supuestosRevisados ? 0 : supuestos) : undefined,
      respuestasDePrueba: detalle.respuestas.filter((r) => r.esPrueba).length,
      vinculado: !!detalle.tablero,
    });
    // Probarlo y vincular el tablero son del paso Probar: antes no cuentan como pendientes.
    return detalle.estado === 'borrador' ? todos.filter((c) => c.id !== 'probado' && c.id !== 'tablero') : todos;
  }, [editor.def, editor.problemas.length, gen.g, detalle.respuestas, detalle.tablero, detalle.estado]);
  const ia = useMemo(() => ({ formularioId: detalle.id, contarUso: () => gen.contarUso() }), [detalle.id, gen.contarUso]); // eslint-disable-line react-hooks/exhaustive-deps
  const porRevisar = !enGenerador && (paso === 'preguntas' || paso === 'probar') && (
    <PorRevisar
      chequeos={chequeos}
      detalle={{
        supuestos: gen.g && (
          <Supuestos
            items={supuestosDe(gen.g).map((x) => ({ texto: x.texto, donde: x.seccion === 'frentes' ? 'Perfiles' : x.seccion ? gen.g!.estructura?.secciones.find((s) => s.id === x.seccion)?.titulo.split('{opcion}').join('…') : undefined }))}
            revisado={gen.g.supuestosRevisados}
            onRevisar={gen.marcarRevisados}
          />
        ),
        nombres: !gen.escribiendo && (
          <NombresCortos
            def={editor.def}
            ia={ia}
            onPoner={(nombres) => editor.aplicar((d) => Object.entries(nombres).reduce((x, [id, nombre]) => cambiarPregunta(x, id, { nombre }), d))}
          />
        ),
      }}
    />
  );

  /** El Word o el PDF para el cliente, con lo último guardado (si hay cambios en camino, se guardan antes). */
  const descargar = async (formato: 'word' | 'pdf') => {
    const nombre = formato === 'word' ? 'Word' : 'PDF';
    if (editor.problemas.length) { toast.error(`Hay cosas por corregir en el filtro: corrígelas antes de bajar el ${nombre}.`); return; }
    if (editor.estado === 'conflicto') { toast.error('Primero carga lo guardado desde la otra ventana.'); return; }
    const aviso = toast.loading(`Armando el ${nombre}…`);
    try {
      if (editor.estado !== 'guardado') await editor.reintentar();
      const r = await getFormularioDocumento({ formularioId: detalle.id, formato }) as { nombre: string; base64: string };
      const bytes = Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: formato === 'word' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = r.nombre;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast.success(`${nombre} listo. Esta versión quedó guardada en Versiones.`, { id: aviso });
    } catch (err) {
      toast.error((err as Error).message || `No se pudo armar el ${nombre}.`, { id: aviso });
    }
  };

  const irA = (id: { seccion?: string; pregunta?: string }) => {
    setModo('disenar');
    setVista('documento');
    // Espera a que el Documento esté en pantalla.
    requestAnimationFrame(() => requestAnimationFrame(() => irAlDocumento(id)));
  };

  const aviso = AvisoRegla({ def });
  return (
    <div className="mx-auto max-w-[1180px] space-y-4">
      <div className="space-y-3 rounded-xl border border-[#E4E4E7] bg-white px-4 py-3 shadow-sm sm:px-5">
        <button type="button" onClick={onVolver} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-[#0F3D4D]">
          <ArrowLeft className="h-3.5 w-3.5" />Filtros
        </button>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="min-w-0 text-lg font-semibold leading-tight" style={{ color: TEAL }}>{detalle.titulo}</h2>
            <EstadoPill estado={detalle.estado} />
          </div>
          <div className="flex items-center gap-2">
            {!enGenerador && <EstadoGuardado editor={editor} onIr={irA} generando={gen.escribiendo} />}
            {!enGenerador && <Duracion editor={editor} />}
            <MenuFiltro
              editor={editor} estado={detalle.estado} enlace={enlace(detalle.codigo)} uso={gen.g ? gen.uso : undefined} escribiendo={gen.escribiendo}
              onEstado={onEstado}
              onEstructura={gen.g && !enGenerador ? () => setVerEstructura(true) : undefined}
              onVersiones={() => setVersiones(true)}
              onDuplicar={onDuplicar}
              onDescargar={descargar}
              onBorrar={hayReales ? undefined : onBorrarFormulario}
            />
          </div>
        </div>
        <Recorrido pasos={pasos} actual={paso} puedeIr={puedeIr} onIr={irPaso} />
        <AccionPaso
          paso={paso} estado={detalle.estado} escribiendo={gen.escribiendo} hayReales={hayReales} chequeos={chequeos} onEstado={onEstado}
          extra={aviso && <span>NSE {def.nse?.regla}{aviso}</span>}
          derecha={porRevisar}
        />
      </div>

      {enGenerador && (
        <GeneradorFiltro
          gen={gen} formularioId={detalle.id} proyectoId={proyectoId} actual={estructuraActual} onCerrar={() => setVerEstructura(false)}
          regla={editor.def.secciones.length ? editor.def.nse?.regla : undefined}
        />
      )}

      {!enGenerador && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {puedeReclutar && (
            <div role="tablist" aria-label="Modo" className="inline-flex rounded-lg bg-[#F1F2F4] p-[3px]">
              {(['disenar', 'reclutar'] as const).map((m) => (
                <button
                  key={m}
                  role="tab"
                  aria-selected={modo === m}
                  onClick={() => setModo(m)}
                  className={`rounded-md px-3.5 py-1 text-sm transition-colors ${modo === m ? 'bg-[#0F3D4D] font-semibold text-white shadow-sm' : 'text-[#5B687B] hover:text-[#0F3D4D]'}`}
                >
                  {m === 'disenar' ? 'Diseñar' : `Reclutar · ${detalle.respuestas.length}`}
                </button>
              ))}
            </div>
          )}
          {modo === 'disenar' && (
            <div role="tablist" aria-label="Vista" className="flex gap-4 border-b border-[#E4E4E7]">
              {VISTAS.map((v) => {
                const activa = vista === v.id;
                return (
                  <button
                    key={v.id}
                    role="tab"
                    aria-selected={activa}
                    onClick={() => setVista(v.id)}
                    className={`-mb-px border-b-2 px-0.5 pb-1.5 pt-1 text-sm transition-colors ${activa ? 'border-[#0F3D4D] font-semibold text-[#0F3D4D]' : 'border-transparent text-muted-foreground hover:text-[#0F3D4D]'}`}
                  >
                    {v.nombre}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {!enGenerador && modo === 'disenar' && enVivo && (
        <CambiosEnVivo editor={editor} respuestas={detalle.respuestas.filter((r) => !r.esPrueba).length} onPublicado={onPublicado} onIr={irA} />
      )}

      {!enGenerador && (modo === 'reclutar'
        ? <PanelRespuestas detalle={detalle} proyectoId={proyectoId} enlace={enlace(detalle.codigo)} onRecargar={onRecargar} onBorrarPruebas={onBorrarPruebas} />
        : <EditorFiltro editor={editor} vista={vista} formularioId={detalle.id} onIr={irA} gen={gen} />)}

      {versiones && (
        <Versiones
          formularioId={detalle.id}
          actual={editor.def}
          sinGuardar={editor.sinGuardar}
          onRestaurar={(d) => editor.aplicar(() => d)}
          onClose={() => setVersiones(false)}
        />
      )}
    </div>
  );
}
