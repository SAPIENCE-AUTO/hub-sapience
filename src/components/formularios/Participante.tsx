import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { pantallas, terminacion, validarPantalla, type Pantalla } from '@/lib/formularios/motor';
import type { Definicion, Respuestas, Valor } from '@/lib/formularios/tipos';
import { CampoPregunta } from './CampoPregunta';
import { EnlaceAviso } from './AvisoPrivacidad';
import { TextoConFormato } from './TextoConFormato';

type Fase = 'bienvenida' | 'preguntas' | 'enviando' | 'gracias' | 'nocalifica';

export interface Borrador { respuestas: Respuestas; pantallaId?: string; inicio: number }

/** Deja solo lo que contestó en preguntas que siguen visibles (si regresó y cambió algo, lo demás sobra). */
export function soloVisibles(def: Definicion, resp: Respuestas): Respuestas {
  const limpio: Respuestas = {};
  for (const pantalla of pantallas(def, resp)) {
    for (const pv of pantalla.preguntas) {
      if (resp[pv.clave] !== undefined) limpio[pv.clave] = resp[pv.clave];
      if (resp[`${pv.clave}#otra`] !== undefined) limpio[`${pv.clave}#otra`] = resp[`${pv.clave}#otra`];
    }
  }
  return limpio;
}

interface Props {
  def: Definicion;
  prueba: boolean;
  /** Código del enlace: con él se suben las fotos. */
  codigo: string;
  /** Semilla del orden aleatorio: la misma persona ve siempre el mismo orden. */
  semilla: string;
  /**
   * `pagina`: la página pública, a pantalla completa. `marco`: dentro de la
   * vista Celular del editor, que tiene su propio alto y su propio scroll; ahí
   * las fotos no se suben.
   */
  modo?: 'pagina' | 'marco';
  /** Lo que ya llevaba contestado (la página lo guarda en el celular). */
  inicial?: Borrador | null;
  onAvance?: (b: Borrador) => void;
  /** Manda lo contestado. Si falla, el error se muestra y se puede reintentar. */
  onEnviar: (respuestas: Respuestas, duracionSeg: number) => Promise<void>;
  onOtraVez?: () => void;
}

/**
 * El formulario que contesta el participante: bienvenida, una pantalla por
 * sección (o por cada repetición de un bloque) y la despedida. Lo usan la
 * página pública /f/:codigo y la vista Celular del editor, así lo que se
 * prueba en el editor es lo mismo que verá la gente.
 */
