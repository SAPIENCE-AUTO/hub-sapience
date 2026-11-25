import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { getSwipeIdeas, getSwipeResultados, setSwipeCapituloEstado } from 'zite-endpoints-sdk';
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, Pause, Play, X } from 'lucide-react';
import { LETRAS_RONDA } from './EleccionRonda';

export interface RondaProyeccion {
  id: string;
  nombre: string;
  descripcion?: string;
  estado: string;
  ideasCount: number;
}

interface OpcionResultado {
  id: string;
  titulo: string;
  descripcion?: string;
  imagenUrl?: string;
  /** Votos de esta imagen: en una ronda cada persona tiene uno solo, así que es el número de personas que la eligieron. */
  votos: number;
}

interface Props {
  sesionNombre: string;
  cliente?: string;
  codigo: string;
  /** Las rondas de la sesión, en su orden: con ← y → el facilitador pasa de una a otra y los celulares cambian con él. */
  rondas: RondaProyeccion[];
  indiceInicial: number;
  onClose: () => void;
}

const FONDO = '#0F3D4C';

/**
 * Pantalla para proyectar una ronda de «elegir entre las imágenes»: las imágenes grandes, cada una con su letra, y debajo
 * de cada una una barra con el porcentaje y el número de personas que la eligieron, que crece sola cada 2 segundos.
 * El facilitador lleva el ritmo: abrir una ronda deja ver las imágenes en los celulares; ← / → cierran la actual y abren
 * la de al lado. Salir (Esc) NO cierra la ronda: los celulares siguen votando hasta que se cierre o se abra otra.
 */
