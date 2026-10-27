import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { getGuia, getGuiaWord, saveGuia } from 'zite-endpoints-sdk';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { EXITO } from '@/lib/toolColors';
import { acotarEstado, base64ABlob, descargarArchivo, guiaTexto, leerEstado, roadmapListo } from '@/lib/guias/texto';
import type { EstadoGuia } from '@/lib/guias/types';
import PasoGuia from './PasoGuia';
import PasoProyecto from './PasoProyecto';
import PasoRoadmap from './PasoRoadmap';
import { useEscribirGuia } from './useEscribirGuia';

type Paso = EstadoGuia['paso'];
type Guardado = { estado: 'guardado' | 'pendiente' | 'guardando' | 'error' | 'conflicto'; mensaje?: string };
type Carga = 'cargando' | 'lista' | { error: string; status: number | null };

const PASOS: { id: Paso; etiqueta: string }[] = [
  { id: 'proyecto', etiqueta: 'Proyecto' },
  { id: 'roadmap', etiqueta: 'Roadmap' },
  { id: 'guia', etiqueta: 'Guía' },
];

function IndicadorGuardado({ g }: { g: Guardado }) {
  const texto = { guardado: 'Guardado', pendiente: 'Cambios sin guardar…', guardando: 'Guardando…', error: 'No se pudo guardar', conflicto: 'Otra persona la cambió' }[g.estado];
  const malo = g.estado === 'error' || g.estado === 'conflicto';
  return (
    <span role="status" className={`flex flex-shrink-0 items-center gap-1.5 text-xs ${malo ? 'font-medium text-destructive' : 'text-muted-foreground'}`}>
      {g.estado === 'guardando' ? <Loader2 className="h-3 w-3 animate-spin" /> : g.estado === 'guardado' ? <Check className="h-3 w-3" style={{ color: EXITO }} /> : malo ? <AlertTriangle className="h-3 w-3" /> : <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />}
      {texto}
    </span>
  );
}

/**
 * El editor de una guía: nombre, tres pasos (Proyecto, Roadmap, Guía) y guardado automático. Se guarda solo, un segundo después del último cambio y una escritura a la vez;
 * la versión evita que dos personas se pisen (si el servidor contesta con conflicto no se reintenta: hay que recargar).
 */