export function Participante({ def, prueba, codigo, semilla, modo = 'pagina', inicial, onAvance, onEnviar, onOtraVez }: Props) {
  const [fase, setFase] = useState<Fase>(inicial?.pantallaId ? 'preguntas' : 'bienvenida');
  const [resp, setResp] = useState<Respuestas>(inicial?.respuestas ?? {});
  const [actualId, setActualId] = useState<string | undefined>(inicial?.pantallaId);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [falla, setFalla] = useState('');
  const inicio = useRef(inicial?.inicio ?? Date.now());
  const scroll = useRef<HTMLDivElement>(null);
  const enMarco = modo === 'marco';

  const lista = useMemo(() => pantallas(def, resp, semilla), [def, resp, semilla]);
  const indice = Math.max(0, lista.findIndex((p) => p.id === actualId));
  const pantalla = lista[indice];

  useEffect(() => {
    if (fase === 'preguntas') onAvance?.({ respuestas: resp, pantallaId: pantalla?.id, inicio: inicio.current });
  }, [fase, resp, pantalla?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const arriba = () => (enMarco ? scroll.current?.scrollTo({ top: 0 }) : window.scrollTo({ top: 0 }));

  const cambiar = (clave: string, valor: Valor | undefined) => {
    setResp((r) => {
      const n = { ...r };
      if (valor === undefined) delete n[clave]; else n[clave] = valor;
      return n;
    });
    setErrores((e) => { const n = { ...e }; delete n[clave]; delete n[clave.split('#')[0]]; return n; });
  };

  const enviar = async (final: 'gracias' | 'nocalifica') => {
    setFase('enviando');
    setFalla('');
    try {
      await onEnviar(soloVisibles(def, resp), Math.round((Date.now() - inicio.current) / 1000));
      setFase(final);
    } catch (err) {
      setFalla((err as Error).message || 'No se pudo enviar. Revisa tu conexión e intenta otra vez.');
      setFase('preguntas');
    }
  };

  const siguiente = () => {
    if (!pantalla) return;
    const e = validarPantalla(pantalla, resp, def.pais);
    setErrores(e);
    if (Object.keys(e).length) return;
    if (terminacion(def, resp, lista)) return enviar('nocalifica');
    const sig = lista[indice + 1];
    if (!sig) return enviar('gracias');
    setActualId(sig.id);
    arriba();
  };

  const atras = () => {
    if (indice === 0) return setFase('bienvenida');
    setActualId(lista[indice - 1].id);
    setErrores({});
    arriba();
  };

  const otraVez = () => {
    setResp({});
    setActualId(undefined);
    inicio.current = Date.now();
    setFase('bienvenida');
    onOtraVez?.();
  };

  const marco = (children: React.ReactNode, progreso?: number) => (
    <Marco prueba={prueba} progreso={progreso} enMarco={enMarco} scroll={scroll}>{children}</Marco>
  );

  if (fase === 'gracias' || fase === 'nocalifica') {
    return marco(<Despedida texto={fase === 'gracias' ? def.despedida : def.noCalifica} onOtraVez={prueba ? otraVez : undefined} />);
  }

  if (fase === 'bienvenida') {
    return marco(<Bienvenida def={def} continuar={!!actualId} onEmpezar={() => { setActualId(actualId ?? lista[0]?.id); setFase('preguntas'); }} />);
  }

  const progreso = lista.length ? Math.round(((indice + 1) / lista.length) * 100) : 0;
  return marco(
    <>
      <CuerpoPantalla pantalla={pantalla} enMarco={enMarco}>
        {pantalla?.preguntas.map((pv) => (
          <CampoPregunta key={pv.clave} pv={pv} resp={resp} error={errores[pv.clave]} codigo={codigo} pais={def.pais} simular={enMarco} onChange={cambiar} />
        ))}
        {falla && <p className="mt-6 rounded-xl bg-[#FBEAEA] px-4 py-3 text-[14px] text-[#C2272D]">{falla}</p>}
      </CuerpoPantalla>
      <BarraPantalla enMarco={enMarco} enviando={fase === 'enviando'} ultima={indice === lista.length - 1} onAtras={atras} onSiguiente={siguiente} />
    </>,
    progreso,
  );
}

// Las piezas de cada pantalla, también para la vista previa junto al documento del editor (MuestraCelular).

export function Bienvenida({ def, continuar, onEmpezar }: { def: Definicion; continuar?: boolean; onEmpezar?: () => void }) {
  return (
    <div className="flex flex-1 flex-col justify-center px-6 py-10">
      <h1 className="text-[26px] font-bold leading-tight text-[#1F1F23]">{def.tituloPublico}</h1>
      <p className="mt-4 text-[16px] leading-relaxed text-[#45454D]"><TextoConFormato texto={def.bienvenida} /></p>
      <button onClick={onEmpezar} className="mt-10 w-full rounded-xl bg-[#1F1F23] py-4 text-[16px] font-semibold text-white">
        {continuar ? 'Continuar' : 'Empezar'}
      </button>
      <EnlaceAviso className="mx-auto mt-5 block !text-[13px] !font-normal text-[#62626B]" texto="Aviso de privacidad" />
    </div>
  );
}

export function Despedida({ texto, onOtraVez }: { texto: string; onOtraVez?: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <p className="max-w-sm text-[17px] leading-relaxed text-[#1F1F23]"><TextoConFormato texto={texto} /></p>
      {onOtraVez && (
        <button onClick={onOtraVez} className="mt-8 rounded-full border-[1.5px] border-[#1F1F23] px-6 py-2.5 text-[14px] font-semibold text-[#1F1F23]">
          Contestar otra vez (prueba)
        </button>
      )}
    </div>
  );
}

/**
 * Título y texto de entrada de la sección, y sus preguntas (`children`). En un
 * bloque que se repite por cada opción marcada («Tu aerosol»), la imagen de
 * esa opción va junto al título, como referencia de qué se está preguntando.
 */
export function CuerpoPantalla({ pantalla, enMarco, children }: { pantalla?: Pantalla; enMarco: boolean; children: React.ReactNode }) {
  const imagen = pantalla?.instancia?.imagen;
  return (
    <div className={`flex-1 px-5 pt-6 ${enMarco ? 'pb-8' : 'pb-32'}`}>
      {imagen
        ? (
          <div className="flex items-center gap-3">
            <img src={imagen} alt="" className="h-[72px] w-[72px] flex-shrink-0 rounded-xl border border-[#E4E4E7] bg-white object-contain p-1" />
            {pantalla?.titulo && <h2 className="text-[22px] font-bold text-[#1F1F23]">{pantalla.titulo}</h2>}
          </div>
        )
        : pantalla?.titulo && <h2 className="text-[22px] font-bold text-[#1F1F23]">{pantalla.titulo}</h2>}
      {pantalla?.intro && <p className="mt-2 text-[15px] leading-relaxed text-[#45454D]"><TextoConFormato texto={pantalla.intro} /></p>}
      <div className="mt-6 space-y-9">{children}</div>
    </div>
  );
}

export function BarraPantalla({ enMarco, enviando, ultima, onAtras, onSiguiente }: {
  enMarco: boolean; enviando?: boolean; ultima: boolean; onAtras: () => void; onSiguiente: () => void;
}) {
  return (
    <div className={`${enMarco ? 'sticky' : 'fixed inset-x-0'} bottom-0 z-20 border-t border-[#E4E4E7] bg-white/95 px-5 py-3 backdrop-blur`}>
      <div className="mx-auto flex max-w-lg gap-3">
        <button onClick={onAtras} disabled={enviando} className="rounded-xl border-[1.5px] border-[#D9D9DE] px-5 py-3.5 text-[15px] font-medium text-[#1F1F23]">
          Atrás
        </button>
        <button onClick={onSiguiente} disabled={enviando} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#1F1F23] py-3.5 text-[15px] font-semibold text-white disabled:opacity-60">
          {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
          {ultima ? 'Enviar' : 'Siguiente'}
        </button>
      </div>
    </div>
  );
}

export function Marco({ children, prueba, progreso, enMarco, scroll }: {
  children: React.ReactNode; prueba: boolean; progreso?: number; enMarco: boolean; scroll: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div ref={scroll} className={`flex flex-col bg-[#F6F6F7] ${enMarco ? 'h-full overflow-y-auto' : 'min-h-dvh'}`}>
      {/* Sin logo: el formulario es neutro (se contesta en sharpli.mx, ver lib/formularios/dominio.ts). */}
      <header className={`bg-[#F6F6F7] ${enMarco ? 'sticky top-0 z-10' : ''}`}>
        {progreso !== undefined && (
          <div className="h-1 bg-[#E4E4E7]"><div className="h-1 bg-[#1F1F23] transition-all" style={{ width: `${progreso}%` }} /></div>
        )}
        {prueba && (
          <div className="mx-auto flex max-w-lg justify-end px-5 pt-3">
            <span className="rounded-full bg-[#1F1F23] px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">Prueba</span>
          </div>
        )}
      </header>
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col">{children}</main>
    </div>
  );
}
