import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Clock, History, Loader2, Redo2, Undo2, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ALERTA, EXITO, PELIGRO } from '@/lib/toolColors';
import { TOPE_MINUTOS, duracionEstimada } from '@/lib/formularios/duracion';
import { citar, unirY } from '@/lib/formularios/palabras';
import { esCampoDeTexto } from './imagenes';
import type { Editor } from './useEditorFiltro';
import { Documento } from './Documento';
import { MapaFlujo } from './MapaFlujo';
import { VistaCelular } from './VistaCelular';
import { Versiones } from './Versiones';

export type VistaEditor = 'documento' | 'flujo' | 'celular';

/** Lleva a una sección o pregunta del Documento y la resalta un momento. */
export function irAlDocumento(id: { seccion?: string; pregunta?: string }) {
  const el = document.getElementById(id.pregunta ? `filtro-p-${id.pregunta}` : `filtro-s-${id.seccion}`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  el.animate([{ backgroundColor: 'rgba(244,192,37,0.28)' }, { backgroundColor: 'rgba(244,192,37,0)' }], { duration: 1600, easing: 'ease-out' });
}

function Duracion({ editor }: { editor: Editor }) {
  const { tipico, maximo } = duracionEstimada(editor.def);
  const color = tipico > TOPE_MINUTOS ? PELIGRO : maximo > TOPE_MINUTOS ? ALERTA : EXITO;
  return (
    <span
      className="flex items-center gap-1.5 text-xs font-medium"
      style={{ color }}
      title={`Estimado en el celular: lo típico y lo más largo (si le salen todos los bloques que se repiten, hasta 3 veces). El tope es de ${TOPE_MINUTOS} minutos.`}
    >
      <Clock className="h-3.5 w-3.5" />
      ≈ {tipico} min{maximo > tipico ? ` · hasta ${maximo}` : ''}
      <span className="font-normal text-muted-foreground">· tope {TOPE_MINUTOS}</span>
    </span>
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

function EstadoGuardado({ editor, onIr }: { editor: Editor; onIr: (id: { seccion?: string; pregunta?: string }) => void }) {
  const { estado, problemas } = editor;
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
 * El editor de un filtro (fase 2): barra con deshacer, guardado, minutos y
 * versiones; avisos de otra persona; y la vista elegida (Documento, Flujo o
 * Celular). El estado vive en useEditorFiltro, que guarda el componente de
 * arriba para no perderlo al pasar a Respuestas.
 */
export function EditorFiltro({ editor, vista, formularioId, onIr }: {
  editor: Editor;
  vista: VistaEditor;
  formularioId: string;
  onIr: (id: { seccion?: string; pregunta?: string }) => void;
}) {
  const [versiones, setVersiones] = useState(false);

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
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-0.5">
          <Button size="sm" variant="ghost" className="h-8 px-2" disabled={!editor.puedeDeshacer} onClick={editor.deshacer} title="Deshacer (⌘Z)"><Undo2 className="h-4 w-4" /><span className="ml-1 hidden sm:inline">Deshacer</span></Button>
          <Button size="sm" variant="ghost" className="h-8 px-2" disabled={!editor.puedeRehacer} onClick={editor.rehacer} title="Rehacer (⌘⇧Z)"><Redo2 className="h-4 w-4" /></Button>
        </div>
        <EstadoGuardado editor={editor} onIr={onIr} />
        <Duracion editor={editor} />
        <Button size="sm" variant="outline" className="ml-auto h-8" onClick={() => setVersiones(true)}><History className="mr-1.5 h-3.5 w-3.5" />Versiones</Button>
      </div>

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

      {vista === 'documento' && <Documento editor={editor} onIr={(seccion) => onIr({ seccion })} />}
      {vista === 'flujo' && (
        <div className="rounded-xl border bg-white px-4 py-5 sm:px-8">
          <p className="mx-auto mb-1 max-w-3xl text-xs text-muted-foreground">
            Los bloques en orden. Los corridos a la derecha aparecen solo si aplica; los que llevan sombra se repiten. Un clic lleva a esa parte del documento.
          </p>
          <MapaFlujo def={editor.def} onIr={(seccion) => onIr({ seccion })} />
        </div>
      )}
      {vista === 'celular' && <VistaCelular def={editor.def} conProblemas={editor.problemas.length > 0} />}

      {versiones && (
        <Versiones
          formularioId={formularioId}
          actual={editor.def}
          sinGuardar={editor.sinGuardar}
          onRestaurar={(def) => editor.aplicar(() => def)}
          onClose={() => setVersiones(false)}
        />
      )}
    </div>
  );
}
