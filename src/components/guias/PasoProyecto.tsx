import { useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { DURACION_MAX, DURACION_MIN, MAX_BRIEF, NOMBRE_MODO, conMuestra, duracionValida } from '@/lib/guias/texto';
import { TIPOS_SESION } from '@/lib/guias/types';
import type { EstadoGuia, ModoGuia, TipoSesion } from '@/lib/guias/types';
import { useSubirArchivo, ZonaArchivo } from './ZonaArchivo';

type Actualizar = (fn: (s: EstadoGuia) => EstadoGuia) => void;

const MODOS: ModoGuia[] = ['roadmap', 'brief', 'tema'];
const DURACIONES = [60, 90, 120, 150, 180];

function Campo({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">{etiqueta}</p>
      {children}
    </div>
  );
}

/** Opciones de una sola elección, como botones en fila (accesibles como grupo de radios). */
function Opciones<T extends string>({ valor, opciones, onElegir, etiqueta, deshabilitado }: {
  valor: T; opciones: { id: T; texto: string }[]; onElegir: (v: T) => void; etiqueta: string; deshabilitado?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={etiqueta} className="flex flex-wrap gap-2">
      {opciones.map((o) => {
        const activa = o.id === valor;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={activa}
            disabled={deshabilitado}
            onClick={() => onElegir(o.id)}
            className={`rounded-lg border px-3 py-1.5 text-sm transition-colors disabled:opacity-50 ${activa ? 'border-primary bg-primary/5 font-semibold text-primary' : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'}`}
          >
            {o.texto}
          </button>
        );
      })}
    </div>
  );
}

interface Props {
  st: EstadoGuia;
  update: Actualizar;
  onSiguiente: () => void;
}

