import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { getFormularioPublico, submitFormularioRespuesta } from 'zite-endpoints-sdk';
import { pantallas, terminacion, validarPantalla } from '@/lib/formularios/motor';
import type { Definicion, Respuestas, Valor } from '@/lib/formularios/tipos';
import { CampoPregunta } from '@/components/formularios/CampoPregunta';

// Mismo logo que SwipePage.tsx — página pública sin login.
const LOGO_URL = 'https://qmqtjfhifzxvnhiyifyh.supabase.co/storage/v1/object/public/publico/logo%20sapience%20blanco%2015%20ene%2026.png';

type Fase = 'cargando' | 'noexiste' | 'cerrado' | 'bienvenida' | 'preguntas' | 'enviando' | 'gracias' | 'nocalifica' | 'error';

interface Borrador { respuestas: Respuestas; pantallaId?: string; inicio: number }

const leer = <T,>(clave: string): T | null => { try { const v = localStorage.getItem(clave); return v ? JSON.parse(v) as T : null; } catch { return null; } };
const guardar = (clave: string, v: unknown) => { try { localStorage.setItem(clave, JSON.stringify(v)); } catch { /* sin almacenamiento */ } };
const borrar = (clave: string) => { try { localStorage.removeItem(clave); } catch { /* sin almacenamiento */ } };

function dispositivo(): string {
  const guardado = leer<string>('formularios_device');
  if (guardado) return guardado;
  const nuevo = crypto.randomUUID();
  guardar('formularios_device', nuevo);
  return nuevo;
}

/** Deja solo lo que contestó en preguntas que siguen visibles (si regresó y cambió algo, lo demás sobra). */
function soloVisibles(def: Definicion, resp: Respuestas): Respuestas {
  const limpio: Respuestas = {};
  for (const pantalla of pantallas(def, resp)) {
    for (const pv of pantalla.preguntas) {
      if (resp[pv.clave] !== undefined) limpio[pv.clave] = resp[pv.clave];
      if (resp[`${pv.clave}#otra`] !== undefined) limpio[`${pv.clave}#otra`] = resp[`${pv.clave}#otra`];
    }
  }
  return limpio;
}

/**
 * Página pública `/f/:codigo` de Tools → Formularios — hermana de <Layout>
 * en App.tsx, nunca pasa por useAuth(). Una pantalla por sección (o por cada
 * repetición de un bloque). Lo contestado se guarda en el celular mientras
 * tanto, así recargar no borra nada. Si una respuesta descarta, se envía lo
 * que hay y se despide sin decir por qué.
 */
