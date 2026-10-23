import { Fragment, useEffect, useMemo } from 'react';
import { AlertTriangle, Check, Clock, Loader2, Undo2, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ALERTA, EXITO, PELIGRO } from '@/lib/toolColors';
import { TOPE_MINUTOS, duracionEstimada, duracionPorPerfil } from '@/lib/formularios/duracion';
import { citar, unirY } from '@/lib/formularios/palabras';
import { esCampoDeTexto } from './imagenes';
import type { Editor } from './useEditorFiltro';
import { Documento } from './Documento';
import { MapaFlujo } from './MapaFlujo';
import { VistaCelular } from './VistaCelular';
import { supuestosDe } from '@/lib/formularios/generador';
import type { GeneradorUI } from '../generador/useGenerador';
import { AvanceEscritura } from '../generador/AvanceEscritura';
import { Supuestos } from '../generador/Supuestos';
import { NombresCortos } from '../generador/NombresCortos';
import { cambiarPregunta } from '@/lib/formularios/editar';

export type VistaEditor = 'documento' | 'flujo' | 'celular';

/** Lleva a una sección o pregunta del Documento y la resalta un momento. */
export function irAlDocumento(id: { seccion?: string; pregunta?: string }) {
  const el = document.getElementById(id.pregunta ? `filtro-p-${id.pregunta}` : `filtro-s-${id.seccion}`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  el.animate([{ backgroundColor: 'rgba(244,192,37,0.28)' }, { backgroundColor: 'rgba(244,192,37,0)' }], { duration: 1600, easing: 'ease-out' });
}

export function Duracion({ editor }: { editor: Editor }) {
  const { tipico, maximo } = duracionEstimada(editor.def);
  const perfiles = duracionPorPerfil(editor.def);
  const masLento = Math.max(tipico, ...perfiles.map((p) => p.minutos));
  // En la barra, de cuánto a cuánto tarda quien entra a cada perfil (o lo típico, sin perfiles); el detalle, al tocarlo.
  const masRapido = perfiles.length ? Math.min(...perfiles.map((p) => p.minutos)) : tipico;
  const rango = perfiles.length && masRapido !== masLento ? `${masRapido} a ${masLento} min` : `≈ ${masLento} min`;
  const colorDe = (min: number) => (min > TOPE_MINUTOS ? PELIGRO : EXITO);
  const color = masLento > TOPE_MINUTOS ? PELIGRO : maximo > TOPE_MINUTOS ? ALERTA : EXITO;
  const fila = (texto: string, min: number, colorMin = colorDe(min)) => (
    <li className="flex items-baseline gap-2">
      <span className="min-w-0 flex-1 truncate">{texto}</span>
      <span className="font-semibold tabular-nums" style={{ color: colorMin }}>{min} min</span>
    </li>
  );
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-medium hover:bg-muted" style={{ color }}>
          <Clock className="h-3.5 w-3.5" />
          {rango}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] text-sm">
        <p className="mb-2 text-xs text-muted-foreground">Estimado en el celular. Lo más largo: si le salen todos los bloques. Tope: {TOPE_MINUTOS} min.</p>
        {perfiles.length > 0 && (
          <>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Por perfil</p>
            <ul className="mb-2 mt-1 space-y-1">{perfiles.map((p) => <Fragment key={p.id}>{fila(p.nombre, p.minutos)}</Fragment>)}</ul>
          </>
        )}
        <ul className="space-y-1 border-t pt-2">
          {fila('Lo típico', tipico)}
          {fila('Lo más largo', maximo, maximo > TOPE_MINUTOS ? ALERTA : EXITO)}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/** Los problemas nombran preguntas y secciones por su clave interna («agrado»): aquí se leen por su texto. */
function legible(def: Editor['def'], texto: string): string {
  return texto.replace(/«([^»]+)»/g, (todo, id: string) => {
    if (def.secciones.some((s) => s.preguntas.some((p) => p.id === id))) return citar(def, id, 50);
    const s = def.secciones.find((x) => x.id === id);
    return s ? `«${(s.titulo ?? s.id).split('{opcion}').join('…')}»` : todo;
  });
}

export function EstadoGuardado({ editor, onIr, generando }: { editor: Editor; onIr: (id: { seccion?: string; pregunta?: string }) => void; generando?: boolean }) {
  const { estado, problemas } = editor;
  // Mientras la IA escribe, una sección puede usar otra que todavía no llega: se guarda al completarse.
  if (generando && estado === 'por_corregir') {
    return <span className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Se guarda en cuanto la IA termine</span>;
  }
  if (estado === 'guardando' || estado === 'pendiente') {
    return <span className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Guardando…</span>;
  }
  if (estado === 'guardado') return <span className="flex items-center gap-1 text-xs" style={{ color: EXITO }}><Check className="h-3.5 w-3.5" />Guardado</span>;
  if (estado === 'por_corregir') {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold hover:bg-muted" style={{ color: PELIGRO }}>
            <AlertTriangle className="h-3.5 w-3.5" />Sin guardar: {problemas.length === 1 ? '1 cosa' : `${problemas.length} cosas`} por corregir
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-96 max-w-[calc(100vw-2rem)] text-sm">
          <p className="mb-2 text-xs text-muted-foreground">Mientras esto no se corrija, los cambios no se guardan (si el filtro está en prueba, la gente sigue contestando lo último guardado).</p>
          <ul className="max-h-72 space-y-2 overflow-y-auto">
            {problemas.map((p, i) => (
              <li key={i}>
                {p.pregunta || p.seccion ? (
                  <button type="button" className="text-left hover:underline" onClick={() => onIr(p)}>
                    {p.pregunta && <span className="font-medium">{citar(editor.def, p.pregunta, 50)}: </span>}
                    {legible(editor.def, p.pregunta ? p.texto.replace(/^«[^»]+»: /, '') : p.texto)}
                  </button>
                ) : legible(editor.def, p.texto)}
              </li>
            ))}
          </ul>
          <Button size="sm" variant="outline" className="mt-3" disabled={!editor.puedeDeshacer} onClick={editor.deshacer}><Undo2 className="mr-1 h-3.5 w-3.5" />Deshacer el último cambio</Button>
        </PopoverContent>
      </Popover>
    );
  }
  if (estado === 'error') {
    return (
      <span className="flex items-center gap-1.5 text-xs" style={{ color: PELIGRO }} title={editor.error}>
        <AlertTriangle className="h-3.5 w-3.5" />No se pudo guardar
        <button type="button" className="font-semibold underline" onClick={editor.reintentar}>Reintentar</button>
      </span>
    );
  }
  return null; // conflicto: va en su propio aviso
}

