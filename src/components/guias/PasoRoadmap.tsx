import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Sparkles, Square, X } from 'lucide-react';
import { adjustGuiaRoadmap, generateGuiaRoadmap } from 'zite-endpoints-sdk';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ALERTA, EXITO, GOLD, TEAL } from '@/lib/toolColors';
import { MAX_BLOQUES, acotarEstado, aplicarRoadmapIA, guiaAlineada, minutosFaltan, perfilesDe, renglones, roadmapListo, roadmapManual } from '@/lib/guias/texto';
import type { RespuestaRoadmap } from '@/lib/guias/texto';
import { minutosRoadmap } from '@/lib/guias/types';
import type { BloqueRoadmap, EstadoGuia } from '@/lib/guias/types';
import { Progreso } from '../propuestas/PasoUi';
import { useLlamadaLarga } from '../propuestas/useLlamadaLarga';
import { Pildora } from './Pildora';

type Actualizar = (fn: (s: EstadoGuia) => EstadoGuia) => void;
type Pedido = 'proponer' | 'ajustar';

const bloquesDe = (s: EstadoGuia): BloqueRoadmap[] => s.roadmap?.bloques ?? [];
const conBloques = (s: EstadoGuia, bloques: BloqueRoadmap[], guia: EstadoGuia['guia']): EstadoGuia => ({
  ...s,
  roadmap: { muestra: s.roadmap?.muestra ?? perfilesDe(s.muestraText), bloques },
  guia,
});

interface Props {
  st: EstadoGuia;
  update: Actualizar;
  /** Avisa al editor cuando la IA está trabajando, para cerrar lo que pisaría el trabajo. */
  onOcupado: (ocupado: boolean) => void;
  onAtras: () => void;
  onSiguiente: () => void;
}

interface Confirmacion { titulo: string; texto: string; boton: string; accion: () => void }

