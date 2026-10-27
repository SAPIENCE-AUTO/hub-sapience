import { useRef, useState } from 'react';
import { Loader2, Square, X } from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TEAL } from '@/lib/toolColors';
import type { BloqueGuia, EstadoGuia, Pregunta, SeccionGuia } from '@/lib/guias/types';
import TextoEditable from './TextoEditable';
import type { EscritorGuia } from './useEscribirGuia';

type Actualizar = (fn: (s: EstadoGuia) => EstadoGuia) => void;

/** Un bloque escrito, con cada texto corregible con un clic (vacío = se quita). */
function CuerpoBloque({ g, onCambio }: { g: BloqueGuia; onCambio: (g: BloqueGuia) => void }) {
  // La pregunta recién agregada nace abierta para escribirla; si se deja vacía, se quita.
  const [nueva, setNueva] = useState<{ s: number; q: number } | null>(null);

  const ponerSeccion = (si: number, fn: (s: SeccionGuia) => SeccionGuia) =>
    onCambio({ ...g, secciones: g.secciones.map((s, j) => (j === si ? fn(s) : s)) });
  const ponerPregunta = (si: number, qi: number, q: Pregunta | null) => {
    if (nueva?.s === si && nueva.q === qi) setNueva(null);
    ponerSeccion(si, (s) => ({ ...s, preguntas: q === null ? s.preguntas.filter((_, k) => k !== qi) : s.preguntas.map((x, k) => (k === qi ? q : x)) }));
  };

  return (
    <div className="space-y-4 px-4 py-3 text-sm">
      <p>
        <span className="font-semibold">Moderador: </span>
        <TextoEditable etiqueta="Frase del moderador" rico={false} className="italic" maxLength={3000} placeholder="Frase de transición del moderador" valor={g.moderador} onCambio={(v) => onCambio({ ...g, moderador: v })} />
      </p>
      {g.secciones.map((s, si) => (
        <div key={si} className="space-y-1.5">
          <p className="font-semibold">
            <TextoEditable
              etiqueta="Subtema"
              rico={false}
              maxLength={300}
              placeholder="Subtema"
              valor={s.subtema}
              onCambio={(v) => (v || s.preguntas.length ? ponerSeccion(si, (x) => ({ ...x, subtema: v })) : onCambio({ ...g, secciones: g.secciones.filter((_, j) => j !== si) }))}
            />
          </p>
          {s.intro ? (
            <p className="italic">
              <TextoEditable etiqueta="Indicación del subtema" valor={s.intro} onCambio={(v) => ponerSeccion(si, (x) => ({ ...x, intro: v }))} />
            </p>
          ) : null}
          <ul className="list-disc space-y-1.5 pl-5">
            {s.preguntas.map((q, qi) => (
              <li key={qi}>
                <TextoEditable
                  etiqueta="Pregunta"
                  placeholder="Nueva pregunta"
                  empezarEditando={nueva?.s === si && nueva.q === qi}
                  valor={typeof q === 'string' ? q : q.texto}
                  onCambio={(v) => ponerPregunta(si, qi, v ? (typeof q === 'string' ? v : { ...q, texto: v }) : null)}
                />
                {typeof q !== 'string' && q.sub.length > 0 && (
                  <ul className="mt-1 list-[circle] space-y-0.5 pl-5">
                    {q.sub.map((sb, k) => (
                      <li key={k}>
                        <TextoEditable
                          etiqueta="Opción"
                          valor={sb}
                          maxLength={500}
                          onCambio={(v) => ponerPregunta(si, qi, { ...q, sub: v ? q.sub.map((x, m) => (m === k ? v : x)) : q.sub.filter((_, m) => m !== k) })}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="text-xs font-medium text-primary hover:underline"
            onClick={() => { setNueva({ s: si, q: s.preguntas.length }); ponerSeccion(si, (x) => ({ ...x, preguntas: [...x.preguntas, ''] })); }}
          >
            + pregunta
          </button>
          {s.notas.map((n, ni) => (
            <p key={ni} className="text-muted-foreground">
              <span className="font-semibold italic">Nota: </span>
              <TextoEditable
                etiqueta="Nota al moderador"
                rico={false}
                valor={n}
                onCambio={(v) => ponerSeccion(si, (x) => ({ ...x, notas: v ? x.notas.map((y, k) => (k === ni ? v : y)) : x.notas.filter((_, k) => k !== ni) }))}
              />
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}

interface Props {
  st: EstadoGuia;
  update: Actualizar;
  escritor: EscritorGuia;
  onAtras: () => void;
  onDescargar: () => void;
  onCopiar: () => void;
  descargando: boolean;
}

/** Paso 3: la guía escrita, bloque por bloque. */
export default function PasoGuia({ st, update, escritor, onAtras, onDescargar, onCopiar, descargando }: Props) {
  const [rehacer, setRehacer] = useState<{ i: number; texto: string } | null>(null);
  const [confirmarTodo, setConfirmarTodo] = useState(false);
  // El último comentario pedido en cada bloque, para poder reintentar un «Rehacer» que falló.
  const comentarios = useRef<Record<number, string>>({});

  const bloques = st.roadmap?.bloques ?? [];
  const pendientes = bloques.map((_, i) => i).filter((i) => !st.guia[i]);
  const escritos = bloques.length - pendientes.length;
  const { estados, escribiendo } = escritor;

  const pedirRehacer = (i: number) => {
    if (!rehacer || !rehacer.texto.trim()) return;
    comentarios.current[i] = rehacer.texto.trim();
    void escritor.rehacer(i, st.guia[i] ?? null, rehacer.texto.trim());
    setRehacer(null);
  };
  const reintentar = (i: number) => {
    const comentario = comentarios.current[i];
    if (st.guia[i] && comentario) void escritor.rehacer(i, st.guia[i], comentario);
    else void escritor.escribirSolo(i);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground" role="status">{escritos} de {bloques.length} bloques escritos</p>
          {escritos > 0 && <p className="text-xs text-muted-foreground">Clic en un texto para corregirlo. Vacío, se quita.</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {escribiendo ? (
            <Button variant="outline" size="sm" className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/5 hover:text-destructive" onClick={escritor.detener}>
              <Square className="h-3 w-3" fill="currentColor" /> Detener
            </Button>
          ) : pendientes.length > 0 ? (
            <Button onClick={() => void escritor.escribirVarios(pendientes)}>{escritos === 0 ? 'Escribir la guía' : pendientes.length === 1 ? 'Escribir el que falta' : `Escribir los ${pendientes.length} que faltan`}</Button>
          ) : null}
          {escritos > 0 && <Button variant="ghost" size="sm" onClick={() => setConfirmarTodo(true)} disabled={escribiendo}>Reescribir toda</Button>}
          <Button variant="outline" size="sm" onClick={onCopiar} disabled={escribiendo}>Copiar texto</Button>
          <Button variant="outline" size="sm" onClick={onDescargar} disabled={escribiendo || descargando}>
            {descargando && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}Descargar Word
          </Button>
        </div>
      </div>

      {bloques.map((b, i) => {
        const g = st.guia[i];
        const estado = estados[i];
        const ocupadoEste = estado === 'escribiendo' || estado === 'cola';
        const error = typeof estado === 'object' ? estado.error : null;
        return (
          <article key={i} className="overflow-hidden rounded-xl border bg-card">
            <header className="flex items-center gap-3 px-4 py-2 text-white" style={{ backgroundColor: TEAL }}>
              <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">
                {i + 1}. {b.nombre} <span className="ml-1 text-xs font-normal opacity-80">({b.minutos} min.)</span>
              </h3>
              {g && !ocupadoEste && (
                <button type="button" className="text-xs font-medium underline-offset-2 hover:underline" onClick={() => setRehacer(rehacer?.i === i ? null : { i, texto: '' })}>
                  Rehacer
                </button>
              )}
            </header>

            {rehacer?.i === i && (
              <div className="flex flex-wrap gap-2 border-b bg-muted/30 px-4 py-2.5">
                <Input
                  autoFocus
                  className="min-w-[14rem] flex-1 bg-background"
                  aria-label={`Qué cambiar en el bloque ${i + 1}`}
                  placeholder="¿Qué cambio quieres? Ej.: más preguntas sobre precio, menos sobre empaque"
                  value={rehacer.texto}
                  maxLength={2000}
                  onChange={(e) => setRehacer({ i, texto: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); pedirRehacer(i); }
                    if (e.key === 'Escape') setRehacer(null);
                  }}
                />
                <Button size="sm" disabled={!rehacer.texto.trim()} onClick={() => pedirRehacer(i)}>Rehacer bloque</Button>
              </div>
            )}

            {error && (
              <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-destructive/20 bg-destructive/5 px-4 py-2 text-sm text-destructive">
                <span className="min-w-0 flex-1">{error}</span>
                <Button size="sm" variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => reintentar(i)}>Reintentar</Button>
                {g && <button type="button" aria-label="Cerrar aviso" className="rounded p-0.5 hover:bg-destructive/10" onClick={() => escritor.descartar(i)}><X className="h-4 w-4" /></button>}
              </div>
            )}

            {ocupadoEste ? (
              <p className="flex items-center gap-2 px-4 py-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> {estado === 'cola' ? 'En cola…' : 'Escribiendo…'}
              </p>
            ) : g ? (
              <CuerpoBloque g={g} onCambio={(nuevo) => update((s) => ({ ...s, guia: (s.roadmap?.bloques ?? []).map((_, j) => (j === i ? nuevo : s.guia[j] ?? null)) }))} />
            ) : (
              <div className="space-y-2 px-4 py-3">
                <p className="text-sm text-muted-foreground">{b.objetivos.filter((o) => o.trim()).join(' · ') || 'Sin objetivos'}</p>
                {!error && <Button size="sm" variant="outline" onClick={() => void escritor.escribirSolo(i)} disabled={escribiendo}>Escribir este bloque</Button>}
              </div>
            )}
          </article>
        );
      })}

      <div className="pt-1">
        <Button variant="ghost" onClick={onAtras} disabled={escribiendo}>← Roadmap</Button>
      </div>

      <AlertDialog open={confirmarTodo} onOpenChange={setConfirmarTodo}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Reescribir toda la guía?</AlertDialogTitle>
            <AlertDialogDescription>Se vuelve a escribir cada bloque y se pierden las correcciones que hayas hecho.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void escritor.escribirVarios(bloques.map((_, i) => i))}>Sí, reescribir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