export default function GuiaEditor({ id, onSalir }: { id: string; onSalir: () => void }) {
  const [carga, setCarga] = useState<Carga>('cargando');
  const [titulo, setTitulo] = useState('');
  const [st, setSt] = useState<EstadoGuia | null>(null);
  const [guardado, setGuardado] = useState<Guardado>({ estado: 'guardado' });
  const [roadmapOcupado, setRoadmapOcupado] = useState(false);
  const [confirmarDescarga, setConfirmarDescarga] = useState(false);
  const [confirmarSalir, setConfirmarSalir] = useState(false);
  const [descargando, setDescargando] = useState(false);
  const [vuelta, setVuelta] = useState(0);

  // Lo último que se editó es la fuente de verdad para guardar y para la IA (no el estado de React, que llega un render después).
  const ultimo = useRef<{ titulo: string; st: EstadoGuia | null }>({ titulo: '', st: null });
  const version = useRef(0);
  const seq = useRef(0);
  const seqGuardada = useRef(0);
  const cadena = useRef<Promise<void>>(Promise.resolve());
  const temporizador = useRef<number | null>(null);
  const conflicto = useRef(false);

  useEffect(() => {
    let vivo = true;
    setCarga('cargando');
    getGuia({ id })
      .then((g: { titulo: string; estado: unknown; version: number }) => {
        if (!vivo) return;
        const estado = leerEstado(g.estado);
        ultimo.current = { titulo: g.titulo, st: estado };
        version.current = g.version;
        seq.current = 0;
        seqGuardada.current = 0;
        conflicto.current = false;
        setTitulo(g.titulo);
        setSt(estado);
        setGuardado({ estado: 'guardado' });
        setCarga('lista');
      })
      .catch((e: { message?: string; status?: number }) => { if (vivo) setCarga({ error: e.message || 'No se pudo abrir la guía.', status: e.status ?? null }); });
    return () => { vivo = false; };
  }, [id, vuelta]);

  const persistir = useCallback(() => {
    cadena.current = cadena.current.then(async () => {
      if (conflicto.current || seqGuardada.current === seq.current || !ultimo.current.st) return;
      const mia = seq.current;
      setGuardado({ estado: 'guardando' });
      try {
        const r = await saveGuia({ id, titulo: ultimo.current.titulo.trim() || 'Guía sin nombre', estado: acotarEstado(ultimo.current.st), version: version.current });
        version.current = r.version;
        seqGuardada.current = mia;
        setGuardado({ estado: seqGuardada.current === seq.current ? 'guardado' : 'pendiente' });
      } catch (e) {
        const err = e as { message?: string; status?: number; code?: string };
        if (err.status === 409 || err.code === 'CONFLICT') { conflicto.current = true; setGuardado({ estado: 'conflicto', mensaje: err.message }); }
        else setGuardado({ estado: 'error', mensaje: err.message || 'No se pudo guardar.' });
      }
    });
    return cadena.current;
  }, [id]);

  const tocado = useCallback(() => {
    seq.current++;
    setGuardado((g) => (g.estado === 'conflicto' ? g : { estado: 'pendiente' }));
    if (temporizador.current) window.clearTimeout(temporizador.current);
    temporizador.current = window.setTimeout(() => { temporizador.current = null; void persistir(); }, 900);
  }, [persistir]);

  const actualizar = useCallback((fn: (s: EstadoGuia) => EstadoGuia) => {
    const actual = ultimo.current.st;
    if (!actual) return;
    const siguiente = fn(actual);
    if (siguiente === actual) return;
    ultimo.current = { ...ultimo.current, st: siguiente };
    setSt(siguiente);
    tocado();
  }, [tocado]);

  /** Guarda ya lo pendiente; dice si quedó todo guardado. */
  const vaciar = useCallback(async (): Promise<boolean> => {
    if (temporizador.current) { window.clearTimeout(temporizador.current); temporizador.current = null; }
    await persistir();
    return !conflicto.current && seqGuardada.current === seq.current;
  }, [persistir]);

  // Avisa antes de cerrar la pestaña con cambios sin guardar, y guarda lo pendiente al salir del editor dentro del Hub.
  useEffect(() => {
    const alSalir = (e: BeforeUnloadEvent) => { if (seqGuardada.current !== seq.current) e.preventDefault(); };
    window.addEventListener('beforeunload', alSalir);
    return () => window.removeEventListener('beforeunload', alSalir);
  }, []);
  useEffect(() => () => { if (temporizador.current) { window.clearTimeout(temporizador.current); temporizador.current = null; void persistir(); } }, [persistir]);

  const leerUltimo = useCallback(() => ultimo.current.st, []);
  const escritor = useEscribirGuia(leerUltimo, actualizar);
  const ocupado = roadmapOcupado || escritor.escribiendo;

  const salir = async () => {
    if (await vaciar()) onSalir();
    else setConfirmarSalir(true);
  };

  async function descargar() {
    setConfirmarDescarga(false);
    setDescargando(true);
    try {
      if (!(await vaciar())) { toast.error('Primero hay que guardar los cambios.'); return; }
      const r = await getGuiaWord({ id });
      descargarArchivo(base64ABlob(r.base64), r.nombre);
    } catch (e) {
      toast.error((e as Error).message || 'No se pudo armar el Word.');
    } finally {
      setDescargando(false);
    }
  }
  const pedirDescarga = () => {
    const sinEscribir = ultimo.current.st ? (ultimo.current.st.roadmap?.bloques ?? []).filter((_, i) => !ultimo.current.st?.guia[i]).length : 0;
    if (sinEscribir > 0) setConfirmarDescarga(true);
    else void descargar();
  };
  async function copiar() {
    await vaciar();
    if (!ultimo.current.st) return;
    try {
      await navigator.clipboard.writeText(guiaTexto(ultimo.current.titulo, ultimo.current.st));
      toast.success('Texto copiado');
    } catch {
      toast.error('No se pudo copiar. Descarga el Word y copia desde ahí.');
    }
  }

  if (carga === 'cargando' || (carga === 'lista' && !st)) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-3 px-6 py-5">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (typeof carga === 'object' || !st) {
    const falla = typeof carga === 'object' ? carga : { error: 'No se pudo abrir la guía.', status: null };
    return (
      <div className="mx-auto w-full max-w-4xl space-y-4 px-6 py-5">
        <Button variant="ghost" size="sm" className="-ml-2 gap-1.5" onClick={onSalir}><ArrowLeft className="h-4 w-4" /> Guías</Button>
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {falla.status === 404 ? 'No se encontró la guía. Puede que la hayan borrado.' : falla.error}
          {falla.status !== 404 && <Button variant="outline" size="sm" className="ml-3" onClick={() => setVuelta((v) => v + 1)}>Reintentar</Button>}
        </div>
      </div>
    );
  }

  // Una guía guardada en «Guía» sin roadmap listo vuelve a «Roadmap».
  const paso: Paso = st.paso === 'guia' && !roadmapListo(st) ? 'roadmap' : st.paso;
  const habilitado: Record<Paso, boolean> = { proyecto: true, roadmap: true, guia: roadmapListo(st) };
  const ir = (p: Paso) => actualizar((s) => ({ ...s, paso: p }));
  const indicePaso = PASOS.findIndex((p) => p.id === paso);

  return (
    <div className="mx-auto w-full max-w-4xl">
      <div className="z-10 space-y-3 border-b bg-background/95 px-4 pb-3 pt-4 backdrop-blur sm:sticky sm:top-0 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" className="-ml-2 gap-1.5" onClick={() => void salir()} disabled={ocupado}><ArrowLeft className="h-4 w-4" /> Guías</Button>
          <Input
            aria-label="Nombre de la guía"
            value={titulo}
            maxLength={200}
            className="h-8 min-w-[12rem] flex-1 text-sm font-semibold"
            onChange={(e) => { setTitulo(e.target.value); ultimo.current = { ...ultimo.current, titulo: e.target.value }; tocado(); }}
          />
          <IndicadorGuardado g={guardado} />
        </div>

        <ol className="grid grid-cols-3 gap-2" aria-label="Pasos">
          {PASOS.map((p, i) => {
            const activo = p.id === paso;
            const hecho = i < indicePaso;
            const puede = habilitado[p.id] && !ocupado;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  disabled={!puede}
                  aria-current={activo ? 'step' : undefined}
                  onClick={() => ir(p.id)}
                  className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors ${activo ? 'border-primary bg-primary/5 font-semibold' : 'border-border'} ${puede ? 'hover:bg-muted' : 'cursor-not-allowed opacity-50'}`}
                >
                  <span className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${activo ? 'bg-primary text-primary-foreground' : hecho ? 'bg-emerald-600 text-white' : 'bg-muted text-muted-foreground'}`}>
                    {hecho ? <Check className="h-3 w-3" /> : i + 1}
                  </span>
                  {p.etiqueta}
                </button>
              </li>
            );
          })}
        </ol>

        {guardado.estado === 'conflicto' && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <span>Otra persona guardó cambios en esta guía. Recarga para ver la última versión; lo que escribiste desde entonces se pierde.</span>
            <Button size="sm" variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setVuelta((v) => v + 1)}>Recargar</Button>
          </div>
        )}
        {guardado.estado === 'error' && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <span>{guardado.mensaje}</span>
            <Button size="sm" variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => { seq.current++; void persistir(); }}>Reintentar</Button>
          </div>
        )}
      </div>

      <div className="px-4 py-5 sm:px-6">
        {paso === 'proyecto' && <PasoProyecto st={st} update={actualizar} onSiguiente={() => ir('roadmap')} />}
        {paso === 'roadmap' && <PasoRoadmap st={st} update={actualizar} onOcupado={setRoadmapOcupado} onAtras={() => ir('proyecto')} onSiguiente={() => ir('guia')} />}
        {paso === 'guia' && <PasoGuia st={st} update={actualizar} escritor={escritor} onAtras={() => ir('roadmap')} onDescargar={pedirDescarga} onCopiar={() => void copiar()} descargando={descargando} />}
      </div>

      <AlertDialog open={confirmarDescarga} onOpenChange={setConfirmarDescarga}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hay bloques sin escribir</AlertDialogTitle>
            <AlertDialogDescription>Salen en el Word como «(Bloque por escribir)». Puedes escribirlos y volver a descargar.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void descargar()}>Descargar así</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmarSalir} onOpenChange={setConfirmarSalir}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hay cambios sin guardar</AlertDialogTitle>
            <AlertDialogDescription>No se pudieron guardar. Si sales ahora, se pierden.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Quedarme</AlertDialogCancel>
            <AlertDialogAction onClick={onSalir}>Salir sin guardar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