/** Paso 2: los bloques de la sesión, con sus minutos y objetivos. Los arma la persona o los propone (o lee) la IA. */
export default function PasoRoadmap({ st, update, onOcupado, onAtras, onSiguiente }: Props) {
  const llamada = useLlamadaLarga();
  const actual = useRef<{ cancelar: () => void } | null>(null);
  const [ocupado, setOcupado] = useState<Pedido | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pedido, setPedido] = useState('');
  const [confirmar, setConfirmar] = useState<Confirmacion | null>(null);

  const bloques = bloquesDe(st);
  const escritos = st.guia.filter(Boolean).length;
  const total = minutosRoadmap(bloques);
  const falta = minutosFaltan(st);

  useEffect(() => { onOcupado(ocupado !== null); }, [ocupado, onOcupado]);
  // Al salir del paso se corta lo que esté en curso y el editor deja de verse ocupado.
  useEffect(() => () => { actual.current?.cancelar(); onOcupado(false); }, [onOcupado]);

  // Lo que la IA lee o usa para proponer: el roadmap, el brief o el tema, según el punto de partida.
  const fuente = st.modo === 'roadmap' ? st.roadmapText : st.modo === 'brief' ? st.briefText : '';
  const faltaFuente = st.modo === 'tema' ? !st.tema.trim() : !fuente.trim();
  const NOTA_FALTA = { roadmap: 'Pega o sube el roadmap en Proyecto.', brief: 'Pega o sube el brief en Proyecto.', tema: 'Escribe el tema en Proyecto.' }[st.modo];
  const ETIQUETA_IA = { roadmap: 'Leer el roadmap', brief: 'Proponer desde el brief', tema: 'Proponer desde el tema' }[st.modo];

  async function pedirIA(tipo: Pedido) {
    setOcupado(tipo);
    setError(null);
    try {
      const estado = acotarEstado(st);
      const l = tipo === 'proponer'
        ? generateGuiaRoadmap({ estado, ...(fuente.trim() ? { fuente: fuente.slice(0, 200_000) } : {}) })
        : adjustGuiaRoadmap({ estado, pedido: pedido.trim() });
      actual.current = l;
      const res = (await llamada.correr(l)) as RespuestaRoadmap;
      if (!res?.roadmap?.bloques?.length) throw new Error('La IA no devolvió bloques. Vuelve a intentarlo.');
      update((s) => aplicarRoadmapIA(s, res, tipo));
      if (tipo === 'ajustar') setPedido('');
    } catch (e) {
      if ((e as { code?: string }).code !== 'DETENIDO') setError((e as Error).message || 'No se pudo armar el roadmap.');
    } finally {
      actual.current = null;
      setOcupado(null);
    }
  }

  const volverAProponer = () => {
    if (escritos > 0) setConfirmar({ titulo: '¿Reemplazar los bloques?', texto: 'Lo ya escrito de la guía solo se conserva en los bloques que queden igual.', boton: 'Sí, reemplazar', accion: () => void pedirIA('proponer') });
    else void pedirIA('proponer');
  };

  const poner = (i: number, parche: Partial<BloqueRoadmap>) =>
    update((s) => conBloques(s, bloquesDe(s).map((b, j) => (j === i ? { ...b, ...parche } : b)), s.guia));
  const mover = (i: number, dir: -1 | 1) => update((s) => {
    const j = i + dir;
    const lista = [...bloquesDe(s)];
    if (j < 0 || j >= lista.length) return s;
    const guia = guiaAlineada(s);
    [lista[i], lista[j]] = [lista[j], lista[i]];
    [guia[i], guia[j]] = [guia[j], guia[i]];
    return conBloques(s, lista, guia);
  });
  const quitar = (i: number) => {
    const hacer = () => update((s) => conBloques(s, bloquesDe(s).filter((_, j) => j !== i), guiaAlineada(s).filter((_, j) => j !== i)));
    if (st.guia[i]) setConfirmar({ titulo: `¿Quitar el bloque ${i + 1}?`, texto: 'Ya está escrito en la guía; si lo quitas, se borra lo escrito.', boton: 'Sí, quitar', accion: hacer });
    else hacer();
  };
  const agregar = () => update((s) => {
    const lista = bloquesDe(s);
    if (lista.length >= MAX_BLOQUES) return s;
    const minutos = Math.max(5, Math.min(30, s.duracion - minutosRoadmap(lista)));
    return conBloques(s, [...lista, { nombre: '', minutos, objetivos: [] }], [...guiaAlineada(s), null]);
  });

  const ajustar = () => { if (pedido.trim() && !ocupado) void pedirIA('ajustar'); };
  const sinNombre = bloques.some((b) => !b.nombre.trim());

  return (
    <div className="space-y-5">
      {ocupado && (
        <div className="space-y-2">
          <Progreso pasos={llamada.pasos} segundos={llamada.segundos} />
          <Button variant="outline" size="sm" className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/5 hover:text-destructive" onClick={() => actual.current?.cancelar()}>
            <Square className="h-3 w-3" fill="currentColor" /> Detener
          </Button>
        </div>
      )}

      {error && (
        <div role="alert" className="flex items-start justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <span>{error}</span>
          <button type="button" aria-label="Cerrar aviso" className="rounded p-0.5 hover:bg-destructive/10" onClick={() => setError(null)}><X className="h-4 w-4" /></button>
        </div>
      )}

      {bloques.length === 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            disabled={!!ocupado}
            onClick={() => update(roadmapManual)}
            className="rounded-xl border p-4 text-left transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
          >
            <p className="text-sm font-semibold">Los armo yo</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Warm up y un bloque vacío</p>
          </button>
          <button
            type="button"
            disabled={!!ocupado || faltaFuente}
            onClick={() => void pedirIA('proponer')}
            className="rounded-xl border p-4 text-left transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
            style={{ borderColor: `${TEAL}40` }}
          >
            <p className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: TEAL }}>
              <Sparkles className="h-4 w-4" style={{ color: GOLD }} fill={GOLD} strokeWidth={1.5} /> {ETIQUETA_IA}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">{faltaFuente ? NOTA_FALTA : st.modo === 'roadmap' ? 'Sin cambiar el orden' : `Suman ${st.duracion} min`}</p>
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 text-sm" role="status">
            <span>Suman {total} de {st.duracion} min</span>
            {falta === 0 ? <Pildora color={EXITO}>cuadra</Pildora> : <Pildora color={ALERTA}>{falta > 0 ? `faltan ${falta}` : `sobran ${-falta}`}</Pildora>}
          </div>

          {st.supuestos.length > 0 && (
            <div className="rounded-lg border px-3 py-2.5" style={{ borderColor: `${GOLD}90`, backgroundColor: `${GOLD}18` }}>
              <p className="text-xs font-semibold">Supuestos de la IA</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
                {st.supuestos.map((x, i) => <li key={i}>{x}</li>)}
              </ul>
              <button type="button" className="mt-2 text-xs font-medium text-primary hover:underline" onClick={() => update((s) => ({ ...s, supuestos: [] }))}>Ya lo revisé</button>
            </div>
          )}

          <ol className="space-y-3">
            {bloques.map((b, i) => (
              <li key={i} className="flex gap-3 rounded-xl border bg-card p-3">
                <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white" style={{ backgroundColor: TEAL }} aria-hidden="true">{i + 1}</span>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      aria-label={`Nombre del bloque ${i + 1}`}
                      placeholder="Nombre del bloque"
                      value={b.nombre}
                      maxLength={200}
                      className="h-9 min-w-[10rem] flex-1 font-medium"
                      onChange={(e) => poner(i, { nombre: e.target.value })}
                    />
                    <div className="flex items-center gap-1">
                      <Input
                        aria-label={`Minutos del bloque ${i + 1}`}
                        inputMode="numeric"
                        value={b.minutos || ''}
                        className="h-9 w-16 text-center tabular-nums"
                        onChange={(e) => poner(i, { minutos: Math.min(600, Number.parseInt(e.target.value.replace(/\D/g, '') || '0', 10)) })}
                      />
                      <span className="text-xs text-muted-foreground">min</span>
                    </div>
                  </div>
                  {b.minutos % 5 !== 0 && <p className="text-xs" style={{ color: '#8a4b00' }}>Mejor en múltiplos de 5</p>}
                  <Textarea
                    aria-label={`Objetivos del bloque ${i + 1}`}
                    placeholder="Objetivos, uno por renglón"
                    rows={Math.min(6, Math.max(2, b.objetivos.length))}
                    value={b.objetivos.join('\n')}
                    onChange={(e) => poner(i, { objetivos: renglones(e.target.value, 15, 500) })}
                  />
                  {st.guia[i] && <p className="text-xs text-muted-foreground">Ya está escrito en la guía</p>}
                </div>
                <div className="flex flex-col gap-0.5">
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label={`Subir el bloque ${i + 1}`} disabled={i === 0 || !!ocupado} onClick={() => mover(i, -1)}><ArrowUp className="h-4 w-4" /></Button>
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label={`Bajar el bloque ${i + 1}`} disabled={i === bloques.length - 1 || !!ocupado} onClick={() => mover(i, 1)}><ArrowDown className="h-4 w-4" /></Button>
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" aria-label={`Quitar el bloque ${i + 1}`} disabled={!!ocupado} onClick={() => quitar(i)}><X className="h-4 w-4" /></Button>
                </div>
              </li>
            ))}
          </ol>

          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={agregar} disabled={bloques.length >= MAX_BLOQUES || !!ocupado}><Plus className="h-4 w-4" /> Agregar bloque</Button>

          <div className="space-y-1.5 border-t pt-4">
            <label htmlFor="guia-pedido" className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">Pedir un ajuste</label>
            <div className="flex gap-2">
              <Input
                id="guia-pedido"
                value={pedido}
                maxLength={2000}
                disabled={!!ocupado}
                placeholder="Ej.: junta los dos últimos bloques, dale más tiempo a empaques"
                onChange={(e) => setPedido(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); ajustar(); } }}
              />
              <Button type="button" variant="outline" onClick={ajustar} disabled={!pedido.trim() || !!ocupado}>Ajustar</Button>
            </div>
            <button type="button" className="text-xs font-medium text-primary hover:underline disabled:pointer-events-none disabled:opacity-50" onClick={volverAProponer} disabled={!!ocupado || faltaFuente} title={faltaFuente ? NOTA_FALTA : undefined}>
              {st.modo === 'roadmap' ? 'Volver a leer el roadmap' : 'Volver a proponer los bloques'}
            </button>
          </div>
        </>
      )}

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <Button type="button" variant="ghost" onClick={onAtras} disabled={!!ocupado}>← Proyecto</Button>
        <Button type="button" onClick={onSiguiente} disabled={!roadmapListo(st) || !!ocupado}>Siguiente: Guía →</Button>
        {bloques.length > 0 && sinNombre && <span className="text-xs text-muted-foreground">Ponle nombre a cada bloque</span>}
      </div>

      <AlertDialog open={confirmar !== null} onOpenChange={(abierto) => { if (!abierto) setConfirmar(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmar?.titulo}</AlertDialogTitle>
            <AlertDialogDescription>{confirmar?.texto}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { confirmar?.accion(); setConfirmar(null); }}>{confirmar?.boton}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