export default function FormularioPublicoPage() {
  const { codigo = '' } = useParams<{ codigo: string }>();
  const claveBorrador = `formulario_${codigo}`;
  const [fase, setFase] = useState<Fase>('cargando');
  const [def, setDef] = useState<Definicion | null>(null);
  const [prueba, setPrueba] = useState(false);
  const [resp, setResp] = useState<Respuestas>({});
  const [actualId, setActualId] = useState<string>();
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [falla, setFalla] = useState('');
  const inicio = useRef(Date.now());
  const device = useMemo(dispositivo, []);

  useEffect(() => {
    getFormularioPublico({ codigo })
      .then((r) => {
        if (!r.found) return setFase('noexiste');
        if (r.estado === 'cerrado') return setFase('cerrado');
        setDef(r.definicion);
        setPrueba(r.estado === 'prueba');
        const borrador = leer<Borrador>(claveBorrador);
        if (borrador) {
          setResp(borrador.respuestas);
          setActualId(borrador.pantallaId);
          inicio.current = borrador.inicio;
          setFase(borrador.pantallaId ? 'preguntas' : 'bienvenida');
        } else {
          setFase('bienvenida');
        }
      })
      .catch(() => setFase('error'));
  }, [codigo, claveBorrador]);

  const lista = useMemo(() => (def ? pantallas(def, resp, device) : []), [def, resp, device]);
  const indice = Math.max(0, lista.findIndex((p) => p.id === actualId));
  const pantalla = lista[indice];

  useEffect(() => {
    if (fase === 'preguntas') guardar(claveBorrador, { respuestas: resp, pantallaId: pantalla?.id, inicio: inicio.current } satisfies Borrador);
  }, [fase, resp, pantalla?.id, claveBorrador]);

  const cambiar = (clave: string, valor: Valor | undefined) => {
    setResp((r) => {
      const n = { ...r };
      if (valor === undefined) delete n[clave]; else n[clave] = valor;
      return n;
    });
    setErrores((e) => { const n = { ...e }; delete n[clave]; delete n[clave.split('#')[0]]; return n; });
  };

  const enviar = async (final: Fase) => {
    if (!def) return;
    setFase('enviando');
    setFalla('');
    try {
      await submitFormularioRespuesta({
        codigo, respuestas: soloVisibles(def, resp), deviceToken: device,
        duracionSeg: Math.round((Date.now() - inicio.current) / 1000),
      });
      borrar(claveBorrador);
      setFase(final);
    } catch (err) {
      setFalla((err as Error).message || 'No se pudo enviar. Revisa tu conexión e intenta otra vez.');
      setFase('preguntas');
    }
  };

  const siguiente = () => {
    if (!def || !pantalla) return;
    const e = validarPantalla(pantalla, resp);
    setErrores(e);
    if (Object.keys(e).length) return;
    if (terminacion(def, resp, lista)) return enviar('nocalifica');
    const sig = lista[indice + 1];
    if (!sig) return enviar('gracias');
    setActualId(sig.id);
    window.scrollTo({ top: 0 });
  };

  const atras = () => {
    if (indice === 0) return setFase('bienvenida');
    setActualId(lista[indice - 1].id);
    setErrores({});
    window.scrollTo({ top: 0 });
  };

  const otraVez = () => {
    borrar(claveBorrador);
    setResp({});
    setActualId(undefined);
    inicio.current = Date.now();
    setFase('bienvenida');
  };

  if (fase === 'cargando') return <Mensaje><Loader2 className="mx-auto h-6 w-6 animate-spin" /></Mensaje>;
  if (fase === 'noexiste') return <Mensaje>Este enlace no existe o todavía no está disponible.</Mensaje>;
  if (fase === 'cerrado') return <Mensaje>Este cuestionario ya cerró. ¡Gracias por tu interés!</Mensaje>;
  if (fase === 'error') return <Mensaje>No pudimos cargar el cuestionario. Revisa tu conexión y vuelve a intentar.</Mensaje>;
  if (!def) return null;

  if (fase === 'gracias' || fase === 'nocalifica') {
    return (
      <Marco prueba={prueba}>
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <p className="max-w-sm text-[17px] leading-relaxed text-[#0F3D4D]">{fase === 'gracias' ? def.despedida : def.noCalifica}</p>
          {prueba && (
            <button onClick={otraVez} className="mt-8 rounded-full border-[1.5px] border-[#0F3D4D] px-6 py-2.5 text-[14px] font-semibold text-[#0F3D4D]">
              Contestar otra vez (prueba)
            </button>
          )}
        </div>
      </Marco>
    );
  }

  if (fase === 'bienvenida') {
    return (
      <Marco prueba={prueba}>
        <div className="flex flex-1 flex-col justify-center px-6 py-10">
          <h1 className="text-[26px] font-bold leading-tight text-[#0F3D4D]">{def.tituloPublico}</h1>
          <p className="mt-4 text-[16px] leading-relaxed text-[#3F5960]">{def.bienvenida}</p>
          <button
            onClick={() => { setActualId(actualId ?? lista[0]?.id); setFase('preguntas'); }}
            className="mt-10 w-full rounded-xl bg-[#0F3D4D] py-4 text-[16px] font-semibold text-white"
          >
            {actualId ? 'Continuar' : 'Empezar'}
          </button>
        </div>
      </Marco>
    );
  }

  const progreso = lista.length ? Math.round(((indice + 1) / lista.length) * 100) : 0;

  return (
    <Marco prueba={prueba} progreso={progreso}>
      <div className="flex-1 px-5 pb-32 pt-6">
        {pantalla?.titulo && <h2 className="text-[22px] font-bold text-[#0F3D4D]">{pantalla.titulo}</h2>}
        {pantalla?.intro && <p className="mt-2 text-[15px] leading-relaxed text-[#3F5960]">{pantalla.intro}</p>}
        <div className="mt-6 space-y-9">
          {pantalla?.preguntas.map((pv) => (
            <CampoPregunta key={pv.clave} pv={pv} resp={resp} error={errores[pv.clave]} codigo={codigo} onChange={cambiar} />
          ))}
        </div>
        {falla && <p className="mt-6 rounded-xl bg-[#FDECEC] px-4 py-3 text-[14px] text-[#D32222]">{falla}</p>}
      </div>
      <div className="fixed inset-x-0 bottom-0 border-t border-[#D5E2E5] bg-white/95 px-5 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-lg gap-3">
          <button onClick={atras} disabled={fase === 'enviando'} className="rounded-xl border-[1.5px] border-[#D5E2E5] px-5 py-3.5 text-[15px] font-medium text-[#0F3D4D]">
            Atrás
          </button>
          <button onClick={siguiente} disabled={fase === 'enviando'} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#0F3D4D] py-3.5 text-[15px] font-semibold text-white disabled:opacity-60">
            {fase === 'enviando' && <Loader2 className="h-4 w-4 animate-spin" />}
            {indice === lista.length - 1 ? 'Enviar' : 'Siguiente'}
          </button>
        </div>
      </div>
    </Marco>
  );
}

function Marco({ children, prueba, progreso }: { children: React.ReactNode; prueba: boolean; progreso?: number }) {
  return (
    <div className="flex min-h-dvh flex-col bg-[#F2F7F8]">
      <header className="bg-[#0F3D4D]">
        <div className="mx-auto flex max-w-lg items-center justify-between px-5 py-4">
          <img src={LOGO_URL} alt="Sapience" className="h-6 w-auto" />
          {prueba && <span className="rounded-full bg-[#F4C025] px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-[#0F3D4D]">Prueba</span>}
        </div>
        {progreso !== undefined && (
          <div className="h-1 bg-white/15"><div className="h-1 bg-[#F4C025] transition-all" style={{ width: `${progreso}%` }} /></div>
        )}
      </header>
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col">{children}</main>
    </div>
  );
}

function Mensaje({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-dvh items-center justify-center bg-[#F2F7F8] px-6 text-center text-[15px] text-[#6E8388]">{children}</div>;
}
