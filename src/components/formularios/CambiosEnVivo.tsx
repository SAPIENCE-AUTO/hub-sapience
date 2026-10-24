import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ALERTA } from '@/lib/toolColors';
import type { Definicion } from '@/lib/formularios/tipos';
import type { Editor } from './editor/useEditorFiltro';
import { botonSecundario, botonTeal } from './generador/comun';

const MAX_EN_LISTA = 12;

/**
 * Editar un filtro en vivo (pedido de Sergio, 2026-10-24): lo que se cambia
 * se guarda en una copia y los participantes siguen con lo publicado hasta
 * «Publicar cambios», que antes dice qué cambia y que lo ya contestado no se
 * toca. «Descartar» regresa a lo publicado.
 */
export function CambiosEnVivo({ editor, respuestas, onPublicado }: {
  editor: Editor;
  /** Cuántas respuestas ya entraron (no cambian al publicar). */
  respuestas: number;
  onPublicado: (def: Definicion) => void;
}) {
  const [confirmar, setConfirmar] = useState<'publicar' | 'descartar' | null>(null);
  const [trabajando, setTrabajando] = useState(false);

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
        <p className="font-semibold">Cambios sin publicar · {resumen.length}</p>
        <p>{porCorregir ? 'Corrige lo marcado en el filtro para poder publicarlos.' : 'Los participantes siguen viendo la versión publicada.'}</p>
      </div>
      <button type="button" className={`${botonSecundario} !text-xs`} disabled={trabajando} onClick={() => setConfirmar('descartar')}>Descartar</button>
      <button type="button" className={`${botonTeal} !px-3 !py-1.5 !text-xs`} disabled={trabajando || porCorregir} onClick={() => setConfirmar('publicar')}>Publicar cambios</button>

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