export default function DueloProyeccion({ sesionNombre, cliente, codigo, rondas, indiceInicial, onClose }: Props) {
  const [indice, setIndice] = useState(() => Math.min(Math.max(indiceInicial, 0), Math.max(rondas.length - 1, 0)));
  const [estados, setEstados] = useState<Record<string, string>>(() => Object.fromEntries(rondas.map((r) => [r.id, r.estado])));
  const [base, setBase] = useState<Array<Omit<OpcionResultado, 'votos'>> | null>(null);
  const [votos, setVotos] = useState<Record<string, number>>({});
  const [cambiando, setCambiando] = useState(false);
  const [pantallaCompleta, setPantallaCompleta] = useState(false);

  const ronda = rondas[indice] as RondaProyeccion | undefined;
  const abierta = !!ronda && estados[ronda.id] === 'abierto';
  const puedeVotar = !!ronda && ronda.ideasCount >= 2;

  // Abrir o cerrar una ronda. Al abrir una, el servidor deja «bloqueada» la que estuviera abierta (solo hay una a la vez).
  const poner = async (id: string, estado: 'abierto' | 'cerrado') => {
    await setSwipeCapituloEstado({ capituloId: id, estado });
    setEstados((previo) => Object.fromEntries(Object.entries({ ...previo, [id]: estado }).map(([k, v]) => [k, k !== id && estado === 'abierto' && v === 'abierto' ? 'bloqueado' : v])));
  };

  const irA = async (destino: number) => {
    if (!ronda || cambiando || destino < 0 || destino >= rondas.length || destino === indice) return;
    setCambiando(true);
    try {
      if (estados[ronda.id] === 'abierto') await poner(ronda.id, 'cerrado');
      const siguiente = rondas[destino];
      if (siguiente.ideasCount >= 2) await poner(siguiente.id, 'abierto');
      setIndice(destino);
    } catch (err) {
      toast.error((err as Error)?.message || 'No se pudo cambiar de ronda.');
    }
    setCambiando(false);
  };

  const alternarVotacion = async () => {
    if (!ronda || cambiando || !puedeVotar) return;
    setCambiando(true);
    try {
      await poner(ronda.id, abierta ? 'cerrado' : 'abierto');
    } catch (err) {
      toast.error((err as Error)?.message || 'No se pudo cambiar el estado de la ronda.');
    }
    setCambiando(false);
  };

  const alternarPantallaCompleta = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  };

  // Al proyectar se abre la ronda de entrada: así los celulares ya tienen las imágenes cuando la gente llega.
  useEffect(() => {
    if (!ronda || !puedeVotar || estados[ronda.id] === 'abierto') return;
    setCambiando(true);
    poner(ronda.id, 'abierto')
      .catch((err) => toast.error((err as Error)?.message || 'No se pudo abrir la ronda.'))
      .finally(() => setCambiando(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Las imágenes de la ronda se piden UNA vez, en su orden (el mismo que ve cada celular: A, B, C…), y los votos cada 2
  // segundos. Los resultados vienen ordenados por puntaje, así que NUNCA se usan para ordenar: si no, las imágenes
  // cambiarían de lugar a media ronda cada vez que cambia quién va ganando. Un tropiezo de red no tumba la pantalla:
  // se vuelve a intentar en el siguiente ciclo.
  useEffect(() => {
    if (!ronda) return;
    let vigente = true;
    let imagenesListas = false;
    setBase(null);
    setVotos({});
    const cargar = async () => {
      try {
        if (!imagenesListas) {
          const b = await getSwipeIdeas({ capituloId: ronda.id });
          if (!vigente) return;
          setBase((b.ideas ?? []).map((i: { id: string; titulo: string; descripcion?: string; imagenUrl?: string }) => ({
            id: i.id, titulo: i.titulo, descripcion: i.descripcion, imagenUrl: i.imagenUrl,
          })));
          imagenesListas = true;
        }
        const r = await getSwipeResultados({ capituloId: ronda.id });
        if (!vigente) return;
        setVotos(Object.fromEntries((r.ideas ?? []).map((i: { id: string; potencial: number }) => [i.id, i.potencial])));
      } catch { /* se reintenta en el siguiente ciclo */ }
    };
    void cargar();
    const reloj = setInterval(cargar, 2000);
    return () => { vigente = false; clearInterval(reloj); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ronda?.id]);

  useEffect(() => {
    const alCambiar = () => setPantallaCompleta(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', alCambiar);
    return () => {
      document.removeEventListener('fullscreenchange', alCambiar);
      if (document.fullscreenElement) void document.exitFullscreen();
    };
  }, []);

  // Sin lista de dependencias a propósito: se vuelve a registrar en cada vuelta y siempre ve el estado de ahora.
  // (La barra espaciadora no se usa: sobre un botón con foco dispararía el clic Y el cambio de ronda.)
  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); void irA(indice + 1); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); void irA(indice - 1); }
      else if (e.key === 'Escape') onClose();
      else if (e.key === 'f' || e.key === 'F') alternarPantallaCompleta();
    };
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  });

  if (!ronda) return null;

  const lista: OpcionResultado[] = (base ?? []).map((o) => ({ ...o, votos: votos[o.id] ?? 0 }));
  const total = lista.reduce((suma, o) => suma + o.votos, 0);
  const maximo = lista.reduce((m, o) => Math.max(m, o.votos), 0);
  const unSoloLider = maximo > 0 && lista.filter((o) => o.votos === maximo).length === 1;
  const columnas = Math.max(lista.length, 1);
  const enlace = `${window.location.host}/swipe/${codigo}`;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col text-white" style={{ backgroundColor: FONDO }} role="dialog" aria-label="Proyección de la ronda">
      <header className="flex items-start justify-between gap-8 px-8 pt-6">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold uppercase tracking-[0.16em] text-[#6FC2DA]">
            {cliente || sesionNombre} · {ronda.nombre} · {indice + 1} de {rondas.length}
          </p>
          <h1 className="mt-1 text-balance text-[clamp(1.5rem,3.2vw,3rem)] font-bold leading-tight">{ronda.descripcion || ronda.nombre}</h1>
        </div>
        <div className="flex-shrink-0 text-right">
          <p className="text-[12px] uppercase tracking-[0.14em] text-[#8FB6C0]">Vota desde tu celular</p>
          <p className="font-mono text-[clamp(1rem,1.8vw,1.6rem)] font-semibold">{enlace}</p>
          <p className="mt-1 text-[clamp(1.25rem,2.4vw,2.25rem)] font-bold tabular-nums">
            {total} {total === 1 ? 'voto' : 'votos'}
          </p>
        </div>
      </header>

      {!puedeVotar ? (
        <main className="flex flex-1 items-center justify-center px-8 text-center">
          <p className="max-w-xl text-xl text-[#8FB6C0]">
            Esta ronda necesita al menos 2 imágenes. Sal de la proyección, pégalas en el capítulo «{ronda.nombre}» y vuelve a proyectar.
          </p>
        </main>
      ) : base === null ? (
        <main className="flex flex-1 items-center justify-center text-xl text-[#8FB6C0]">Cargando…</main>
      ) : (
        <main className="grid min-h-0 flex-1 gap-6 px-8 py-5" style={{ gridTemplateColumns: `repeat(${columnas}, minmax(0, 1fr))` }}>
          {lista.map((op, i) => {
            const pct = total > 0 ? (op.votos / total) * 100 : 0;
            const lidera = unSoloLider && op.votos === maximo;
            return (
              <section key={op.id} className="flex min-h-0 flex-col gap-4">
                <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl bg-white">
                  {op.imagenUrl ? (
                    <img src={op.imagenUrl} alt={op.titulo} draggable={false} className="absolute inset-0 h-full w-full object-contain" />
                  ) : (
                    <div className="absolute inset-0 flex flex-col justify-center gap-3 p-8 text-[#0F3D4C]">
                      <p className="text-[clamp(1.5rem,3vw,2.75rem)] font-bold leading-tight">{op.titulo}</p>
                      {op.descripcion && <p className="text-[clamp(1rem,1.6vw,1.5rem)] text-[#4d6a72]">{op.descripcion}</p>}
                    </div>
                  )}
                  <span className="absolute left-3 top-3 flex h-12 w-12 items-center justify-center rounded-full text-[22px] font-bold text-white shadow-md" style={{ backgroundColor: FONDO }}>
                    {LETRAS_RONDA[i] ?? i + 1}
                  </span>
                </div>
                <div>
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="text-[clamp(2.25rem,5.5vw,5rem)] font-bold leading-none tabular-nums">{Math.round(pct)}%</span>
                    <span className="text-[clamp(1rem,1.8vw,1.6rem)] tabular-nums text-[#8FB6C0]">
                      {op.votos} {op.votos === 1 ? 'voto' : 'votos'}
                    </span>
                  </div>
                  <div className="mt-3 h-4 overflow-hidden rounded-full bg-white/15">
                    <div
                      className="h-full rounded-full motion-safe:transition-[width] motion-safe:duration-700 motion-safe:ease-out"
                      style={{ width: `${pct}%`, backgroundColor: lidera ? '#F2B84B' : '#5FA8BD' }}
                    />
                  </div>
                </div>
              </section>
            );
          })}
        </main>
      )}

      <footer className="flex items-center justify-between gap-4 px-8 pb-5 opacity-70 transition-opacity hover:opacity-100 focus-within:opacity-100">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void irA(indice - 1)} disabled={cambiando || indice === 0} className={BOTON} aria-label="Ronda anterior">
            <ChevronLeft className="h-4 w-4" /> Anterior
          </button>
          <button type="button" onClick={() => void irA(indice + 1)} disabled={cambiando || indice >= rondas.length - 1} className={BOTON} aria-label="Ronda siguiente">
            Siguiente <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <p className="hidden text-[12px] text-[#8FB6C0] xl:block">← → cambian de ronda · F pantalla completa · Esc sale (la ronda sigue abierta)</p>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-2 whitespace-nowrap pr-1 text-[13px] font-semibold" role="status">
            <span className={`h-2.5 w-2.5 rounded-full ${abierta ? 'bg-[#6FE3A8] motion-safe:animate-pulse' : 'bg-white/40'}`} />
            {abierta ? 'Votación abierta' : 'Votación cerrada'}
          </span>
          <button type="button" onClick={() => void alternarVotacion()} disabled={cambiando || !puedeVotar} className={BOTON}>
            {abierta ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />} {abierta ? 'Cerrar votación' : 'Abrir votación'}
          </button>
          <button type="button" onClick={alternarPantallaCompleta} className={BOTON} aria-label="Pantalla completa">
            {pantallaCompleta ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
          <button type="button" onClick={onClose} className={BOTON} aria-label="Salir de la proyección">
            <X className="h-4 w-4" /> Salir
          </button>
        </div>
      </footer>
    </div>
  );
}

const BOTON =
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-white/10 px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:enabled:bg-white/20 disabled:opacity-40';