/**
 * El editor de un filtro (fase 2): avisos (lo que escribe la IA, otra persona,
 * nombres cortos, supuestos) y la vista elegida (Documento, Flujo o Celular).
 * Guardado, minutos y el menú «⋯» van en la barra de pestañas (FormulariosPanel). El estado vive en useEditorFiltro, que guarda el componente de
 * arriba para no perderlo al pasar a Respuestas.
 */
export function EditorFiltro({ editor, vista, formularioId, onIr, gen }: {
  editor: Editor;
  vista: VistaEditor;
  formularioId: string;
  onIr: (id: { seccion?: string; pregunta?: string }) => void;
  /** Fase 3: el generador con IA (supuestos, avance de la escritura, botón IA y comentarios). */
  gen?: GeneradorUI;
}) {
  const contarUso = gen?.contarUso;
  const hayIA = !!gen;
  const ia = useMemo(() => (hayIA && contarUso ? { formularioId, contarUso: () => contarUso() } : undefined), [hayIA, contarUso, formularioId]);

  // ⌘Z deshace y ⌘⇧Z rehace, salvo mientras se escribe en un cuadro.
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || esCampoDeTexto(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); editor.deshacer(); }
      if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); editor.rehacer(); }
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [editor.deshacer, editor.rehacer]); // eslint-disable-line react-hooks/exhaustive-deps

  const otros = editor.otros;
  return (
    <div className="space-y-3">
      {gen?.g?.estructura && <AvanceEscritura gen={gen} def={editor.def} />}

      {otros.length > 0 && (
        <p className="flex items-start gap-2 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: `${ALERTA}66`, color: '#8a4b00', backgroundColor: `${ALERTA}0f` }}>
          <Users className="mt-px h-3.5 w-3.5 flex-shrink-0" />
          <span>
            {otros.every((o) => o.mismaPersona)
              ? 'También lo tienes abierto en otra ventana.'
              : `También lo tiene abierto ${unirY([...new Set(otros.filter((o) => !o.mismaPersona).map((o) => o.nombre))])}${otros.some((o) => o.mismaPersona) ? ' (y tú, en otra ventana)' : ''}.`}
            {' '}Si los dos hacen cambios, el segundo en guardar recibe un aviso y no pisa lo del otro.
          </span>
        </p>
      )}
      {editor.estado === 'conflicto' && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: `${PELIGRO}55`, backgroundColor: `${PELIGRO}0a` }}>
          <AlertTriangle className="h-4 w-4 flex-shrink-0" style={{ color: PELIGRO }} />
          <span className="min-w-0 flex-1">
            Este filtro se guardó desde otra ventana o por otra persona mientras lo editabas. Para no pisar esos cambios, lo tuyo no se guardó.
          </span>
          <Button size="sm" onClick={editor.cargarGuardada}>Cargar lo guardado</Button>
          <span className="w-full text-muted-foreground sm:w-auto">Lo tuyo queda en Deshacer.</span>
        </div>
      )}

      {vista === 'documento' && ia && !gen?.escribiendo && gen?.g?.etapa !== 'preguntas' && (
        <NombresCortos
          def={editor.def}
          ia={ia}
          onPoner={(nombres) => editor.aplicar((d) => Object.entries(nombres).reduce((x, [id, nombre]) => cambiarPregunta(x, id, { nombre }), d))}
        />
      )}
      {vista === 'documento' && gen?.g && (
        <Supuestos
          items={supuestosDe(gen.g).map((x) => ({ texto: x.texto, donde: x.seccion === 'frentes' ? 'Perfiles' : x.seccion ? gen.g!.estructura?.secciones.find((s) => s.id === x.seccion)?.titulo.split('{opcion}').join('…') : undefined }))}
          revisado={gen.g.supuestosRevisados}
          onRevisar={gen.marcarRevisados}
        />
      )}
      {vista === 'documento' && (
        <Documento
          editor={editor}
          ia={ia}
          pendientes={gen?.g?.etapa === 'preguntas' && gen.g.estructura ? {
            orden: gen.g.estructura.secciones.map((s) => s.id),
            titulos: Object.fromEntries(gen.g.estructura.secciones.map((s) => [s.id, s.titulo])),
            escribiendo: new Set(Object.entries(gen.secciones).filter(([, v]) => v.estado === 'escribiendo').map(([id]) => id)),
          } : undefined}
        />
      )}
      {vista === 'flujo' && (
        <div className="rounded-xl border bg-white px-3 py-6 sm:px-8">
          <MapaFlujo def={editor.def} onIr={(seccion) => onIr({ seccion })} />
        </div>
      )}
      {vista === 'celular' && <VistaCelular def={editor.def} conProblemas={editor.problemas.length > 0} />}
    </div>
  );
}