/** Paso 1: de dónde se parte y los datos del proyecto. */
export default function PasoProyecto({ st, update, onSiguiente }: Props) {
  // La duración se escribe en un borrador: al estado solo llega lo que vale, así lo guardado nunca queda a medias (p. ej. «1» camino a «120»).
  const [duracionTexto, setDuracionTexto] = useState(String(st.duracion));
  const [duracionAjena, setDuracionAjena] = useState(st.duracion);
  if (duracionAjena !== st.duracion) { setDuracionAjena(st.duracion); setDuracionTexto(String(st.duracion)); }
  const duracionOk = duracionValida(Number.parseInt(duracionTexto, 10));

  const cambiarDuracion = (texto: string) => {
    const limpio = texto.replace(/\D/g, '').slice(0, 3);
    setDuracionTexto(limpio);
    const n = Number.parseInt(limpio, 10);
    if (duracionValida(n)) { setDuracionAjena(n); update((s) => ({ ...s, duracion: n })); }
  };
  const elegirDuracion = (n: number) => { setDuracionTexto(String(n)); setDuracionAjena(n); update((s) => ({ ...s, duracion: n })); };

  const fuenteEsBrief = st.modo === 'brief';
  const subida = useSubirArchivo((texto, nombre) => {
    if (st.modo === 'tema') return;
    if (texto.length > MAX_BRIEF) toast.info(`«${nombre}» es más largo: se usaron los primeros ${MAX_BRIEF.toLocaleString('es-MX')} caracteres.`);
    const recortado = texto.slice(0, MAX_BRIEF);
    update((s) => (fuenteEsBrief ? { ...s, briefText: recortado } : { ...s, roadmapText: recortado }));
    toast.success(`Se leyó «${nombre}»`);
  });

  // Soltar un archivo en cualquier parte del paso lo sube; en «solo el tema» no hay a dónde, pero tampoco se deja que el navegador lo abra.
  const arrastre = st.modo === 'tema'
    ? { onDragOver: subida.arrastre.onDragOver, onDrop: (e: React.DragEvent) => { if (!Array.from(e.dataTransfer.types).includes('Files')) return; e.preventDefault(); toast.info('Para subir un archivo, elige «Tengo el roadmap» o «Tengo el brief».'); } }
    : subida.arrastre;

  const textoFuente = fuenteEsBrief ? st.briefText : st.roadmapText;

  return (
    <div className="space-y-5" {...arrastre}>
      <Campo etiqueta="Punto de partida">
        <Opciones<ModoGuia> valor={st.modo} etiqueta="Punto de partida" opciones={MODOS.map((m) => ({ id: m, texto: NOMBRE_MODO[m] }))} onElegir={(modo) => update((s) => ({ ...s, modo }))} />
      </Campo>

      {st.modo === 'tema' ? (
        <Campo etiqueta="Tema">
          <Textarea
            value={st.tema}
            maxLength={4000}
            rows={3}
            aria-label="Tema"
            placeholder="¿Qué quieren entender? Ej.: cómo deciden qué marca de pañales comprar"
            onChange={(e) => update((s) => ({ ...s, tema: e.target.value }))}
          />
        </Campo>
      ) : (
        <Campo etiqueta={fuenteEsBrief ? 'Brief' : 'Roadmap'}>
          <Textarea
            value={textoFuente}
            maxLength={MAX_BRIEF}
            rows={7}
            aria-label={fuenteEsBrief ? 'Texto del brief' : 'Texto del roadmap'}
            placeholder={fuenteEsBrief ? 'Pega aquí el brief' : 'Pega aquí el roadmap: bloques, minutos y objetivos'}
            onChange={(e) => update((s) => (fuenteEsBrief ? { ...s, briefText: e.target.value } : { ...s, roadmapText: e.target.value }))}
          />
          <ZonaArchivo subida={subida} />
        </Campo>
      )}

      <Campo etiqueta="Proyecto">
        <Input value={st.proyecto} maxLength={300} aria-label="Proyecto" placeholder="Marca y estudio" onChange={(e) => update((s) => ({ ...s, proyecto: e.target.value }))} />
      </Campo>

      <Campo etiqueta="Tipo de sesión">
        <Opciones<TipoSesion> valor={st.tipo} etiqueta="Tipo de sesión" opciones={TIPOS_SESION.map((t) => ({ id: t, texto: t }))} onElegir={(tipo) => update((s) => ({ ...s, tipo }))} />
      </Campo>

      <Campo etiqueta="Duración">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            <Input
              inputMode="numeric"
              aria-label="Duración en minutos"
              aria-invalid={!duracionOk}
              className={`h-9 w-20 text-center tabular-nums ${duracionOk ? '' : 'border-destructive focus-visible:ring-destructive'}`}
              value={duracionTexto}
              onChange={(e) => cambiarDuracion(e.target.value)}
              onBlur={() => { if (!duracionOk) setDuracionTexto(String(st.duracion)); }}
            />
            <span className="text-sm text-muted-foreground">min</span>
          </div>
          {DURACIONES.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => elegirDuracion(m)}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${st.duracion === m && duracionOk ? 'border-primary bg-primary/5 font-semibold text-primary' : 'border-border text-muted-foreground hover:bg-muted'}`}
            >
              {m}
            </button>
          ))}
          {!duracionOk && <span className="text-xs text-destructive">Entre {DURACION_MIN} y {DURACION_MAX} min</span>}
        </div>
      </Campo>

      <Campo etiqueta="Muestra">
        <Textarea
          value={st.muestraText}
          maxLength={4000}
          rows={3}
          aria-label="Muestra"
          placeholder="Un perfil por renglón. Ej.: 1 sesión de grupo con mamás de 25 a 35 años, NSE C+, CDMX"
          onChange={(e) => update((s) => conMuestra(s, e.target.value))}
        />
      </Campo>

      <Campo etiqueta="Estímulos">
        <Textarea
          value={st.estimulos}
          maxLength={4000}
          rows={2}
          aria-label="Estímulos"
          placeholder="Empaques, conceptos, comerciales, precios…"
          onChange={(e) => update((s) => ({ ...s, estimulos: e.target.value }))}
        />
      </Campo>

      <Campo etiqueta="Notas">
        <Textarea
          value={st.notas}
          maxLength={4000}
          rows={2}
          aria-label="Notas"
          placeholder="Hipótesis, temas a evitar, marcas a vigilar…"
          onChange={(e) => update((s) => ({ ...s, notas: e.target.value }))}
        />
      </Campo>

      <div className="flex items-center gap-3 pt-1">
        <Button onClick={onSiguiente} disabled={!duracionOk}>Siguiente: Roadmap →</Button>
      </div>
    </div>
  );
}
