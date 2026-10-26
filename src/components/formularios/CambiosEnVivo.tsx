import { useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown, Loader2 } from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ALERTA } from '@/lib/toolColors';
import type { Definicion } from '@/lib/formularios/tipos';
import type { Editor } from './editor/useEditorFiltro';
import { ListaPorCorregir } from './editor/EditorFiltro';
import { botonSecundario, botonTeal } from './generador/comun';

const MAX_EN_LISTA = 12;

/**
 * Editar un filtro en vivo (pedido de Sergio, 2026-10-24): lo que se cambia
 * se guarda en una copia y los participantes siguen con lo publicado hasta
 * «Publicar cambios», que antes dice qué cambia y que lo ya contestado no se
 * toca. «Descartar» regresa a lo publicado. Aquí mismo se ven los cambios
 * («Ver cuáles») y, si algo quedó mal armado, qué corregir para publicar.
 */
export function CambiosEnVivo({ editor, respuestas, onPublicado, onIr }: {
  editor: Editor;
  /** Cuántas respuestas ya entraron (no cambian al publicar). */
  respuestas: number;
  onPublicado: (def: Definicion) => void;
  /** Lleva a la pregunta o sección de lo que hay que corregir. */
  onIr: (id: { seccion?: string; pregunta?: string }) => void;
}) {
  const [confirmar, setConfirmar] = useState<'publicar' | 'descartar' | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [verCambios, setVerCambios] = useState(false);

  if (!editor.cambiosPendientes) {
    return <p className="text-xs text-muted-foreground">En vivo: lo que cambies se guarda aparte y los participantes no lo ven hasta que lo publiques.</p>;
  }
  const resumen = editor.resumenCambios.length ? editor.resumenCambios : ['Cambios en los textos.'];
  const porCorregir = editor.problemas.length > 0;

  const hacer = async (que: 'publicar' | 'descartar') => {
    setTrabajando(true);
    try {
      const ok = que === 'publicar' ? await editor.publicar() : await editor.descartarCambios();
      if (!ok) { toast.error('Otra ventana guardó cambios mientras tanto: carga lo guardado y vuelve a intentarlo.'); return; }
      if (que === 'publicar') {
        onPublicado(editor.leer());
        toast.success('Cambios publicados: los participantes ya ven la versión nueva.');
      } else toast.success('Cambios descartados: quedó lo publicado.');
    } catch (err) {
      toast.error((err as Error).message || 'No se pudo.');
    } finally {
      setTrabajando(false);
      setConfirmar(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-3 py-2.5" style={{ borderColor: `${ALERTA}66`, backgroundColor: `${ALERTA}0f` }}>
      <div className="min-w-0 flex-1 text-xs" style={{ color: '#8a4b00' }}>
        <p className="flex flex-wrap items-center gap-x-2 font-semibold">
          Cambios sin publicar · {resumen.length}
          <button type="button" className="flex items-center gap-0.5 font-medium underline-offset-2 hover:underline" onClick={() => setVerCambios((v) => !v)}>
            {verCambios ? 'Ocultar' : 'Ver cuáles'}<ChevronDown className={`h-3 w-3 transition-transform ${verCambios ? 'rotate-180' : ''}`} />
          </button>
        </p>
        <p>{porCorregir ? `Para publicarlos (y para que se guarden), corrige ${editor.problemas.length === 1 ? 'esto' : `estas ${editor.problemas.length} cosas`}:` : 'Los participantes siguen viendo la versión publicada.'}</p>
      </div>
      <button type="button" className={`${botonSecundario} !text-xs`} disabled={trabajando} onClick={() => setConfirmar('descartar')}>Descartar</button>
      <button type="button" className={`${botonTeal} !px-3 !py-1.5 !text-xs`} disabled={trabajando || porCorregir} onClick={() => setConfirmar('publicar')}>Publicar cambios</button>
      {porCorregir && (
        <div className="basis-full rounded-md border border-[#D32222]/25 bg-white px-3 py-2 text-[13px] text-[#1F1F23]">
          <ListaPorCorregir editor={editor} onIr={onIr} />
        </div>
      )}
      {verCambios && (
        <ul className="max-h-60 basis-full list-disc space-y-0.5 overflow-y-auto rounded-md bg-white px-3 py-2 pl-7 text-[13px] text-[#1F1F23]">
          {resumen.map((c) => <li key={c}>{c}</li>)}
        </ul>
      )}

      <AlertDialog open={!!confirmar} onOpenChange={(o) => !o && !trabajando && setConfirmar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmar === 'publicar' ? `¿Publicar ${resumen.length === 1 ? 'el cambio' : `${resumen.length} cambios`}?` : '¿Descartar los cambios sin publicar?'}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                {confirmar === 'publicar' ? (
                  <>
                    <ul className="max-h-60 list-disc space-y-1 overflow-y-auto pl-5 text-[#1F1F23]">
                      {resumen.slice(0, MAX_EN_LISTA).map((c) => <li key={c}>{c}</li>)}
                      {resumen.length > MAX_EN_LISTA && <li>y {resumen.length - MAX_EN_LISTA} más.</li>}
                    </ul>
                    <p className="rounded-md bg-muted/60 px-3 py-2">
                      {respuestas
                        ? `Las ${respuestas === 1 ? 'respuesta que ya entró no cambia' : `${respuestas} respuestas que ya entraron no cambian`}: se quedan como se contestaron.`
                        : 'Todavía no hay respuestas reales.'}{' '}
                      Quien esté contestando sigue con la versión nueva desde la siguiente pantalla.
                    </p>
                  </>
                ) : (
                  <p>El filtro regresa a lo que ven los participantes. Se puede deshacer con ⌘Z.</p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={trabajando}>{confirmar === 'publicar' ? 'Seguir editando' : 'Cancelar'}</AlertDialogCancel>
            <AlertDialogAction disabled={trabajando} onClick={(e) => { e.preventDefault(); void hacer(confirmar!); }}>
              {trabajando && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {confirmar === 'publicar' ? 'Publicar' : 'Descartar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
